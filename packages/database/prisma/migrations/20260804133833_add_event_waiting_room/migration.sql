-- AlterTable
ALTER TABLE "events" ADD COLUMN     "waiting_room_concurrency" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN     "waiting_room_enabled" BOOLEAN NOT NULL DEFAULT false;
