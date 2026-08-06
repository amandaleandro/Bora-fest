-- AlterTable
ALTER TABLE "venues" ADD COLUMN     "maps_url" TEXT,
ALTER COLUMN "address" DROP NOT NULL;
