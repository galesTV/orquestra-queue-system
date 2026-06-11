import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';

@Processor('appointment-queue')
export class AppointmentsProcessor extends WorkerHost {
  private readonly logger = new Logger(AppointmentsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('notification-queue')
    private readonly notificationQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`⚙️ Processing job ${job.id} of type: ${job.name}`);

    switch (job.name) {
      case 'process-cancellation':
        await this.handleCancellation(job.data);
        break;

      default:
        this.logger.warn(`⚠️ Unknown job type: ${job.name}`);
    }
  }

  private async handleCancellation(data: {
    appointmentId: string;
    establishmentId: string;
  }) {
    const { appointmentId, establishmentId } = data;
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
  }
}
