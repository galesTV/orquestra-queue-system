import { IsDateString, IsUUID } from 'class-validator';

export class CreateAppointmentDto {
  @IsDateString({ strict: true })
  startTime!: string;

  @IsUUID()
  customerId!: string;

  @IsUUID()
  establishmentId!: string;
}
