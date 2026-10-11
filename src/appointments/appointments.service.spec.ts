import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService } from './appointments.service';

describe('AppointmentsService slot integrity', () => {
  let service: AppointmentsService;
  let tx: any;
  let prisma: any;
  let queue: any;

  const establishmentId = 'b2c3d4e5-f6a7-4890-9234-23456789abcd';
  const customerId = 'a1b2c3d4-e5f6-4789-8123-123456789abc';
  const startTime = '2026-10-15T14:30:00.000Z';
  const establishment = { id: establishmentId, name: 'Studio' };

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      establishment: {
        findUnique: jest.fn().mockResolvedValue(establishment),
      },
      appointment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'appointment-1',
          startTime: new Date(startTime),
          customerId,
          establishmentId,
          status: 'WAITING_CONFIRMATION',
          establishment,
        }),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      waitingQueue: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: { data: { position: number } }) => Promise.resolve({ id: 'queue-1', position: data.position })),
      },
    };

    prisma = {
      $transaction: jest.fn((callback: (client: any) => unknown) => callback(tx)),
      appointment: {},
      waitingQueue: {},
      establishment: {},
    };
    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    service = new AppointmentsService(
      prisma as PrismaService,
      queue as Queue,
    );
  });

  it('adds a request to the selected slot waitlist when the slot is occupied', async () => {
    tx.appointment.findFirst.mockResolvedValueOnce({ id: 'occupied-appointment' });
    tx.waitingQueue.findFirst
      .mockResolvedValueOnce(null) // no duplicate request by this customer
      .mockResolvedValueOnce({ position: 2 }); // last queue entry

    const result = await service.create({ customerId, establishmentId, startTime });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.waitingQueue.create).toHaveBeenCalledWith({
      data: {
        customerId,
        establishmentId,
        startTime: new Date(startTime),
        position: 3,
      },
    });
    expect(result).toMatchObject({ inQueue: true, position: 3 });
    expect(tx.appointment.create).not.toHaveBeenCalled();
  });

  it('does not create duplicate waitlist entries for the same customer and slot', async () => {
    tx.appointment.findFirst.mockResolvedValueOnce({ id: 'occupied-appointment' });
    tx.waitingQueue.findFirst.mockResolvedValueOnce({
      id: 'queue-existing',
      position: 4,
    });

    const result = await service.create({ customerId, establishmentId, startTime });

    expect(result).toMatchObject({ inQueue: true, position: 4 });
    expect(tx.waitingQueue.create).not.toHaveBeenCalled();
  });

  it('creates a confirmation-pending appointment when the slot and its waitlist are empty', async () => {
    const result = await service.create({ customerId, establishmentId, startTime });

    expect(tx.appointment.create).toHaveBeenCalledWith({
      data: {
        startTime: new Date(startTime),
        customerId,
        establishmentId,
        status: 'WAITING_CONFIRMATION',
      },
      include: { establishment: true },
    });
    expect(queue.add).toHaveBeenCalledWith(
      'check-expiration',
      expect.objectContaining({
        appointmentId: 'appointment-1',
        customerId,
        establishmentId,
        startTime,
      }),
      { delay: 10_000 },
    );
    expect(result).toMatchObject({
      inQueue: false,
      status: 'WAITING_CONFIRMATION',
      appointmentId: 'appointment-1',
    });
  });
});
