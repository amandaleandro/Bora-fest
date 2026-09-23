-- Check-in facial 1:1 consentido.
-- O BoraFest armazena somente referência opaca do template no provedor;
-- nenhuma imagem facial crua entra nesta tabela.

CREATE TYPE "CheckinMethod" AS ENUM ('QR', 'FACE', 'MANUAL');
CREATE TYPE "FaceEnrollmentStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED');

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
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
