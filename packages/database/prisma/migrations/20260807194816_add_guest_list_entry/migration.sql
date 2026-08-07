-- CreateEnum
CREATE TYPE "GuestListEntryStatus" AS ENUM ('CONFIRMED', 'CHECKED_IN', 'CANCELED');

-- CreateTable
CREATE TABLE "guest_list_entries" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "ticket_lot_id" UUID NOT NULL,
    "sales_partner_id" UUID,
    "added_by_user_id" UUID NOT NULL,
    "order_id" UUID,
    "guest_name" TEXT NOT NULL,
    "guest_document" TEXT,
    "guest_phone" TEXT,
    "status" "GuestListEntryStatus" NOT NULL DEFAULT 'CONFIRMED',
    "ticket_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_list_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guest_list_entries_ticket_id_key" ON "guest_list_entries"("ticket_id");

-- CreateIndex
CREATE INDEX "guest_list_entries_event_id_status_idx" ON "guest_list_entries"("event_id", "status");

-- CreateIndex
CREATE INDEX "guest_list_entries_sales_partner_id_idx" ON "guest_list_entries"("sales_partner_id");

-- AddForeignKey
ALTER TABLE "guest_list_entries" ADD CONSTRAINT "guest_list_entries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_list_entries" ADD CONSTRAINT "guest_list_entries_ticket_lot_id_fkey" FOREIGN KEY ("ticket_lot_id") REFERENCES "ticket_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_list_entries" ADD CONSTRAINT "guest_list_entries_sales_partner_id_fkey" FOREIGN KEY ("sales_partner_id") REFERENCES "sales_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_list_entries" ADD CONSTRAINT "guest_list_entries_added_by_user_id_fkey" FOREIGN KEY ("added_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_list_entries" ADD CONSTRAINT "guest_list_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_list_entries" ADD CONSTRAINT "guest_list_entries_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

