import {
  BadRequestException,
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
    return await this.prisma.appointment.create({
      data: {
        startTime: new Date(createAppointmentDto.startTime),
        customerId: createAppointmentDto.customerId,
        establishmentId: createAppointmentDto.establishmentId,
        status: 'SCHEDULED',
      },
    });
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

  async confirm(id: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
    });

    if (!appointment) throw new NotFoundException('Appointment not found');

    if (appointment.status !== 'WAITING_CONFIRMATION') {
      throw new BadRequestException(
        'Appointment is not waiting for confirmation',
      );
    }

    return await this.prisma.appointment.update({
      where: { id },
      data: { status: 'SCHEDULED' },
    });
  }

  async getCustomerPosition(customerId: string) {
    // Check if the customer is in the waiting queue
    const queueEntry = await this.prisma.waitingQueue.findFirst({
      where: { customerId },
      include: { establishment: true },
    });

    if (!queueEntry) {
      const activeAppointment = await this.prisma.appointment.findFirst({
        where: { customerId, status: 'WAITING_CONFIRMATION' },
      });

      if (activeAppointment) {
        return {
          customerId,
          inQueue: false,
          status: 'SCHEDULED',
          message:
            'You have an appointment waiting for confirmation. Please confirm it to secure your spot.',
        };
      }

      throw new NotFoundException(
        'Customer not found in any active waiting queue.',
      );
    }

    return {
      customerId,
      inQueue: true,
      status: 'WAITING_CONFIRMATION',
      position: queueEntry.position,
      establishment: {
        id: queueEntry.establishmentId,
        name: queueEntry.establishment.name,
      },
      joinedAt: queueEntry.joinedAt,
    };
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
