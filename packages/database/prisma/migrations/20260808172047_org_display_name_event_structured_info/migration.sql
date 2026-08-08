-- AlterTable
ALTER TABLE "events" ADD COLUMN     "amenities" TEXT,
ADD COLUMN     "lineup" TEXT,
ADD COLUMN     "min_age" INTEGER;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "display_name" TEXT;
