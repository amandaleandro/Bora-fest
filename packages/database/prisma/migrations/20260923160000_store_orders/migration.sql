CREATE TYPE "StoreOrderStatus" AS ENUM (
  'CREATED','PAYMENT_PENDING','PAID','READY','FULFILLED','CANCELED','REFUNDED','CHARGEBACK'
);
CREATE TYPE "StoreFulfillmentMethod" AS ENUM ('PICKUP');

CREATE TABLE "store_orders" (
  "id" UUID NOT NULL,
  "public_token" TEXT NOT NULL,
  "organization_id" UUID NOT NULL,
  "user_id" UUID,
  "status" "StoreOrderStatus" NOT NULL DEFAULT 'CREATED',
  "fulfillment_method" "StoreFulfillmentMethod" NOT NULL DEFAULT 'PICKUP',
  "pickup_code" TEXT NOT NULL,
  "contact_name" TEXT NOT NULL,
  "contact_email" TEXT NOT NULL,
  "contact_phone" TEXT,
  "total_cents" INTEGER NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "paid_at" TIMESTAMP(3),
  "fulfilled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "store_order_items" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  "product_name" TEXT NOT NULL,
  "variant_name" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "price_cents" INTEGER NOT NULL,
  CONSTRAINT "store_order_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "store_payments" (
  "id" UUID NOT NULL,
  "store_order_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amount_cents" INTEGER NOT NULL,
  "external_id" TEXT,
  "pix_qr_code_text" TEXT,
  "fail_reason" TEXT,
  "expires_at" TIMESTAMP(3),
  "paid_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "store_payment_events" (
  "id" UUID NOT NULL,
  "store_payment_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "external_event_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_payment_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_orders_public_token_key" ON "store_orders"("public_token");
CREATE UNIQUE INDEX "store_orders_pickup_code_key" ON "store_orders"("pickup_code");
CREATE INDEX "store_orders_organization_id_status_idx" ON "store_orders"("organization_id","status");
CREATE INDEX "store_orders_contact_email_idx" ON "store_orders"("contact_email");
CREATE INDEX "store_orders_expires_at_status_idx" ON "store_orders"("expires_at","status");
CREATE INDEX "store_order_items_order_id_idx" ON "store_order_items"("order_id");
CREATE INDEX "store_order_items_variant_id_idx" ON "store_order_items"("variant_id");
CREATE UNIQUE INDEX "store_payments_provider_external_id_key" ON "store_payments"("provider","external_id");
CREATE INDEX "store_payments_store_order_id_idx" ON "store_payments"("store_order_id");
CREATE INDEX "store_payments_status_expires_at_idx" ON "store_payments"("status","expires_at");
CREATE UNIQUE INDEX "store_payment_events_provider_external_event_id_key" ON "store_payment_events"("provider","external_event_id");
CREATE INDEX "store_payment_events_store_payment_id_idx" ON "store_payment_events"("store_payment_id");

ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "store_order_items" ADD CONSTRAINT "store_order_items_order_id_fkey"
FOREIGN KEY ("order_id") REFERENCES "store_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_order_items" ADD CONSTRAINT "store_order_items_variant_id_fkey"
FOREIGN KEY ("variant_id") REFERENCES "store_product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "store_payments" ADD CONSTRAINT "store_payments_store_order_id_fkey"
FOREIGN KEY ("store_order_id") REFERENCES "store_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_payment_events" ADD CONSTRAINT "store_payment_events_store_payment_id_fkey"
FOREIGN KEY ("store_payment_id") REFERENCES "store_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_total_nonnegative_chk" CHECK ("total_cents" >= 0);
ALTER TABLE "store_order_items" ADD CONSTRAINT "store_order_items_quantity_positive_chk" CHECK ("quantity" > 0);
ALTER TABLE "store_order_items" ADD CONSTRAINT "store_order_items_price_nonnegative_chk" CHECK ("price_cents" >= 0);
