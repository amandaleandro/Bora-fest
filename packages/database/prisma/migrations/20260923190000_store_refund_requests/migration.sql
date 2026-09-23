CREATE TYPE "StoreRefundRequestStatus" AS ENUM (
  'PENDING','AWAITING_RETURN','APPROVED','REJECTED'
);

CREATE TABLE "store_refund_requests" (
  "id" UUID NOT NULL,
  "store_order_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "StoreRefundRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "returned_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "resolved_by_user_id" UUID,
  "resolution_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_refund_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "store_refund_requests_store_order_id_idx"
  ON "store_refund_requests"("store_order_id");
CREATE INDEX "store_refund_requests_status_idx"
  ON "store_refund_requests"("status");

ALTER TABLE "store_refund_requests"
  ADD CONSTRAINT "store_refund_requests_store_order_id_fkey"
  FOREIGN KEY ("store_order_id") REFERENCES "store_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
