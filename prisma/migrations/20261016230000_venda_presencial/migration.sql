-- Venda presencial (feira, balcão): pedido lançado pelo admin, sem cliente cadastrado nem entrega.
-- Aditiva: pedidos existentes viram canal ONLINE e continuam exatamente como estão.
--
-- Desfazer. O SET NOT NULL falha se houver venda presencial, então apague ou arquive essas linhas antes:
--   DELETE FROM "orders" WHERE "canal" = 'PRESENCIAL';   -- os itens saem junto (ON DELETE CASCADE)
--   ALTER TABLE "orders" DROP CONSTRAINT "orders_canal_coerente", DROP CONSTRAINT "orders_registrado_por_id_fkey";
--   DROP INDEX "orders_registrado_por_id_idempotency_key_key"; DROP INDEX "orders_canal_created_at_idx";
--   ALTER TABLE "orders" ALTER COLUMN "user_id" SET NOT NULL, ALTER COLUMN "address_id" SET NOT NULL,
--     DROP COLUMN "canal", DROP COLUMN "cliente_nome", DROP COLUMN "forma_pagamento",
--     DROP COLUMN "observacao", DROP COLUMN "registrado_por_id", DROP COLUMN "lancado_em";
--   DROP TYPE "OrderChannel"; DROP TYPE "PaymentMethod";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261016230000_venda_presencial';

-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('ONLINE', 'PRESENCIAL');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PIX', 'DINHEIRO', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'OUTRO');

-- AlterTable: cliente e endereço passam a ser opcionais (só para a venda presencial; ver o CHECK abaixo).
ALTER TABLE "orders" ADD COLUMN     "canal" "OrderChannel" NOT NULL DEFAULT 'ONLINE',
ADD COLUMN     "cliente_nome" VARCHAR(100),
ADD COLUMN     "forma_pagamento" "PaymentMethod",
ADD COLUMN     "lancado_em" TIMESTAMP(3),
ADD COLUMN     "observacao" VARCHAR(300),
ADD COLUMN     "registrado_por_id" TEXT,
ALTER COLUMN "user_id" DROP NOT NULL,
ALTER COLUMN "address_id" DROP NOT NULL;

-- CreateIndex: filtro por canal na lista do admin.
CREATE INDEX "orders_canal_created_at_idx" ON "orders"("canal", "created_at");

-- CreateIndex: Idempotency-Key da venda presencial, por admin (NULL pode repetir). Serve também de índice da FK.
CREATE UNIQUE INDEX "orders_registrado_por_id_idempotency_key_key" ON "orders"("registrado_por_id", "idempotency_key");

-- AddForeignKey: auditoria de quem lançou; se a conta do admin sair, a venda fica no histórico.
ALTER TABLE "orders" ADD CONSTRAINT "orders_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Integridade por canal. ONLINE: cliente e endereço obrigatórios (como antes). PRESENCIAL: sem endereço
-- nem frete, com forma de pagamento, e só os status que a venda presencial usa (nasce paga ou entregue).
ALTER TABLE "orders" ADD CONSTRAINT "orders_canal_coerente" CHECK (
  ("canal" = 'ONLINE' AND "user_id" IS NOT NULL AND "address_id" IS NOT NULL)
  OR ("canal" = 'PRESENCIAL' AND "address_id" IS NULL AND "delivery_fee" = 0
      AND "forma_pagamento" IS NOT NULL AND "status" IN ('PAGO', 'ENTREGUE', 'CANCELADO'))
);
