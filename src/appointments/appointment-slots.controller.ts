import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser, CurrentUser } from '../auth/current-user.decorator';
import { CreateAppointmentSlotDto } from './dto/create-appointment-slot.dto';
import { UpdateAppointmentSlotActivationDto } from './dto/update-appointment-slot-activation.dto';
import { UpdateAppointmentSlotDto } from './dto/update-appointment-slot.dto';
import { AppointmentSlotsService } from './appointment-slots.service';

@Controller('appointment-slots')
@UseGuards(AuthGuard)
export class AppointmentSlotsController {
  constructor(private readonly slotsService: AppointmentSlotsService) {}

  @Post()
  create(
    @Body() dto: CreateAppointmentSlotDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertOwnEstablishment(dto.establishmentId, user);
    return this.slotsService.create(dto);
  }

  @Get('establishment/:establishmentId')
  findByEstablishment(
    @Param('establishmentId') establishmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertOwnEstablishment(establishmentId, user);
    return this.slotsService.findByEstablishment(establishmentId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentSlotDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.slotsService.assertBelongsToEstablishment(id, user.establishmentId);
    return this.slotsService.update(id, dto);
  }

  @Patch(':id/activation')
  async setActive(
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentSlotActivationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.slotsService.assertBelongsToEstablishment(id, user.establishmentId);
    return this.slotsService.setActive(id, dto.isActive);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.slotsService.assertBelongsToEstablishment(id, user.establishmentId);
    return this.slotsService.remove(id);
  }

  private assertOwnEstablishment(
    requestedId: string,
    user: AuthenticatedUser,
  ): void {
    if (requestedId !== user.establishmentId) {
      throw new ForbiddenException('You can only manage your own establishment.');
    }
  }
}
