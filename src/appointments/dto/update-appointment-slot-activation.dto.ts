import { IsBoolean } from 'class-validator';

export class UpdateAppointmentSlotActivationDto {
  @IsBoolean()
  isActive!: boolean;
}
