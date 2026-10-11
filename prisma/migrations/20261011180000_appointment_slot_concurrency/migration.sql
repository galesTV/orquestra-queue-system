-- Add slot identity to waitlist entries. Existing entries need explicit slot assignment
-- before this migration can be applied; silently guessing a slot would corrupt FIFO semantics.
ALTER TABLE "WaitingQueue" ADD COLUMN "startTime" TIMESTAMP(3);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "WaitingQueue" WHERE "startTime" IS NULL) THEN
    RAISE EXCEPTION 'Migration requires assigning startTime to existing WaitingQueue rows before applying the slot-scoped waitlist migration.';
  END IF;
END $$;

ALTER TABLE "WaitingQueue" ALTER COLUMN "startTime" SET NOT NULL;

DROP INDEX IF EXISTS "WaitingQueue_establishmentId_position_key";

CREATE UNIQUE INDEX "WaitingQueue_establishmentId_startTime_position_key"
  ON "WaitingQueue"("establishmentId", "startTime", "position");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Appointment"
    WHERE "status" IN ('SCHEDULED', 'WAITING_CONFIRMATION')
    GROUP BY "establishmentId", "startTime"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce unique active appointment slots: duplicate active slots exist. Resolve duplicates before applying this migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX "Appointment_active_slot_key"
  ON "Appointment"("establishmentId", "startTime")
  WHERE "status" IN ('SCHEDULED', 'WAITING_CONFIRMATION');
