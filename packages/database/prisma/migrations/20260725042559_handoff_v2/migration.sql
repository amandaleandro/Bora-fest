-- CreateEnum
CREATE TYPE "FeeMode" AS ENUM ('BUYER', 'PRODUCER');

-- CreateEnum
CREATE TYPE "PayoutRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "ticket_lots" ADD COLUMN     "fee_mode" "FeeMode" NOT NULL DEFAULT 'BUYER',
ADD COLUMN     "nominal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requires_cpf" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "attendee_cpf" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notify_email_offers" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notify_whatsapp" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "order_id" UUID,
    "document" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "PayoutRequestStatus" NOT NULL DEFAULT 'PENDING',
    "bank_account_id" UUID,
    "payout_id" UUID,
    "notes" TEXT,
    "requested_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "payout_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consents_order_id_idx" ON "consents"("order_id");

-- CreateIndex
CREATE INDEX "consents_user_id_idx" ON "consents"("user_id");

-- CreateIndex
CREATE INDEX "payout_requests_organization_id_status_idx" ON "payout_requests"("organization_id", "status");

-- AddForeignKey
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
