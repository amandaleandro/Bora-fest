-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "auto_payout_min_cents" INTEGER;

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "fail_reason" TEXT;
