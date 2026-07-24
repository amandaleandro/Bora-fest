-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "half_price" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "reservation_items" ADD COLUMN     "half_price" BOOLEAN NOT NULL DEFAULT false;
