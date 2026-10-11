import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateAppointmentSlotDto } from './dto/create-appointment-slot.dto';
import { UpdateAppointmentSlotDto } from './dto/update-appointment-slot.dto';
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

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAppointmentSlotDto) {
    return this.slotsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.slotsService.remove(id);
  }
}
