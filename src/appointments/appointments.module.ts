import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsProcessor } from './processors/appointment-processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'appointment-queue',
    }),
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, AppointmentsProcessor],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
