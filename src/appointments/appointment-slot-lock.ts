import { Prisma } from '@prisma/client';

/**
 * Serializes operations targeting the same establishment and exact time slot.
 * The lock is held by PostgreSQL until the surrounding transaction completes,
 * so it works across multiple API instances and worker processes.
 */
export async function lockAppointmentSlot(
  tx: Prisma.TransactionClient,
  establishmentId: string,
  startTime: Date,
): Promise<void> {
  const slotKey = `${establishmentId}:${startTime.toISOString()}`;

  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${slotKey}, 0))
  `;
}
