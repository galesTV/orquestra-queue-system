import { PrismaService } from '../prisma/prisma.service';
import { AppointmentSlotsService } from './appointment-slots.service';

describe('AppointmentSlotsService', () => {
  let service: AppointmentSlotsService;
  let tx: any;
  let prisma: any;

  const establishmentId = 'b2c3d4e5-f6a7-4890-9234-23456789abcd';
  const startTime = new Date('2026-10-15T14:30:00.000Z');
  const nextStartTime = new Date('2026-10-15T15:00:00.000Z');
  const establishment = { id: establishmentId, name: 'Studio' };
  const slot = { id: 'slot-1', establishmentId, startTime, isActive: true };

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      appointmentSlot: {
        create: jest.fn().mockResolvedValue(slot),
        findUnique: jest.fn().mockResolvedValue(slot),
        findMany: jest.fn().mockResolvedValue([slot]),
        update: jest.fn().mockResolvedValue({ ...slot, startTime: nextStartTime }),
        delete: jest.fn().mockResolvedValue(slot),
      },
      appointment: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      waitingQueue: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    prisma = {
      $transaction: jest.fn((callback: (client: any) => unknown) => callback(tx)),
      establishment: {
        findUnique: jest.fn().mockResolvedValue(establishment),
      },
      appointmentSlot: {
        findMany: jest.fn().mockResolvedValue([slot]),
      },
    };
    service = new AppointmentSlotsService(prisma as PrismaService);
  });

  it('creates a configured slot for an existing establishment', async () => {
    const result = await service.create({
      establishmentId,
      startTime: startTime.toISOString(),
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.appointmentSlot.create).toHaveBeenCalledWith({
      data: { establishmentId, startTime },
    });
    expect(result).toMatchObject({ id: 'slot-1', establishmentId });
  });

  it('lists configured slots in chronological order', async () => {
    const result = await service.findByEstablishment(establishmentId);

    expect(prisma.appointmentSlot.findMany).toHaveBeenCalledWith({
      where: { establishmentId },
      orderBy: { startTime: 'asc' },
    });
    expect(result).toHaveLength(1);
  });

  it('rejects creating a slot for a nonexistent establishment', async () => {
    prisma.establishment.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.create({ establishmentId, startTime: startTime.toISOString() }),
    ).rejects.toThrow('Establishment not found');
    expect(tx.appointmentSlot.create).not.toHaveBeenCalled();
  });

  it('updates a slot when no appointments or queue entries depend on it', async () => {
    tx.appointmentSlot.findUnique
      .mockResolvedValueOnce(slot) // initial read
      .mockResolvedValueOnce(slot) // read after locking
      .mockResolvedValueOnce(null); // no slot already at target time

    const result = await service.update('slot-1', {
      startTime: nextStartTime.toISOString(),
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.appointment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ establishmentId, startTime }),
    }));
    expect(tx.waitingQueue.findFirst).toHaveBeenCalledWith({
      where: { establishmentId, startTime },
      select: { id: true },
    });
    expect(tx.appointmentSlot.update).toHaveBeenCalledWith({
      where: { id: 'slot-1' },
      data: { startTime: nextStartTime },
    });
    expect(result.startTime).toEqual(nextStartTime);
  });

  it('rejects updating a slot that has an active appointment', async () => {
    tx.appointmentSlot.findUnique
      .mockResolvedValueOnce(slot)
      .mockResolvedValueOnce(slot);
    tx.appointment.findFirst.mockResolvedValueOnce({ id: 'active-appointment' });

    await expect(
      service.update('slot-1', { startTime: nextStartTime.toISOString() }),
    ).rejects.toThrow('This slot cannot be changed while it has an active appointment.');

    expect(tx.appointmentSlot.update).not.toHaveBeenCalled();
  });

  it('rejects updating a slot that has waiting customers', async () => {
    tx.appointmentSlot.findUnique
      .mockResolvedValueOnce(slot)
      .mockResolvedValueOnce(slot);
    tx.waitingQueue.findFirst.mockResolvedValueOnce({ id: 'queue-entry' });

    await expect(
      service.update('slot-1', { startTime: nextStartTime.toISOString() }),
    ).rejects.toThrow('This slot cannot be changed while customers are in its waiting queue.');

    expect(tx.appointmentSlot.update).not.toHaveBeenCalled();
  });

  it('deactivates and reactivates a slot under the slot lock', async () => {
    const inactiveSlot = { ...slot, isActive: false };
    tx.appointmentSlot.findUnique
      .mockResolvedValueOnce(slot)
      .mockResolvedValueOnce(slot);
    tx.appointmentSlot.update.mockResolvedValueOnce(inactiveSlot);

    const deactivated = await service.setActive('slot-1', false);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.appointmentSlot.update).toHaveBeenCalledWith({
      where: { id: 'slot-1' },
      data: { isActive: false },
    });
    expect(deactivated.isActive).toBe(false);

    tx.appointmentSlot.findUnique
      .mockResolvedValueOnce(inactiveSlot)
      .mockResolvedValueOnce(inactiveSlot);
    tx.appointmentSlot.update.mockResolvedValueOnce(slot);

    const reactivated = await service.setActive('slot-1', true);
    expect(tx.appointmentSlot.update).toHaveBeenLastCalledWith({
      where: { id: 'slot-1' },
      data: { isActive: true },
    });
    expect(reactivated.isActive).toBe(true);
  });

  it('rejects deactivating a slot with an active appointment', async () => {
    tx.appointmentSlot.findUnique
      .mockResolvedValueOnce(slot)
      .mockResolvedValueOnce(slot);
    tx.appointment.findFirst.mockResolvedValueOnce({ id: 'active-appointment' });

    await expect(service.setActive('slot-1', false)).rejects.toThrow(
      'This slot cannot be changed while it has an active appointment.',
    );
    expect(tx.appointmentSlot.update).not.toHaveBeenCalled();
  });

  it('rejects deactivating a slot with waiting customers', async () => {
    tx.appointmentSlot.findUnique
      .mockResolvedValueOnce(slot)
      .mockResolvedValueOnce(slot);
    tx.waitingQueue.findFirst.mockResolvedValueOnce({ id: 'queue-entry' });

    await expect(service.setActive('slot-1', false)).rejects.toThrow(
      'This slot cannot be changed while customers are in its waiting queue.',
    );
    expect(tx.appointmentSlot.update).not.toHaveBeenCalled();
  });

  it('rejects changing activation for a nonexistent slot', async () => {
    tx.appointmentSlot.findUnique.mockResolvedValueOnce(null);

    await expect(service.setActive('missing-slot', false)).rejects.toThrow(
      'Appointment slot not found',
    );
  });

  it('deletes a slot only when no active appointments or queue entries depend on it', async () => {
    tx.appointmentSlot.findUnique
      .mockResolvedValueOnce(slot)
      .mockResolvedValueOnce(slot);

    const result = await service.remove('slot-1');

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.appointmentSlot.delete).toHaveBeenCalledWith({ where: { id: 'slot-1' } });
    expect(result).toEqual(slot);
  });

  it('rejects deleting a slot that has an active appointment', async () => {
    tx.appointmentSlot.findUnique
      .mockResolvedValueOnce(slot)
      .mockResolvedValueOnce(slot);
    tx.appointment.findFirst.mockResolvedValueOnce({ id: 'active-appointment' });

    await expect(service.remove('slot-1')).rejects.toThrow(
      'This slot cannot be changed while it has an active appointment.',
    );
    expect(tx.appointmentSlot.delete).not.toHaveBeenCalled();
  });

  it('rejects deleting a slot that has waiting customers', async () => {
    tx.appointmentSlot.findUnique
      .mockResolvedValueOnce(slot)
      .mockResolvedValueOnce(slot);
    tx.waitingQueue.findFirst.mockResolvedValueOnce({ id: 'queue-entry' });

    await expect(service.remove('slot-1')).rejects.toThrow(
      'This slot cannot be changed while customers are in its waiting queue.',
    );
    expect(tx.appointmentSlot.delete).not.toHaveBeenCalled();
  });

  it('rejects updating a nonexistent slot', async () => {
    tx.appointmentSlot.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.update('missing-slot', { startTime: nextStartTime.toISOString() }),
    ).rejects.toThrow('Appointment slot not found');
  });

  it('rejects deleting a nonexistent slot', async () => {
    tx.appointmentSlot.findUnique.mockResolvedValueOnce(null);

    await expect(service.remove('missing-slot')).rejects.toThrow(
      'Appointment slot not found',
    );
  });
});
