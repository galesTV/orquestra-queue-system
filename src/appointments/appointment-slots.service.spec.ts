import { PrismaService } from '../prisma/prisma.service';
import { AppointmentSlotsService } from './appointment-slots.service';

describe('AppointmentSlotsService', () => {
  let service: AppointmentSlotsService;
  let prisma: any;

  const establishmentId = 'b2c3d4e5-f6a7-4890-9234-23456789abcd';
  const startTime = '2026-10-15T14:30:00.000Z';
  const establishment = { id: establishmentId, name: 'Studio' };

  beforeEach(() => {
    prisma = {
      establishment: {
        findUnique: jest.fn().mockResolvedValue(establishment),
      },
      appointmentSlot: {
        create: jest.fn().mockResolvedValue({
          id: 'slot-1',
          establishmentId,
          startTime: new Date(startTime),
        }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'slot-1', establishmentId, startTime: new Date(startTime) },
        ]),
      },
    };
    service = new AppointmentSlotsService(prisma as PrismaService);
  });

  it('creates a configured slot for an existing establishment', async () => {
    const result = await service.create({ establishmentId, startTime });

    expect(prisma.appointmentSlot.create).toHaveBeenCalledWith({
      data: { establishmentId, startTime: new Date(startTime) },
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

    await expect(service.create({ establishmentId, startTime })).rejects.toThrow(
      'Establishment not found',
    );
    expect(prisma.appointmentSlot.create).not.toHaveBeenCalled();
  });
});
