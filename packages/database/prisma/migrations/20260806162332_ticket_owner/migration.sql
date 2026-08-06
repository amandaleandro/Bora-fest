-- DropIndex
DROP INDEX "orders_sold_by_user_id_idx";

-- DropIndex
DROP INDEX "organization_members_sales_partner_id_idx";

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "owner_user_id" UUID;
