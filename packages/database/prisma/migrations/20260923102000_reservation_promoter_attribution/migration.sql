-- Congela a atribuição que liberou a reserva durante a janela de checkout.
-- Evita trocar promoter/vendedor entre reserva e pedido, especialmente em promoterOnly.

ALTER TABLE "reservations"
ADD COLUMN "promoter_link_id" UUID,
ADD COLUMN "promoter_seller_id" UUID;

ALTER TABLE "reservations"
ADD CONSTRAINT "reservations_promoter_link_id_fkey"
FOREIGN KEY ("promoter_link_id") REFERENCES "promoter_links"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "reservations"
ADD CONSTRAINT "reservations_promoter_seller_id_fkey"
FOREIGN KEY ("promoter_seller_id") REFERENCES "promoter_sellers"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "reservations_promoter_link_id_idx" ON "reservations"("promoter_link_id");
CREATE INDEX "reservations_promoter_seller_id_idx" ON "reservations"("promoter_seller_id");
