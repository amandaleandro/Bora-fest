-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "pix_key_updated_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "instant_max_per_withdrawal_cents" INTEGER;

-- AlterTable
ALTER TABLE "payout_requests" ADD COLUMN     "anticipation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "anticipation_fee_cents" INTEGER NOT NULL DEFAULT 0;
