import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateAppointmentSlotDto } from './dto/create-appointment-slot.dto';
import { AppointmentSlotsService } from './appointment-slots.service';

@Controller('appointment-slots')
export class AppointmentSlotsController {
  constructor(private readonly slotsService: AppointmentSlotsService) {}

  @Post()
  create(@Body() dto: CreateAppointmentSlotDto) {
    return this.slotsService.create(dto);
  }

  @Get('establishment/:establishmentId')
  findByEstablishment(@Param('establishmentId') establishmentId: string) {
    return this.slotsService.findByEstablishment(establishmentId);
  }
}
