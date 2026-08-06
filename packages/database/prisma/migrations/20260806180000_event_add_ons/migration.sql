-- CreateTable
CREATE TABLE "event_add_ons" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_cents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "event_add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_add_on_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "add_on_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    CONSTRAINT "order_add_on_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_add_ons_event_id_idx" ON "event_add_ons"("event_id");
CREATE INDEX "order_add_on_items_order_id_idx" ON "order_add_on_items"("order_id");

-- AddForeignKey
ALTER TABLE "event_add_ons" ADD CONSTRAINT "event_add_ons_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_add_on_items" ADD CONSTRAINT "order_add_on_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_add_on_items" ADD CONSTRAINT "order_add_on_items_add_on_id_fkey" FOREIGN KEY ("add_on_id") REFERENCES "event_add_ons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
