import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueGateway } from '../gateways/queue.gateway';
import { lockAppointmentSlot } from '../appointment-slot-lock';

interface CancellationJobData {
  appointmentId?: string;
  establishmentId: string;
  startTime?: string;
}

interface ExpirationJobData {
  appointmentId?: string;
  customerId: string;
  establishmentId: string;
  startTime?: string;
}

@Processor('appointment-queue', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
})
export class AppointmentsProcessor extends WorkerHost {
  private readonly logger = new Logger(AppointmentsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('notification-queue')
    private readonly notificationQueue: Queue,
    @InjectQueue('appointment-queue')
    private readonly appointmentQueue: Queue,
    private readonly queueGateway: QueueGateway,
  ) {
    super();
    this.logger.log(
      'AppointmentsProcessor initialized and ready to process jobs.',
    );
  }

  async process(job: Job<any, any, string>): Promise<void> {
    this.logger.log(`Processing job ${job.id} of type: ${job.name}`);

    switch (job.name) {
      case 'process-cancellation':
        await this.handleCancellation(job as Job<CancellationJobData>);
        break;
      case 'check-expiration':
        await this.handleExpiration(job as Job<ExpirationJobData>);
        break;
      default:
        this.logger.warn(`Unknown job type: ${job.name}`);
    }
  }

  private async handleCancellation(
    job: Job<CancellationJobData>,
  ): Promise<void> {
    const { establishmentId } = job.data;
    let startTime = job.data.startTime
      ? new Date(job.data.startTime)
      : undefined;

    if (!startTime && job.data.appointmentId) {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: job.data.appointmentId },
      });
      startTime = appointment?.startTime;
    }

    if (!startTime) {
      this.logger.warn('Cannot process slot promotion without a startTime.');
      return;
    }
    const slotStartTime = startTime;

    const promoted = await this.prisma.$transaction(async (tx) => {
      await lockAppointmentSlot(tx, establishmentId, slotStartTime);

      const configuredSlot = await tx.appointmentSlot.findUnique({
        where: {
          establishmentId_startTime: {
            establishmentId,
            startTime: slotStartTime,
          },
        },
      });
      if (!configuredSlot || !configuredSlot.isActive) {
        this.logger.log(
          'Slot is missing or inactive; skipping waitlist promotion.',
        );
        return null;
      }

      const activeAppointment = await tx.appointment.findFirst({
        where: {
          establishmentId,
          startTime: slotStartTime,
          status: { in: ['SCHEDULED', 'WAITING_CONFIRMATION'] },
        },
      });
      if (activeAppointment) return null;

      const nextInQueue = await tx.waitingQueue.findFirst({
        where: { establishmentId, startTime: slotStartTime },
        orderBy: [{ position: 'asc' }, { joinedAt: 'asc' }],
      });
      if (!nextInQueue) return null;

      const appointment = await tx.appointment.create({
        data: {
          startTime: slotStartTime,
          customerId: nextInQueue.customerId,
          establishmentId,
          status: 'WAITING_CONFIRMATION',
        },
      });

      await tx.waitingQueue.delete({ where: { id: nextInQueue.id } });

      // Re-number remaining entries without colliding with the slot-scoped unique index.
      const remaining = await tx.waitingQueue.findMany({
        where: { establishmentId, startTime: slotStartTime },
        orderBy: [{ position: 'asc' }, { joinedAt: 'asc' }],
      });
      if (remaining.length > 0) {
        const maxPosition = remaining.reduce(
          (max, entry) => Math.max(max, entry.position),
          0,
        );
        const offset = maxPosition + remaining.length + 1;
        for (let index = 0; index < remaining.length; index += 1) {
          await tx.waitingQueue.update({
            where: { id: remaining[index].id },
            data: { position: offset + index },
          });
        }
        for (let index = 0; index < remaining.length; index += 1) {
          await tx.waitingQueue.update({
            where: { id: remaining[index].id },
            data: { position: index + 1 },
          });
        }
      }

      return { appointment, customerId: nextInQueue.customerId };
    });

    if (!promoted) {
      this.logger.log(
        'Slot is occupied or the waitlist is empty; no promotion needed.',
      );
      return;
    }

    await this.appointmentQueue.add(
      'check-expiration',
      {
        appointmentId: promoted.appointment.id,
        customerId: promoted.customerId,
        establishmentId,
        startTime: slotStartTime.toISOString(),
      },
      { delay: 10 * 1000 },
    );

    this.queueGateway.emitQueueUpdate(promoted.customerId, {
      customerId: promoted.customerId,
      inQueue: false,
      status: 'PROMOTED',
      appointmentId: promoted.appointment.id,
      startTime: slotStartTime,
      message:
        'You have been promoted to the selected time slot. Please confirm within 10 minutes.',
      establishment: { id: establishmentId },
    });

    await this.notificationQueue.add(
      'send-promotion-alert',
      {
        customerId: promoted.customerId,
        establishmentId,
        startTime: slotStartTime,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );
  }

  private async handleExpiration(job: Job<ExpirationJobData>): Promise<void> {
    const { customerId, establishmentId } = job.data;
    // Older delayed jobs do not identify a specific appointment/slot. Ignoring
    // them is safer than allowing a stale job to cancel a newer booking.
    if (!job.data.appointmentId || !job.data.startTime) {
      this.logger.warn(
        'Ignoring legacy expiration job without appointmentId and startTime.',
      );
      return;
    }

    const appointment = await this.prisma.appointment.findUnique({
      where: { id: job.data.appointmentId },
    });

    if (!appointment) {
      this.logger.log('Appointment no longer exists; expiration is a no-op.');
      return;
    }

    // A delayed job from a previous schedule must not expire a rescheduled booking.
    if (
      (job.data.startTime &&
        appointment.startTime.toISOString() !== job.data.startTime) ||
      appointment.establishmentId !== establishmentId ||
      appointment.customerId !== customerId
    ) {
      this.logger.log(
        'Expiration job does not match the appointment current slot; skipping.',
      );
      return;
    }

    const canceled = await this.prisma.$transaction(async (tx) => {
      await lockAppointmentSlot(
        tx,
        appointment.establishmentId,
        appointment.startTime,
      );

      const current = await tx.appointment.findUnique({
        where: { id: appointment.id },
      });
      if (
        !current ||
        current.status !== 'WAITING_CONFIRMATION' ||
        current.establishmentId !== appointment.establishmentId ||
        current.startTime.getTime() !== appointment.startTime.getTime()
      ) {
        return null;
      }

      return tx.appointment.update({
        where: { id: current.id },
        data: { status: 'CANCELED' },
      });
    });

    if (!canceled) {
      this.logger.log(
        'Appointment was confirmed or changed before expiration; skipping.',
      );
      return;
    }

    this.queueGateway.emitQueueUpdate(customerId, {
      customerId,
      inQueue: false,
      status: 'CANCELED',
      message:
        'Your appointment was canceled because confirmation was not received in time.',
    });

    await this.appointmentQueue.add('process-cancellation', {
      appointmentId: canceled.id,
      establishmentId: canceled.establishmentId,
      startTime: canceled.startTime.toISOString(),
    });
  }
}
