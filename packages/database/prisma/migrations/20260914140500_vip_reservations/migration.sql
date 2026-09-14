-- CreateEnum
CREATE TYPE "VipInventoryKind" AS ENUM ('MESA', 'CAMAROTE', 'LOUNGE', 'BISTRO', 'OUTRO');

-- CreateEnum
CREATE TYPE "VipReservationStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'REJECTED', 'CANCELED');

-- CreateTable
CREATE TABLE "vip_inventory" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "kind" "VipInventoryKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "benefits" TEXT,
    "unit_price_cents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "capacity_per_unit" INTEGER NOT NULL,
    "max_units_per_reservation" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vip_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vip_reservations" (
    "id" UUID NOT NULL,
    "public_token" TEXT NOT NULL,
    "vip_inventory_id" UUID NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "party_size" INTEGER NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "unit_price_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "status" "VipReservationStatus" NOT NULL DEFAULT 'REQUESTED',
    "customer_note" TEXT,
    "resolution_note" TEXT,
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vip_reservations_pkey" PRIMARY KEY ("id")
);

-- Business invariants live in the database too: negative/zero inventory and
-- impossible group sizes should never exist even if a caller bypasses the API.
ALTER TABLE "vip_inventory"
  ADD CONSTRAINT "vip_inventory_price_nonnegative" CHECK ("unit_price_cents" >= 0),
  ADD CONSTRAINT "vip_inventory_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "vip_inventory_capacity_positive" CHECK ("capacity_per_unit" > 0),
  ADD CONSTRAINT "vip_inventory_max_units_positive" CHECK ("max_units_per_reservation" > 0),
  ADD CONSTRAINT "vip_inventory_max_units_within_quantity" CHECK ("max_units_per_reservation" <= "quantity");

ALTER TABLE "vip_reservations"
  ADD CONSTRAINT "vip_reservations_party_size_positive" CHECK ("party_size" > 0),
  ADD CONSTRAINT "vip_reservations_units_positive" CHECK ("units" > 0),
  ADD CONSTRAINT "vip_reservations_price_nonnegative" CHECK ("unit_price_cents" >= 0),
  ADD CONSTRAINT "vip_reservations_total_nonnegative" CHECK ("total_cents" >= 0);

-- CreateIndex
CREATE UNIQUE INDEX "vip_reservations_public_token_key" ON "vip_reservations"("public_token");
CREATE INDEX "vip_inventory_event_id_active_idx" ON "vip_inventory"("event_id", "active");
CREATE INDEX "vip_reservations_vip_inventory_id_status_idx" ON "vip_reservations"("vip_inventory_id", "status");
CREATE INDEX "vip_reservations_contact_email_idx" ON "vip_reservations"("contact_email");
CREATE INDEX "vip_reservations_created_at_idx" ON "vip_reservations"("created_at");

-- AddForeignKey
ALTER TABLE "vip_inventory" ADD CONSTRAINT "vip_inventory_event_id_fkey"
FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vip_reservations" ADD CONSTRAINT "vip_reservations_vip_inventory_id_fkey"
FOREIGN KEY ("vip_inventory_id") REFERENCES "vip_inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
