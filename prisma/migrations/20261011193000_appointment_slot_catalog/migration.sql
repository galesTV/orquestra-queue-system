-- Explicit catalog of appointment start times offered by each establishment.
CREATE TABLE "AppointmentSlot" (
    "id" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "establishmentId" TEXT NOT NULL,
    CONSTRAINT "AppointmentSlot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppointmentSlot_establishmentId_startTime_key"
  ON "AppointmentSlot"("establishmentId", "startTime");

ALTER TABLE "AppointmentSlot"
  ADD CONSTRAINT "AppointmentSlot_establishmentId_fkey"
  FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
