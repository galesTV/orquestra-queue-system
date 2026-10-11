-- Slot assignment cannot be inferred safely for existing waitlist entries.
-- Fail before changing the schema so operators can explicitly migrate that data.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "WaitingQueue") THEN
    RAISE EXCEPTION 'Cannot add slot-scoped waitlist semantics while WaitingQueue contains rows. Assign each row a real startTime in a reviewed data migration first.';
  END IF;

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

ALTER TABLE "WaitingQueue" ADD COLUMN "startTime" TIMESTAMP(3) NOT NULL;

DROP INDEX IF EXISTS "WaitingQueue_establishmentId_position_key";

CREATE UNIQUE INDEX "WaitingQueue_establishmentId_startTime_position_key"
  ON "WaitingQueue"("establishmentId", "startTime", "position");

CREATE UNIQUE INDEX "Appointment_active_slot_key"
  ON "Appointment"("establishmentId", "startTime")
  WHERE "status" IN ('SCHEDULED', 'WAITING_CONFIRMATION');
