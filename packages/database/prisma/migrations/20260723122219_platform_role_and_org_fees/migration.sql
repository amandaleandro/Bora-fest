-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPPORT', 'ADMIN');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "card_fee_bps" INTEGER,
ADD COLUMN     "pix_fee_bps" INTEGER,
ADD COLUMN     "pix_fee_floor_cents" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "platform_role" "PlatformRole";
