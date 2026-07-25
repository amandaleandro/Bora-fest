-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
