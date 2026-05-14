import { Injectable, NotFoundException } from '@nestjs/common';
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
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
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

    if (!appointment) throw new NotFoundException('Agendamento não encontrado');

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
}
