CREATE TABLE "sales_partners" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "commission_bps" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_partners_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_partner_members" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    CONSTRAINT "sales_partner_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "event_sales_partners" (
    "event_id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    CONSTRAINT "event_sales_partners_pkey" PRIMARY KEY ("event_id", "partner_id")
);

ALTER TABLE "organization_members" ADD COLUMN "sales_partner_id" UUID;
ALTER TABLE "orders" ADD COLUMN "sales_partner_id" UUID;
ALTER TABLE "orders" ADD COLUMN "sold_by_user_id" UUID;
ALTER TABLE "orders" ADD COLUMN "partner_commission_cents" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "sales_partners_organization_id_name_key" ON "sales_partners"("organization_id", "name");
CREATE INDEX "sales_partners_organization_id_idx" ON "sales_partners"("organization_id");
CREATE UNIQUE INDEX "sales_partner_members_partner_id_user_id_key" ON "sales_partner_members"("partner_id", "user_id");
CREATE INDEX "sales_partner_members_user_id_idx" ON "sales_partner_members"("user_id");
CREATE INDEX "event_sales_partners_partner_id_idx" ON "event_sales_partners"("partner_id");
CREATE INDEX "organization_members_sales_partner_id_idx" ON "organization_members"("sales_partner_id");
CREATE INDEX "orders_sales_partner_id_idx" ON "orders"("sales_partner_id");
CREATE INDEX "orders_sold_by_user_id_idx" ON "orders"("sold_by_user_id");

ALTER TABLE "sales_partners" ADD CONSTRAINT "sales_partners_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_partner_members" ADD CONSTRAINT "sales_partner_members_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "sales_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_partner_members" ADD CONSTRAINT "sales_partner_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_sales_partners" ADD CONSTRAINT "event_sales_partners_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_sales_partners" ADD CONSTRAINT "event_sales_partners_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "sales_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_sales_partner_id_fkey" FOREIGN KEY ("sales_partner_id") REFERENCES "sales_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_sales_partner_id_fkey" FOREIGN KEY ("sales_partner_id") REFERENCES "sales_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_sold_by_user_id_fkey" FOREIGN KEY ("sold_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
