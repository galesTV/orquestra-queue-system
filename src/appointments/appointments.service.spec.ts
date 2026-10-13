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
      appointmentSlot: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'slot-1', isActive: true }),
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
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: { position: number } }) =>
            Promise.resolve({ id: 'queue-1', position: data.position }),
          ),
      },
    };

    prisma = {
      $transaction: jest.fn((callback: (client: any) => unknown) =>
        callback(tx),
      ),
      appointment: {},
      waitingQueue: {},
      establishment: {},
    };
    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    service = new AppointmentsService(prisma as PrismaService, queue as Queue);
  });

  it('rejects appointments in the past before accessing persistence', async () => {
    const pastStartTime = new Date(Date.now() - 60_000).toISOString();

    await expect(
      service.create({ customerId, establishmentId, startTime: pastStartTime }),
    ).rejects.toThrow('Appointments cannot be booked in the past.');

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.appointment.create).not.toHaveBeenCalled();
    expect(tx.waitingQueue.create).not.toHaveBeenCalled();
  });

  it('rejects appointments beyond the maximum booking horizon', async () => {
    const originalMaxAdvance = process.env.BOOKING_MAX_ADVANCE_DAYS;
    process.env.BOOKING_MAX_ADVANCE_DAYS = '1';

    try {
      const tooFarAhead = new Date(
        Date.now() + 2 * 24 * 60 * 60 * 1000,
      ).toISOString();

      await expect(
        service.create({ customerId, establishmentId, startTime: tooFarAhead }),
      ).rejects.toThrow(
        'Appointments cannot be booked more than 1 days in advance.',
      );

      expect(tx.appointment.create).not.toHaveBeenCalled();
      expect(tx.waitingQueue.create).not.toHaveBeenCalled();
    } finally {
      if (originalMaxAdvance === undefined)
        delete process.env.BOOKING_MAX_ADVANCE_DAYS;
      else process.env.BOOKING_MAX_ADVANCE_DAYS = originalMaxAdvance;
    }
  });

  it('rejects a booking for a time not configured in the catalog', async () => {
    tx.appointmentSlot.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.create({ customerId, establishmentId, startTime }),
    ).rejects.toThrow(
      'The requested time is not configured as an available slot for this establishment.',
    );

    expect(tx.appointment.create).not.toHaveBeenCalled();
    expect(tx.waitingQueue.create).not.toHaveBeenCalled();
  });

  it('rejects booking a configured but inactive slot', async () => {
    tx.appointmentSlot.findUnique.mockResolvedValueOnce({
      id: 'slot-1',
      isActive: false,
    });

    await expect(
      service.create({ customerId, establishmentId, startTime }),
    ).rejects.toThrow(
      'The requested appointment slot is inactive and cannot accept bookings.',
    );

    expect(tx.appointment.create).not.toHaveBeenCalled();
    expect(tx.waitingQueue.create).not.toHaveBeenCalled();
  });

  it('adds a request to the selected slot waitlist when the slot is occupied', async () => {
    tx.appointment.findFirst.mockResolvedValueOnce({
      id: 'occupied-appointment',
    });
    tx.waitingQueue.findFirst
      .mockResolvedValueOnce(null) // no duplicate request by this customer
      .mockResolvedValueOnce({ position: 2 }); // last queue entry

    const result = await service.create({
      customerId,
      establishmentId,
      startTime,
    });

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
    tx.appointment.findFirst.mockResolvedValueOnce({
      id: 'occupied-appointment',
    });
    tx.waitingQueue.findFirst.mockResolvedValueOnce({
      id: 'queue-existing',
      position: 4,
    });

    const result = await service.create({
      customerId,
      establishmentId,
      startTime,
    });

    expect(result).toMatchObject({ inQueue: true, position: 4 });
    expect(tx.waitingQueue.create).not.toHaveBeenCalled();
  });

  it('creates a confirmation-pending appointment when the slot and its waitlist are empty', async () => {
    const result = await service.create({
      customerId,
      establishmentId,
      startTime,
    });

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
