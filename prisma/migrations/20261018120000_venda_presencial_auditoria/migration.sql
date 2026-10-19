-- Auditoria e integridade da venda presencial (revisões de segurança e de backend).
-- 1) Quem cancelou/estornou um pedido e quando (qualquer canal): antes só ficava um log de console.
-- 2) CHECK por canal mais estrita: presencial sem cliente, com total > 0 e lancado_em; online sem os
--    campos da presencial. Aditiva para os dados que o app grava (os atuais passam na validação).
--
-- Desfazer (dentro de uma transação):
--   BEGIN;
--   ALTER TABLE "orders" DROP CONSTRAINT "orders_cancelamento_coerente", DROP CONSTRAINT "orders_canal_coerente",
--     DROP CONSTRAINT "orders_cancelado_por_id_fkey";
--   ALTER TABLE "orders" ADD CONSTRAINT "orders_canal_coerente" CHECK (
--     ("canal" = 'ONLINE' AND "user_id" IS NOT NULL AND "address_id" IS NOT NULL)
--     OR ("canal" = 'PRESENCIAL' AND "address_id" IS NULL AND "delivery_fee" = 0
--         AND "forma_pagamento" IS NOT NULL AND "status" IN ('PAGO', 'ENTREGUE', 'CANCELADO')));
--   DROP INDEX "orders_cancelado_por_id_idx";
--   ALTER TABLE "orders" DROP COLUMN "cancelado_em", DROP COLUMN "cancelado_por_id";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261018120000_venda_presencial_auditoria';
--   COMMIT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cancelado_em" TIMESTAMP(3),
ADD COLUMN     "cancelado_por_id" TEXT;

-- CreateIndex
CREATE INDEX "orders_cancelado_por_id_idx" ON "orders"("cancelado_por_id");

-- AddForeignKey: se a conta do admin sair, o registro do cancelamento fica (sem o autor).
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelado_por_id_fkey" FOREIGN KEY ("cancelado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CHECK por canal, mais estrita. NOT VALID + VALIDATE: cria sem travar a tabela e depois confere as linhas.
ALTER TABLE "orders" DROP CONSTRAINT "orders_canal_coerente";
ALTER TABLE "orders" ADD CONSTRAINT "orders_canal_coerente" CHECK (
  ("canal" = 'ONLINE' AND "user_id" IS NOT NULL AND "address_id" IS NOT NULL
     AND "registrado_por_id" IS NULL AND "lancado_em" IS NULL AND "cliente_nome" IS NULL)
  OR ("canal" = 'PRESENCIAL' AND "user_id" IS NULL AND "address_id" IS NULL AND "delivery_fee" = 0
     AND "total" > 0 AND "forma_pagamento" IS NOT NULL AND "lancado_em" IS NOT NULL
     AND "status" IN ('PAGO', 'ENTREGUE', 'CANCELADO'))
) NOT VALID;
ALTER TABLE "orders" VALIDATE CONSTRAINT "orders_canal_coerente";

-- Data de cancelamento só em pedido cancelado.
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelamento_coerente" CHECK ("cancelado_em" IS NULL OR "status" = 'CANCELADO');
