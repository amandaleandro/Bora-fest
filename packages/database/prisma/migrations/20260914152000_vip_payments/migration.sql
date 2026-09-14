-- N8.1: sinal/pagamento de reservas VIP sem acoplar ao Order/Ticket.

ALTER TABLE "vip_reservations"
  ADD COLUMN "deposit_cents" INTEGER,
  ADD COLUMN "payment_due_at" TIMESTAMP(3);

ALTER TABLE "vip_reservations"
  ADD CONSTRAINT "vip_reservations_deposit_valid"
  CHECK (
    "deposit_cents" IS NULL OR
    ("deposit_cents" > 0 AND "deposit_cents" <= "total_cents")
  );

CREATE TABLE "vip_payments" (
  "id" UUID NOT NULL,
  "vip_reservation_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "method" "PaymentMethod" NOT NULL DEFAULT 'PIX',
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amount_cents" INTEGER NOT NULL,
  "external_id" TEXT,
  "pix_qr_code_text" TEXT,
  "fail_reason" TEXT,
  "expires_at" TIMESTAMP(3),
  "paid_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vip_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vip_payments_amount_positive" CHECK ("amount_cents" > 0)
);

CREATE TABLE "vip_payment_events" (
  "id" UUID NOT NULL,
  "vip_payment_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "external_event_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vip_payment_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vip_payments_provider_external_id_key"
  ON "vip_payments"("provider", "external_id");
CREATE INDEX "vip_payments_reservation_status_idx"
  ON "vip_payments"("vip_reservation_id", "status");
CREATE INDEX "vip_payments_status_expires_at_idx"
  ON "vip_payments"("status", "expires_at");
CREATE UNIQUE INDEX "vip_payment_events_provider_external_event_id_key"
  ON "vip_payment_events"("provider", "external_event_id");
CREATE INDEX "vip_payment_events_payment_id_idx"
  ON "vip_payment_events"("vip_payment_id");

ALTER TABLE "vip_payments"
  ADD CONSTRAINT "vip_payments_vip_reservation_id_fkey"
  FOREIGN KEY ("vip_reservation_id") REFERENCES "vip_reservations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vip_payment_events"
  ADD CONSTRAINT "vip_payment_events_vip_payment_id_fkey"
  FOREIGN KEY ("vip_payment_id") REFERENCES "vip_payments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
