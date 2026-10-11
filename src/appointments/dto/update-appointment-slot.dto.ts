import { IsDateString } from 'class-validator';

export class UpdateAppointmentSlotDto {
  @IsDateString({ strict: true })
  startTime!: string;
}
