import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAppointmentSlotDto } from './dto/create-appointment-slot.dto';
import { UpdateAppointmentSlotDto } from './dto/update-appointment-slot.dto';
import { lockAppointmentSlot } from './appointment-slot-lock';

const ACTIVE_APPOINTMENT_STATUSES = ['SCHEDULED', 'WAITING_CONFIRMATION'] as const;

@Injectable()
export class AppointmentSlotsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAppointmentSlotDto) {
    const startTime = new Date(dto.startTime);
    const establishment = await this.prisma.establishment.findUnique({
      where: { id: dto.establishmentId },
      select: { id: true, name: true },
    });
    if (!establishment) throw new NotFoundException('Establishment not found');

    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockAppointmentSlot(tx, dto.establishmentId, startTime);

        return tx.appointmentSlot.create({
          data: { establishmentId: dto.establishmentId, startTime },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('This appointment slot is already configured.');
      }
      throw error;
    }
  }

  async findByEstablishment(establishmentId: string) {
    const establishment = await this.prisma.establishment.findUnique({
      where: { id: establishmentId },
      select: { id: true },
    });
    if (!establishment) throw new NotFoundException('Establishment not found');

    return this.prisma.appointmentSlot.findMany({
      where: { establishmentId },
      orderBy: { startTime: 'asc' },
    });
  }

  async update(id: string, dto: UpdateAppointmentSlotDto) {
    const requestedStartTime = new Date(dto.startTime);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const initial = await tx.appointmentSlot.findUnique({ where: { id } });
        if (!initial) throw new NotFoundException('Appointment slot not found');

        const lockTargets = [
          { establishmentId: initial.establishmentId, startTime: initial.startTime },
          { establishmentId: initial.establishmentId, startTime: requestedStartTime },
        ].sort((a, b) => {
          const left = `${a.establishmentId}:${a.startTime.toISOString()}`;
          const right = `${b.establishmentId}:${b.startTime.toISOString()}`;
          return left.localeCompare(right);
        });

        for (const target of lockTargets) {
          await lockAppointmentSlot(tx, target.establishmentId, target.startTime);
        }

        const current = await tx.appointmentSlot.findUnique({ where: { id } });
        if (
          !current ||
          current.establishmentId !== initial.establishmentId ||
          current.startTime.getTime() !== initial.startTime.getTime()
        ) {
          throw new ConflictException(
            'Appointment slot changed concurrently. Reload and retry.',
          );
        }

        if (current.startTime.getTime() === requestedStartTime.getTime()) {
          return current;
        }

        await this.assertSlotCanBeChanged(
          tx,
          current.establishmentId,
          current.startTime,
        );
        await this.assertTargetTimeIsFree(
          tx,
          current.establishmentId,
          requestedStartTime,
        );

        return tx.appointmentSlot.update({
          where: { id },
          data: { startTime: requestedStartTime },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Another slot is already configured for this time.',
        );
      }
      throw error;
    }
  }

  async remove(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.appointmentSlot.findUnique({ where: { id } });
      if (!initial) throw new NotFoundException('Appointment slot not found');

      await lockAppointmentSlot(tx, initial.establishmentId, initial.startTime);

      const current = await tx.appointmentSlot.findUnique({ where: { id } });
      if (
        !current ||
        current.establishmentId !== initial.establishmentId ||
        current.startTime.getTime() !== initial.startTime.getTime()
      ) {
        throw new ConflictException('Appointment slot changed concurrently. Reload and retry.');
      }

      await this.assertSlotCanBeChanged(tx, current.establishmentId, current.startTime);

      return tx.appointmentSlot.delete({ where: { id } });
    });
  }

  private async assertSlotCanBeChanged(
    tx: Prisma.TransactionClient,
    establishmentId: string,
    startTime: Date,
  ): Promise<void> {
    const activeAppointment = await tx.appointment.findFirst({
      where: {
        establishmentId,
        startTime,
        status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
      },
      select: { id: true },
    });
    if (activeAppointment) {
      throw new ConflictException(
        'This slot cannot be changed while it has an active appointment.',
      );
    }

    const waitingEntry = await tx.waitingQueue.findFirst({
      where: { establishmentId, startTime },
      select: { id: true },
    });
    if (waitingEntry) {
      throw new ConflictException(
        'This slot cannot be changed while customers are in its waiting queue.',
      );
    }
  }

  private async assertTargetTimeIsFree(
    tx: Prisma.TransactionClient,
    establishmentId: string,
    startTime: Date,
  ): Promise<void> {
    const existingSlot = await tx.appointmentSlot.findUnique({
      where: { establishmentId_startTime: { establishmentId, startTime } },
      select: { id: true },
    });
    if (existingSlot) {
      throw new ConflictException('Another slot is already configured for this time.');
    }

    const activeAppointment = await tx.appointment.findFirst({
      where: {
        establishmentId,
        startTime,
        status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
      },
      select: { id: true },
    });
    if (activeAppointment) {
      throw new ConflictException('The requested time already has an active appointment.');
    }

    const waitingEntry = await tx.waitingQueue.findFirst({
      where: { establishmentId, startTime },
      select: { id: true },
    });
    if (waitingEntry) {
      throw new ConflictException('The requested time already has a waiting queue.');
    }
  }
}
