import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAppointmentSlotDto } from './dto/create-appointment-slot.dto';

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
      return await this.prisma.appointmentSlot.create({
        data: { establishmentId: dto.establishmentId, startTime },
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
}
