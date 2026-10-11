import { IsDateString, IsUUID } from 'class-validator';

export class CreateAppointmentSlotDto {
  @IsUUID()
  establishmentId!: string;

  @IsDateString({ strict: true })
  startTime!: string;
}
