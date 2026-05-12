import { IsString, IsUUID } from 'class-validator';

export class CreateAppointmentDto {
  @IsString()
  startTime!: string;

  @IsUUID()
  customerId!: string;

  @IsUUID()
  establishmentId!: string;
}
