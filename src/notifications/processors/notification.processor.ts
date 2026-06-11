import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

interface PromotionAlertData {
  customerId: string;
  establishmentId: string;
}

@Processor('notification-queue')
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  process(job: Job<PromotionAlertData, any, string>): Promise<void> {
    this.logger.log(`✉️ Processing notification for job ${job.id}`);

    if (job.name === 'send-promotion-alert') {
      const { customerId, establishmentId } = job.data;

      this.logger.log(
        `📢 [NOTIFICATION] Hello ${customerId}! A spot has opened at establishment ${establishmentId}.`,
      );
      this.logger.log(
        `⏳ You have 10 minutes to confirm your appointment, or the spot will be offered to the next person!`,
      );

      // NOTE: Implement real notification logic here (e.g., send email, push notification, etc.)
    }
    return Promise.resolve();
  }
}
