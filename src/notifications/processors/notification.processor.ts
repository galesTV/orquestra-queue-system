import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import * as nodemailer from 'nodemailer';

interface PromotionAlertData {
  customerId: string;
  establishmentId: string;
}

@Processor('notification-queue')
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    super();

    // Initialize the email transporter (using environment variables for configuration)
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('MAIL_HOST'),
      port: parseInt(this.configService.get<string>('MAIL_PORT') || '2525', 10),
      auth: {
        user: this.configService.get<string>('MAIL_USER'),
        pass: this.configService.get<string>('MAIL_PASS'),
      },
    });
  }

  async process(job: Job<PromotionAlertData, any, string>): Promise<void> {
    this.logger.log(`✉️ Processing notification for job ${job.id}`);

    if (job.name === 'send-promotion-alert') {
      const { customerId, establishmentId } = job.data;

      this.logger.log(`📧 Sending real email to customer ${customerId}...`);

      const recipientEmail = `${customerId}@exemplo.com`;

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #4f46e5; margin-top: 0;">A position has opened up for you! 🎉</h2>
          <p>Hello, <strong>${customerId}</strong>,</p>
          <p>Good news! A position has just become available at establishment <strong>${establishmentId}</strong>.</p>
          <div style="background-color: #f3f4f6; padding: 15px; border-radius: 6px; margin: 20px 0; text-align: center;">
            <p style="margin: 0; font-size: 16px; color: #1f2937;">
              You have exactly <strong>10 minutes</strong> to confirm your booking.
            </p>
          </div>
          <p style="color: #4b5563;">If you don't confirm in time, the system will automatically offer the position to the next person on the waiting list.</p>
          <br>
          <hr style="border: 0; border-top: 1px solid #e0e0e0;">
          <p style="font-size: 12px; color: #9ca3af; text-align: center; margin-bottom: 0;">
            Orquestra Queue System — Intelligent Queue Management
          </p>
        </div>
      `;

      try {
        const mailFrom =
          this.configService.get<string>('MAIL_FROM') ||
          '"Orquestra Queue System" <no-reply@orquestra.com>';

        await this.transporter.sendMail({
          from: mailFrom,
          to: recipientEmail,
          subject: '📢 Spot available! Confirm your appointment at Orquestra',
          html: htmlContent,
        });

        this.logger.log(`✅ Email sent successfully to ${recipientEmail}`);
      } catch (error) {
        this.logger.error(
          `❌ Failed to send email to ${recipientEmail}`,
          error,
        );
        throw error;
      }
    }
    return Promise.resolve();
  }
}
