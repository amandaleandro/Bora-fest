-- BF-022 — fundação do check-in facial.
-- Não armazena foto nem embedding facial bruto no BoraFest.
-- O vínculo biométrico fica por ingresso e expira após janela curta.

ALTER TYPE "CheckinSource" ADD VALUE IF NOT EXISTS 'ONLINE';

CREATE TYPE "CheckinMethod" AS ENUM ('QR', 'FACE', 'MANUAL');
CREATE TYPE "FaceEnrollmentStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED');

ALTER TABLE "events"
ADD COLUMN "face_checkin_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "face_retention_hours" INTEGER NOT NULL DEFAULT 24;

ALTER TABLE "checkins"
ADD COLUMN "method" "CheckinMethod" NOT NULL DEFAULT 'QR';

CREATE TABLE "ticket_face_enrollments" (
  "id" UUID NOT NULL,
  "ticket_id" UUID NOT NULL,
  "status" "FaceEnrollmentStatus" NOT NULL DEFAULT 'PENDING',
  "provider" TEXT NOT NULL,
  "provider_reference" TEXT,
  "consent_version" TEXT NOT NULL,
  "consented_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ticket_face_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ticket_face_enrollments_ticket_id_key"
ON "ticket_face_enrollments"("ticket_id");

CREATE INDEX "ticket_face_enrollments_status_expires_at_idx"
ON "ticket_face_enrollments"("status", "expires_at");

ALTER TABLE "ticket_face_enrollments"
ADD CONSTRAINT "ticket_face_enrollments_ticket_id_fkey"
FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "events"
ADD CONSTRAINT "events_face_retention_hours_range"
CHECK ("face_retention_hours" BETWEEN 1 AND 168);
