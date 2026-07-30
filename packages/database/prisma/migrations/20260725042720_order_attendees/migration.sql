-- CreateTable
CREATE TABLE "order_attendees" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "ticket_lot_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cpf" TEXT,

    CONSTRAINT "order_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_attendees_order_id_idx" ON "order_attendees"("order_id");

-- AddForeignKey
ALTER TABLE "order_attendees" ADD CONSTRAINT "order_attendees_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
