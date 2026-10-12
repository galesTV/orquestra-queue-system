CREATE TABLE "EstablishmentUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "establishmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EstablishmentUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EstablishmentUser_email_key" ON "EstablishmentUser"("email");
CREATE UNIQUE INDEX "EstablishmentUser_establishmentId_key" ON "EstablishmentUser"("establishmentId");

ALTER TABLE "EstablishmentUser"
ADD CONSTRAINT "EstablishmentUser_establishmentId_fkey"
FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
