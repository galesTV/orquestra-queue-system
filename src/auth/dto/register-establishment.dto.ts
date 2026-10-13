import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterEstablishmentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  establishmentName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
