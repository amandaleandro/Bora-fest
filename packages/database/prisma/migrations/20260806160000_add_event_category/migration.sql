-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM ('SHOWS', 'FESTAS', 'ESPORTES', 'TEATRO');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "category" "EventCategory";

-- CreateIndex
CREATE INDEX "events_category_idx" ON "events"("category");
