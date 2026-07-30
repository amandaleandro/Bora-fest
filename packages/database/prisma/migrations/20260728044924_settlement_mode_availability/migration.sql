-- CreateEnum
CREATE TYPE "SettlementMode" AS ENUM ('STANDARD', 'INSTANT');

-- AlterEnum
ALTER TYPE "LedgerEntryType" ADD VALUE 'ANTICIPATION_FEE';

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "auto_payout" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "refund_hold_days" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "settlement_mode" "SettlementMode" NOT NULL DEFAULT 'STANDARD';

-- CreateIndex
CREATE INDEX "ledger_entries_ledger_account_id_available_at_idx" ON "ledger_entries"("ledger_account_id", "available_at");
