import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BullModule } from '@nestjs/bullmq';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsProcessor } from './processors/appointment.processor';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueueGateway } from './gateways/queue.gateway';
import { AppointmentSlotsController } from './appointment-slots.controller';
import { AppointmentSlotsService } from './appointment-slots.service';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueueAsync({
      name: 'appointment-queue',
      useFactory: () => ({
        connection: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
        },
      }),
    }),
    NotificationsModule,
  ],
  controllers: [AppointmentsController, AppointmentSlotsController],
  providers: [AppointmentsService, AppointmentsProcessor, QueueGateway, AppointmentSlotsService],
  exports: [AppointmentsService, QueueGateway, AppointmentSlotsService],
})
export class AppointmentsModule {}
