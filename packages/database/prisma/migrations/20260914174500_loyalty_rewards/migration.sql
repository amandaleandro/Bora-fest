-- N9.1: catálogo de recompensas e vouchers de resgate.

CREATE TABLE "loyalty_rewards" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "points_cost" INTEGER NOT NULL,
  "quantity" INTEGER,
  "max_per_customer" INTEGER NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "loyalty_rewards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loyalty_rewards_points_cost_positive" CHECK ("points_cost" > 0),
  CONSTRAINT "loyalty_rewards_quantity_valid" CHECK ("quantity" IS NULL OR "quantity" > 0),
  CONSTRAINT "loyalty_rewards_max_per_customer_valid" CHECK ("max_per_customer" > 0)
);

CREATE TABLE "loyalty_redemptions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "reward_id" UUID NOT NULL,
  "loyalty_account_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "points_cost" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ISSUED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "used_at" TIMESTAMP(3),
  "used_by_user_id" UUID,

  CONSTRAINT "loyalty_redemptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loyalty_redemptions_points_cost_positive" CHECK ("points_cost" > 0),
  CONSTRAINT "loyalty_redemptions_status_valid" CHECK ("status" IN ('ISSUED', 'USED'))
);

CREATE INDEX "loyalty_rewards_org_active_idx"
  ON "loyalty_rewards"("organization_id", "active");
CREATE UNIQUE INDEX "loyalty_redemptions_code_key"
  ON "loyalty_redemptions"("code");
CREATE INDEX "loyalty_redemptions_reward_status_idx"
  ON "loyalty_redemptions"("reward_id", "status");
CREATE INDEX "loyalty_redemptions_account_created_idx"
  ON "loyalty_redemptions"("loyalty_account_id", "created_at");

ALTER TABLE "loyalty_rewards"
  ADD CONSTRAINT "loyalty_rewards_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "loyalty_redemptions"
  ADD CONSTRAINT "loyalty_redemptions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "loyalty_redemptions"
  ADD CONSTRAINT "loyalty_redemptions_reward_id_fkey"
  FOREIGN KEY ("reward_id") REFERENCES "loyalty_rewards"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loyalty_redemptions"
  ADD CONSTRAINT "loyalty_redemptions_loyalty_account_id_fkey"
  FOREIGN KEY ("loyalty_account_id") REFERENCES "loyalty_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loyalty_redemptions"
  ADD CONSTRAINT "loyalty_redemptions_used_by_user_id_fkey"
  FOREIGN KEY ("used_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
