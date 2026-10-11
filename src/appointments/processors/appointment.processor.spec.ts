import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueGateway } from '../gateways/queue.gateway';
import { AppointmentsProcessor } from './appointment.processor';

describe('AppointmentsProcessor slot promotion', () => {
  let processor: AppointmentsProcessor;
  let tx: any;
  let prisma: any;
  let notificationQueue: any;
  let appointmentQueue: any;
  let gateway: any;

  const establishmentId = 'b2c3d4e5-f6a7-4890-9234-23456789abcd';
  const customerId = 'a1b2c3d4-e5f6-4789-8123-123456789abc';
  const startTime = new Date('2026-10-15T14:30:00.000Z');

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      appointment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'promoted-appointment',
          startTime,
          customerId,
          establishmentId,
          status: 'WAITING_CONFIRMATION',
        }),
      },
      appointmentSlot: {
        findUnique: jest.fn().mockResolvedValue({ id: 'slot-1', isActive: true }),
      },
      waitingQueue: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'queue-entry-1',
          customerId,
          establishmentId,
          startTime,
          position: 1,
        }),
        delete: jest.fn().mockResolvedValue({ id: 'queue-entry-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };

    prisma = {
      $transaction: jest.fn((callback: (client: any) => unknown) => callback(tx)),
      appointment: {},
      waitingQueue: {},
    };
    notificationQueue = { add: jest.fn().mockResolvedValue({ id: 'notification-1' }) };
    appointmentQueue = { add: jest.fn().mockResolvedValue({ id: 'expiration-1' }) };
    gateway = { emitQueueUpdate: jest.fn() };

    processor = new AppointmentsProcessor(
      prisma as PrismaService,
      notificationQueue as Queue,
      appointmentQueue as Queue,
      gateway as QueueGateway,
    );
  });

  it('promotes the first customer for the released exact slot', async () => {
    const job = {
      id: 'cancel-job',
      name: 'process-cancellation',
      data: { establishmentId, startTime: startTime.toISOString() },
    } as any;

    await processor.process(job);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.appointment.create).toHaveBeenCalledWith({
      data: {
        startTime,
        customerId,
        establishmentId,
        status: 'WAITING_CONFIRMATION',
      },
    });
    expect(tx.waitingQueue.delete).toHaveBeenCalledWith({
      where: { id: 'queue-entry-1' },
    });
    expect(appointmentQueue.add).toHaveBeenCalledWith(
      'check-expiration',
      expect.objectContaining({
        appointmentId: 'promoted-appointment',
        customerId,
        establishmentId,
        startTime: startTime.toISOString(),
      }),
      { delay: 10_000 },
    );
    expect(gateway.emitQueueUpdate).toHaveBeenCalledWith(
      customerId,
      expect.objectContaining({ status: 'PROMOTED' }),
    );
  });

  it('does not promote customers when the slot is inactive', async () => {
    tx.appointmentSlot.findUnique.mockResolvedValueOnce({ id: 'slot-1', isActive: false });
    const job = {
      id: 'cancel-job',
      name: 'process-cancellation',
      data: { establishmentId, startTime: startTime.toISOString() },
    } as any;

    await processor.process(job);

    expect(tx.appointment.create).not.toHaveBeenCalled();
    expect(tx.waitingQueue.delete).not.toHaveBeenCalled();
    expect(appointmentQueue.add).not.toHaveBeenCalled();
    expect(gateway.emitQueueUpdate).not.toHaveBeenCalled();
  });

  it('does not promote anyone when the slot is already occupied', async () => {
    tx.appointment.findFirst.mockResolvedValueOnce({ id: 'still-active' });
    const job = {
      id: 'cancel-job',
      name: 'process-cancellation',
      data: { establishmentId, startTime: startTime.toISOString() },
    } as any;

    await processor.process(job);

    expect(tx.appointment.create).not.toHaveBeenCalled();
    expect(tx.waitingQueue.delete).not.toHaveBeenCalled();
    expect(appointmentQueue.add).not.toHaveBeenCalled();
  });
});
