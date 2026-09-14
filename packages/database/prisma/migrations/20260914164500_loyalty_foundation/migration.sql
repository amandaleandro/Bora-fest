-- N9: fidelidade por Casa com ledger imutável de pontos.

CREATE TABLE "loyalty_programs" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "points_per_real" INTEGER NOT NULL DEFAULT 1,
  "silver_points" INTEGER NOT NULL DEFAULT 500,
  "gold_points" INTEGER NOT NULL DEFAULT 1500,
  "platinum_points" INTEGER NOT NULL DEFAULT 3000,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loyalty_programs_points_per_real_nonnegative" CHECK ("points_per_real" >= 0),
  CONSTRAINT "loyalty_programs_tiers_valid" CHECK (
    "silver_points" >= 0 AND
    "gold_points" >= "silver_points" AND
    "platinum_points" >= "gold_points"
  )
);

CREATE TABLE "loyalty_accounts" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "email_key" TEXT NOT NULL,
  "user_id" UUID,
  "display_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "loyalty_entries" (
  "id" UUID NOT NULL,
  "loyalty_account_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "delta_points" INTEGER NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" UUID NOT NULL,
  "description" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "loyalty_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loyalty_entries_delta_nonzero" CHECK ("delta_points" <> 0),
  CONSTRAINT "loyalty_entries_source_type_valid" CHECK (
    "source_type" IN ('ORDER_EARN', 'ORDER_REVERSAL', 'CHECKIN_BONUS', 'REWARD_REDEEM', 'ADJUSTMENT')
  )
);

CREATE UNIQUE INDEX "loyalty_programs_organization_id_key"
  ON "loyalty_programs"("organization_id");
CREATE UNIQUE INDEX "loyalty_accounts_organization_email_key"
  ON "loyalty_accounts"("organization_id", "email_key");
CREATE INDEX "loyalty_accounts_organization_user_idx"
  ON "loyalty_accounts"("organization_id", "user_id");
CREATE UNIQUE INDEX "loyalty_entries_source_key"
  ON "loyalty_entries"("organization_id", "source_type", "source_id");
CREATE INDEX "loyalty_entries_account_created_idx"
  ON "loyalty_entries"("loyalty_account_id", "created_at");

ALTER TABLE "loyalty_programs"
  ADD CONSTRAINT "loyalty_programs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "loyalty_accounts"
  ADD CONSTRAINT "loyalty_accounts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "loyalty_accounts"
  ADD CONSTRAINT "loyalty_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "loyalty_entries"
  ADD CONSTRAINT "loyalty_entries_loyalty_account_id_fkey"
  FOREIGN KEY ("loyalty_account_id") REFERENCES "loyalty_accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "loyalty_entries"
  ADD CONSTRAINT "loyalty_entries_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
