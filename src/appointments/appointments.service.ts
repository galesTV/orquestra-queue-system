import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { lockAppointmentSlot } from './appointment-slot-lock';

const ACTIVE_STATUSES = ['SCHEDULED', 'WAITING_CONFIRMATION'] as const;
const CONFIRMATION_TIMEOUT_MS = 10 * 1000;

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('appointment-queue') private readonly appointmentQueue: Queue,
  ) {}

  async create(createAppointmentDto: CreateAppointmentDto) {
    const { customerId, establishmentId } = createAppointmentDto;
    const startTime = new Date(createAppointmentDto.startTime);

    const result = await this.prisma.$transaction(async (tx) => {
      await lockAppointmentSlot(tx, establishmentId, startTime);

      const establishment = await tx.establishment.findUnique({
        where: { id: establishmentId },
      });
      if (!establishment) {
        throw new NotFoundException('Establishment not found');
      }

      const configuredSlot = await tx.appointmentSlot.findUnique({
        where: {
          establishmentId_startTime: { establishmentId, startTime },
        },
      });
      if (!configuredSlot) {
        throw new BadRequestException(
          'The requested time is not configured as an available slot for this establishment.',
        );
      }
      if (!configuredSlot.isActive) {
        throw new BadRequestException(
          'The requested appointment slot is inactive and cannot accept bookings.',
        );
      }

      const existingAppointment = await tx.appointment.findFirst({
        where: {
          establishmentId,
          startTime,
          status: { in: [...ACTIVE_STATUSES] },
        },
      });

      const existingQueueEntry = await tx.waitingQueue.findFirst({
        where: { establishmentId, startTime, customerId },
      });

      if (existingQueueEntry) {
        return {
          customerId,
          inQueue: true,
          position: existingQueueEntry.position,
          establishment: { id: establishment.id, name: establishment.name },
          message: `You are already in the waiting queue at position ${existingQueueEntry.position}.`,
        };
      }

      if (existingAppointment?.customerId === customerId) {
        return {
          customerId,
          inQueue: false,
          status: existingAppointment.status,
          appointmentId: existingAppointment.id,
          establishment: { id: establishment.id, name: establishment.name },
          message: 'You already have an appointment for this time slot.',
        };
      }

      if (existingAppointment) {
        const lastInQueue = await tx.waitingQueue.findFirst({
          where: { establishmentId, startTime },
          orderBy: { position: 'desc' },
        });
        const nextPosition = (lastInQueue?.position ?? 0) + 1;

        const queueEntry = await tx.waitingQueue.create({
          data: { customerId, establishmentId, startTime, position: nextPosition },
        });

        return {
          customerId,
          inQueue: true,
          position: queueEntry.position,
          establishment: { id: establishment.id, name: establishment.name },
          message: `The selected time is occupied. You have been added to the waiting queue at position ${queueEntry.position}.`,
        };
      }

      // If the slot is empty but already has a queue, preserve FIFO and do not
      // let a new request jump ahead of customers who were waiting first.
      const firstWaiting = await tx.waitingQueue.findFirst({
        where: { establishmentId, startTime },
        orderBy: { position: 'asc' },
      });

      if (firstWaiting) {
        const lastInQueue = await tx.waitingQueue.findFirst({
          where: { establishmentId, startTime },
          orderBy: { position: 'desc' },
        });
        const queueEntry = await tx.waitingQueue.create({
          data: {
            customerId,
            establishmentId,
            startTime,
            position: (lastInQueue?.position ?? 0) + 1,
          },
        });

        await this.appointmentQueue.add('process-cancellation', {
          establishmentId,
          startTime: startTime.toISOString(),
        });

        return {
          customerId,
          inQueue: true,
          position: queueEntry.position,
          establishment: { id: establishment.id, name: establishment.name },
          message: `The selected time is being assigned from the waiting queue. You are at position ${queueEntry.position}.`,
        };
      }

      const appointment = await tx.appointment.create({
        data: {
          startTime,
          customerId,
          establishmentId,
          status: 'WAITING_CONFIRMATION',
        },
        include: { establishment: true },
      });

      await this.appointmentQueue.add(
        'check-expiration',
        {
          appointmentId: appointment.id,
          establishmentId: appointment.establishmentId,
          customerId: appointment.customerId,
          startTime: appointment.startTime.toISOString(),
        },
        { delay: CONFIRMATION_TIMEOUT_MS },
      );

      return {
        customerId,
        inQueue: false,
        status: 'WAITING_CONFIRMATION',
        appointmentId: appointment.id,
        establishment: {
          id: appointment.establishmentId,
          name: appointment.establishment.name,
        },
        message: 'Your appointment is awaiting confirmation.',
      };
    });

    return result;
  }

  async findAll() {
    return this.prisma.appointment.findMany();
  }

  async findOne(id: string) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id } });
    if (!appointment) throw new NotFoundException('Appointment not found');
    return appointment;
  }

  async remove(id: string) {
    // Deleting an appointment directly would bypass slot release and promotion.
    return this.cancel(id);
  }

  async update(id: string, updateAppointmentDto: UpdateAppointmentDto) {
    const current = await this.prisma.appointment.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Appointment not found');

    const targetStartTime = updateAppointmentDto.startTime
      ? new Date(updateAppointmentDto.startTime)
      : current.startTime;
    const targetEstablishmentId =
      updateAppointmentDto.establishmentId ?? current.establishmentId;

    const result = await this.prisma.$transaction(async (tx) => {
      const locks = [
        { establishmentId: current.establishmentId, startTime: current.startTime },
        { establishmentId: targetEstablishmentId, startTime: targetStartTime },
      ].sort((a, b) => {
        const left = `${a.establishmentId}:${a.startTime.toISOString()}`;
        const right = `${b.establishmentId}:${b.startTime.toISOString()}`;
        return left.localeCompare(right);
      });

      for (const lock of locks) {
        await lockAppointmentSlot(tx, lock.establishmentId, lock.startTime);
      }

      const lockedCurrent = await tx.appointment.findUnique({ where: { id } });
      if (
        !lockedCurrent ||
        lockedCurrent.establishmentId !== current.establishmentId ||
        lockedCurrent.startTime.getTime() !== current.startTime.getTime()
      ) {
        throw new ConflictException('Appointment changed concurrently. Reload it and retry.');
      }

      const targetSlotChanged =
        targetEstablishmentId !== current.establishmentId ||
        targetStartTime.getTime() !== current.startTime.getTime();

      if (targetSlotChanged) {
        const configuredSlot = await tx.appointmentSlot.findUnique({
          where: {
            establishmentId_startTime: {
              establishmentId: targetEstablishmentId,
              startTime: targetStartTime,
            },
          },
        });
        if (!configuredSlot) {
          throw new BadRequestException(
            'The requested time is not configured as an available slot for this establishment.',
          );
        }
        if (!configuredSlot.isActive) {
          throw new BadRequestException(
            'The requested appointment slot is inactive and cannot accept bookings.',
          );
        }
      }

      const conflict = await tx.appointment.findFirst({
        where: {
          id: { not: id },
          establishmentId: targetEstablishmentId,
          startTime: targetStartTime,
          status: { in: [...ACTIVE_STATUSES] },
        },
      });
      const queuedAhead = await tx.waitingQueue.findFirst({
        where: { establishmentId: targetEstablishmentId, startTime: targetStartTime },
      });
      if (conflict || (targetSlotChanged && queuedAhead)) {
        throw new ConflictException(
          'The requested time slot is occupied or has a waiting list. Create a waitlist entry instead of moving this appointment.',
        );
      }

      return tx.appointment.update({
        where: { id },
        data: {
          ...(updateAppointmentDto.startTime && { startTime: targetStartTime }),
          ...(updateAppointmentDto.customerId && { customerId: updateAppointmentDto.customerId }),
          ...(updateAppointmentDto.establishmentId && {
            establishmentId: updateAppointmentDto.establishmentId,
          }),
        },
      });
    });

    const slotChanged =
      targetEstablishmentId !== current.establishmentId ||
      targetStartTime.getTime() !== current.startTime.getTime();
    if (slotChanged) {
      await this.appointmentQueue.add('process-cancellation', {
        appointmentId: current.id,
        establishmentId: current.establishmentId,
        startTime: current.startTime.toISOString(),
      });
    }
    return result;
  }

  async cancel(id: string) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id } });
    if (!appointment) throw new NotFoundException('Appointment not found');

    const updatedAppointment = await this.prisma.$transaction(async (tx) => {
      await lockAppointmentSlot(tx, appointment.establishmentId, appointment.startTime);

      const current = await tx.appointment.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Appointment not found');
      if (
        current.establishmentId !== appointment.establishmentId ||
        current.startTime.getTime() !== appointment.startTime.getTime()
      ) {
        throw new ConflictException('Appointment changed concurrently. Retry cancellation.');
      }

      if (current.status === 'CANCELED') return current;

      return tx.appointment.update({
        where: { id },
        data: { status: 'CANCELED' },
      });
    });

    await this.appointmentQueue.add('process-cancellation', {
      appointmentId: appointment.id,
      establishmentId: appointment.establishmentId,
      startTime: appointment.startTime.toISOString(),
    });

    return updatedAppointment;
  }

  async confirm(appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');

    return this.prisma.$transaction(async (tx) => {
      await lockAppointmentSlot(tx, appointment.establishmentId, appointment.startTime);

      const current = await tx.appointment.findUnique({ where: { id: appointmentId } });
      if (!current) throw new NotFoundException('Appointment not found');
      if (
        current.establishmentId !== appointment.establishmentId ||
        current.startTime.getTime() !== appointment.startTime.getTime()
      ) {
        throw new ConflictException('Appointment changed concurrently. Reload it and retry.');
      }
      if (current.status !== 'WAITING_CONFIRMATION') {
        throw new BadRequestException('Appointment is not waiting for confirmation');
      }

      return tx.appointment.update({
        where: { id: appointmentId },
        data: { status: 'SCHEDULED' },
      });
    });
  }

  async getCustomerPosition(customerId: string) {
    const queueEntry = await this.prisma.waitingQueue.findFirst({
      where: { customerId },
      orderBy: { joinedAt: 'asc' },
      include: { establishment: true },
    });

    if (queueEntry) {
      return {
        customerId,
        inQueue: true,
        status: 'WAITING',
        position: queueEntry.position,
        startTime: queueEntry.startTime,
        establishment: {
          id: queueEntry.establishmentId,
          name: queueEntry.establishment.name,
        },
        joinedAt: queueEntry.joinedAt,
      };
    }

    const activeAppointment = await this.prisma.appointment.findFirst({
      where: { customerId, status: 'WAITING_CONFIRMATION' },
      include: { establishment: true },
      orderBy: { startTime: 'asc' },
    });

    if (activeAppointment) {
      return {
        customerId,
        inQueue: false,
        status: 'PROMOTED',
        appointmentId: activeAppointment.id,
        startTime: activeAppointment.startTime,
        establishment: {
          id: activeAppointment.establishmentId,
          name: activeAppointment.establishment.name,
        },
      };
    }

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
        message: 'Your appointment was canceled and the time slot was released.',
        establishment: {
          id: canceledAppointment.establishmentId,
          name: canceledAppointment.establishment.name,
        },
      };
    }

    throw new NotFoundException('Customer not found in any active waiting queue.');
  }

  async getQueueSize(establishmentId: string) {
    const size = await this.prisma.waitingQueue.count({ where: { establishmentId } });
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
