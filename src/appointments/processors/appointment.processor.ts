import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';

// Interface definitions for job data
interface CancellationJobData {
  appointmentId: string;
  establishmentId: string;
}

interface ExpirationJobData {
  customerId: string;
  establishmentId: string;
}

@Processor('appointment-queue')
export class AppointmentsProcessor extends WorkerHost {
  private readonly logger = new Logger(AppointmentsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('notification-queue')
    private readonly notificationQueue: Queue,
    @InjectQueue('appointment-queue')
    private readonly appointmentQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`⚙️ Processing job ${job.id} of type: ${job.name}`);

    switch (job.name) {
      case 'process-cancellation':
        await this.handleCancellation(job as Job<CancellationJobData>);
        break;

      case 'check-expiration':
        await this.handleExpiration(job as Job<ExpirationJobData>);
        break;

      default:
        this.logger.warn(`⚠️ Unknown job type: ${job.name}`);
    }
  }

  private async handleCancellation(job: Job<CancellationJobData>) {
    const { establishmentId } = job.data;
    this.logger.log(
      `🔄 Orchestrating queue for the establishment: ${establishmentId}`,
    );

    const nextInQueue = await this.prisma.waitingQueue.findFirst({
      where: { establishmentId },
      orderBy: { position: 'asc' },
    });

    if (!nextInQueue) {
      this.logger.log(
        'ℹ️ No client in the waiting queue for this establishment.',
      );
      return;
    }

    await this.prisma.$transaction([
      this.prisma.appointment.create({
        data: {
          startTime: new Date(),
          customerId: nextInQueue.customerId,
          establishmentId: nextInQueue.establishmentId,
          status: 'WAITING_CONFIRMATION',
        },
      }),
      this.prisma.waitingQueue.delete({
        where: { id: nextInQueue.id },
      }),
    ]);

    this.logger.log(
      `✅ Client ${nextInQueue.customerId} promoted successfully!`,
    );

    await this.notificationQueue.add('send-promotion-alert', {
      customerId: nextInQueue.customerId,
      establishmentId: nextInQueue.establishmentId,
    });

    await this.appointmentQueue.add(
      'check-expiration',
      {
        customerId: nextInQueue.customerId,
        establishmentId: nextInQueue.establishmentId,
      },
      {
        delay: 10 * 60 * 1000, // 10 minutes in milliseconds
      },
    );
  }

  private async handleExpiration(job: Job<ExpirationJobData>) {
    const { customerId, establishmentId } = job.data;

    this.logger.log(
      `⏳ Checking expiration for customer ${customerId} at establishment ${establishmentId}`,
    );

    // Search for an appointment that is still waiting for confirmation for this customer and establishment
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        customerId,
        establishmentId,
        status: 'WAITING_CONFIRMATION',
      },
    });

    // If no appointment is found, it means the client already confirmed or the appointment was canceled by another process. In both cases, we can just log and exit.
    if (!appointment) {
      this.logger.log(
        `✨ Client ${customerId} already confirmed or appointment state changed. No action needed.`,
      );
      return;
    }

    this.logger.warn(
      `🚨 Time's up! Client ${customerId} failed to confirm. Expiring appointment...`,
    );

    // If the appointment is still waiting for confirmation, we cancel it
    await this.prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: 'CANCELED' },
    });

    // After canceling the appointment, we can trigger the cancellation workflow to promote the next client in the waiting queue
    await this.appointmentQueue.add('process-cancellation', {
      appointmentId: appointment.id,
      establishmentId: appointment.establishmentId,
    });
  }
}
