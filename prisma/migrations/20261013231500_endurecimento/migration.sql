-- Endurecimento: idempotência de pedidos, índices de consulta e restrições de integridade.

-- AlterTable: chave de idempotência (Idempotency-Key) por usuário.
ALTER TABLE "orders" ADD COLUMN     "idempotency_key" TEXT;

-- CreateIndex
CREATE INDEX "orders_address_id_idx" ON "orders"("address_id");

-- CreateIndex: a listagem "Todos" do admin ordena por created_at.
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex: NULL pode repetir; uma chave preenchida só vale uma vez por usuário.
CREATE UNIQUE INDEX "orders_user_id_idempotency_key_key" ON "orders"("user_id", "idempotency_key");

-- Restrições de integridade (o Prisma não as modela; ficam só no banco).
ALTER TABLE "products"    ADD CONSTRAINT "products_preco_nao_negativo"      CHECK ("preco" >= 0);
ALTER TABLE "products"    ADD CONSTRAINT "products_peso_nao_negativo"       CHECK ("peso_gramas" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantidade_positiva"  CHECK ("quantidade" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_preco_nao_negativo"   CHECK ("preco_unitario" >= 0);
ALTER TABLE "orders"      ADD CONSTRAINT "orders_total_cobre_frete"         CHECK ("delivery_fee" >= 0 AND "total" >= "delivery_fee");

-- Reversão manual (o Prisma não gera "down"):
--   ALTER TABLE "orders" DROP CONSTRAINT "orders_total_cobre_frete";
--   ALTER TABLE "order_items" DROP CONSTRAINT "order_items_preco_nao_negativo", DROP CONSTRAINT "order_items_quantidade_positiva";
--   ALTER TABLE "products" DROP CONSTRAINT "products_peso_nao_negativo", DROP CONSTRAINT "products_preco_nao_negativo";
--   DROP INDEX "orders_user_id_idempotency_key_key"; DROP INDEX "orders_created_at_idx"; DROP INDEX "orders_address_id_idx";
--   ALTER TABLE "orders" DROP COLUMN "idempotency_key";
