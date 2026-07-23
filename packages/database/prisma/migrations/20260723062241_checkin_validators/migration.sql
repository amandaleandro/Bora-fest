-- CreateEnum
CREATE TYPE "ValidatorDeviceStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CheckinSource" AS ENUM ('ONLINE', 'OFFLINE_SYNC');

-- CreateEnum
CREATE TYPE "CheckinStatus" AS ENUM ('CONFIRMED', 'CONFLICT', 'REVERSED');

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "checkin_points" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkin_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validator_credentials" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validator_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validator_devices" (
    "id" UUID NOT NULL,
    "credential_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "ValidatorDeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),

    CONSTRAINT "validator_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkins" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "checkin_point_id" UUID,
    "source" "CheckinSource" NOT NULL,
    "status" "CheckinStatus" NOT NULL,
    "local_seq" INTEGER,
    "scanned_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" UUID,

    CONSTRAINT "checkins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkin_sync_batches" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "batch_key" TEXT NOT NULL,
    "item_count" INTEGER NOT NULL,
    "conflict_count" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkin_sync_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checkin_points_event_id_name_key" ON "checkin_points"("event_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "validator_credentials_event_id_label_key" ON "validator_credentials"("event_id", "label");

-- CreateIndex
CREATE INDEX "validator_devices_event_id_status_idx" ON "validator_devices"("event_id", "status");

-- CreateIndex
CREATE INDEX "checkins_event_id_received_at_idx" ON "checkins"("event_id", "received_at");

-- CreateIndex
CREATE INDEX "checkins_ticket_id_idx" ON "checkins"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkins_device_id_local_seq_key" ON "checkins"("device_id", "local_seq");

-- CreateIndex
CREATE UNIQUE INDEX "checkin_sync_batches_device_id_batch_key_key" ON "checkin_sync_batches"("device_id", "batch_key");

-- CreateIndex
CREATE INDEX "tickets_event_id_updated_at_idx" ON "tickets"("event_id", "updated_at");

-- AddForeignKey
ALTER TABLE "checkin_points" ADD CONSTRAINT "checkin_points_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validator_credentials" ADD CONSTRAINT "validator_credentials_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validator_devices" ADD CONSTRAINT "validator_devices_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "validator_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validator_devices" ADD CONSTRAINT "validator_devices_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "validator_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_checkin_point_id_fkey" FOREIGN KEY ("checkin_point_id") REFERENCES "checkin_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_sync_batches" ADD CONSTRAINT "checkin_sync_batches_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "validator_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
