import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

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
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    return appointment;
  }

  async remove(id: string) {
    return await this.prisma.appointment.delete({
      where: { id },
    });
  }
}
