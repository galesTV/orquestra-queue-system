import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('appointment-queue') private readonly appointmentQueue: Queue,
  ) {}

  async create(createAppointmentDto: CreateAppointmentDto) {
    const { customerId, establishmentId, startTime } = createAppointmentDto;

    const lockKey = `lock:establishment:${establishmentId}`;

    const redisClient = (await this.appointmentQueue.client) as any;

    const acquiredLock = await redisClient.set(
      lockKey,
      customerId,
      'PX',
      5000,
      'NX',
    );

    if (!acquiredLock) {
      throw new ConflictException(
        'Another appointment is being processed for this establishment. Please try again shortly.',
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const activeAppointment = await tx.appointment.findFirst({
          where: {
            establishmentId,
            status: {
              in: ['SCHEDULED', 'WAITING_CONFIRMATION'],
            },
          },
        });

        if (activeAppointment) {
          const lastInQueue = await tx.waitingQueue.findFirst({
            where: { establishmentId },
            orderBy: { position: 'desc' },
          });

          const nextPosition = lastInQueue ? lastInQueue.position + 1 : 1;

          const queueEntry = await tx.waitingQueue.create({
            data: {
              customerId,
              establishmentId,
              position: nextPosition,
            },
            include: { establishment: true },
          });

          return {
            customerId,
            inQueue: true,
            position: queueEntry.position,
            establishment: {
              id: queueEntry.establishmentId,
              name: queueEntry.establishment.name,
            },
            message: `The establishment is currently busy. You have been added to the waiting queue at position ${queueEntry.position}.`,
          };
        }

        const newAppointment = await tx.appointment.create({
          data: {
            startTime: new Date(startTime),
            customerId,
            establishmentId,
            status: 'WAITING_CONFIRMATION',
          },
          include: { establishment: true },
        });

        await this.appointmentQueue.add(
          'check-expiration',
          {
            appointmentId: newAppointment.id,
            establishmentId: newAppointment.establishmentId,
            customerId: newAppointment.customerId,
          },
          { delay: 10 * 1000 },
        );

        return {
          customerId,
          inQueue: false,
          status: 'WAITING_CONFIRMATION',
          appointmentId: newAppointment.id,
          establishment: {
            id: newAppointment.establishmentId,
            name: newAppointment.establishment.name,
          },
          message: `You have an appointment scheduled. Please confirm within 10 minutes.`,
        };
      });
    } finally {
      await redisClient.del(lockKey);
    }
  }

  async findAll() {
    return await this.prisma.appointment.findMany();
  }

  async findOne(id: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');
    return appointment;
  }

  async remove(id: string) {
    return await this.prisma.appointment.delete({
      where: { id },
    });
  }

  async update(id: string, updateAppointmentDto: UpdateAppointmentDto) {
    return await this.prisma.appointment.update({
      where: { id },
      data: {
        ...(updateAppointmentDto.startTime && {
          startTime: new Date(updateAppointmentDto.startTime),
        }),
        customerId: updateAppointmentDto.customerId,
        establishmentId: updateAppointmentDto.establishmentId,
      },
    });
  }

  async cancel(id: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
    });

    if (!appointment) throw new NotFoundException('Appointment not found');

    const updatedAppointment = await this.prisma.appointment.update({
      where: { id },
      data: { status: 'CANCELED' },
    });

    await this.appointmentQueue.add('process-cancellation', {
      appointmentId: appointment.id,
      establishmentId: appointment.establishmentId,
    });

    return updatedAppointment;
  }

  async confirm(customerId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        customerId,
        status: 'WAITING_CONFIRMATION',
      },
    });

    if (!appointment) throw new NotFoundException('Appointment not found');

    if (appointment.status !== 'WAITING_CONFIRMATION') {
      throw new BadRequestException(
        'Appointment is not waiting for confirmation',
      );
    }

    return await this.prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: 'SCHEDULED' },
    });
  }

  async getCustomerPosition(customerId: string) {
    // Check if the customer is in the waiting queue
    const queueEntry = await this.prisma.waitingQueue.findFirst({
      where: { customerId },
      include: { establishment: true },
    });

    if (queueEntry) {
      return {
        customerId,
        inQueue: true,
        status: 'WAITING',
        position: queueEntry.position,
        establishment: {
          id: queueEntry.establishmentId,
          name: queueEntry.establishment.name,
        },
        joinedAt: queueEntry.joinedAt,
      };
    }

    // If not in the waiting queue, check if the customer has an active appointment
    const activeAppointment = await this.prisma.appointment.findFirst({
      where: { customerId, status: 'WAITING_CONFIRMATION' },
      include: { establishment: true },
    });

    if (activeAppointment) {
      return {
        customerId,
        inQueue: false,
        status: 'PROMOTED',
        message: '',
        establishment: {
          id: activeAppointment.establishmentId,
          name: activeAppointment.establishment.name,
        },
      };
    }

    // If not in the waiting queue or active appointment, check if the customer has a canceled appointment
    const canceledAppointment = await this.prisma.appointment.findFirst({
      where: { customerId, status: 'CANCELED' },
      orderBy: { startTime: 'desc' },
      include: { establishment: true },
    });

    if (canceledAppointment) {
      return {
        customerId,
        inQueue: false,
        status: 'CANCELED',
        message:
          'Your 10-minute confirmation period has expired, and your spot has been released.',
        establishment: {
          id: canceledAppointment.establishmentId,
          name: canceledAppointment.establishment.name,
        },
      };
    }

    throw new NotFoundException(
      'Customer not found in any active waiting queue.',
    );
  }

  async getQueueSize(establishmentId: string) {
    const size = await this.prisma.waitingQueue.count({
      where: { establishmentId },
    });

    const sampleEntry = await this.prisma.waitingQueue.findFirst({
      where: { establishmentId },
      include: { establishment: true },
    });

    return {
      establishmentId,
      establishmentName: sampleEntry?.establishment.name || ' ',
      totalWaiting: size,
    };
  }
}
