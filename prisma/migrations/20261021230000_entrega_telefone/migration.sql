-- Entrega em Teresina ou retirada na loja, e o WhatsApp da cliente (decisões da dona, 2026-10-21).
-- 1) orders.modo_entrega: ENTREGA (com endereço) ou RETIRADA (sem endereço e sem frete); NULL só na
--    venda presencial. Os pedidos online que já existem viram ENTREGA (todos têm endereço).
-- 2) orders.telefone e users.telefone: só dígitos, com DDD (10 ou 11). NULL nos pedidos antigos.
-- 3) config_loja: uma linha (id = 1) com a taxa fixa de entrega, editável no painel.
-- 4) orders_canal_coerente refeita para aceitar o pedido online de retirada.
--
-- Desfazer (dentro de uma transação; antes, nenhum pedido de RETIRADA pode existir, porque a CHECK
-- antiga exige endereço em todo pedido online):
--   BEGIN;
--   ALTER TABLE "orders" DROP CONSTRAINT "orders_canal_coerente";
--   ALTER TABLE "orders" ADD CONSTRAINT "orders_canal_coerente" CHECK (
--     ("canal" = 'ONLINE' AND "user_id" IS NOT NULL AND "address_id" IS NOT NULL
--        AND "registrado_por_id" IS NULL AND "lancado_em" IS NULL AND "cliente_nome" IS NULL)
--     OR ("canal" = 'PRESENCIAL' AND "user_id" IS NULL AND "address_id" IS NULL AND "delivery_fee" = 0
--        AND "total" > 0 AND "forma_pagamento" IS NOT NULL AND "lancado_em" IS NOT NULL
--        AND "status" IN ('PAGO', 'ENTREGUE', 'CANCELADO')));
--   ALTER TABLE "orders" DROP CONSTRAINT "orders_telefone_formato", DROP COLUMN "modo_entrega", DROP COLUMN "telefone";
--   ALTER TABLE "users" DROP CONSTRAINT "users_telefone_formato", DROP COLUMN "telefone";
--   DROP TABLE "config_loja";
--   DROP TYPE "ModoEntrega";   -- só se o ramo das lembrancinhas não estiver aplicado (ele usa o mesmo tipo)
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261021230000_entrega_telefone';
--   COMMIT;

-- CreateEnum. Guarda: no banco local com o ramo das lembrancinhas aplicado, o tipo já existe (mesmo
-- nome e mesmos valores).
DO $$ BEGIN
  CREATE TYPE "ModoEntrega" AS ENUM ('RETIRADA', 'ENTREGA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "modo_entrega" "ModoEntrega",
ADD COLUMN     "telefone" VARCHAR(11);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "telefone" VARCHAR(11);

-- Pedidos online de antes desta versão: todos têm endereço, então são de entrega.
UPDATE "orders" SET "modo_entrega" = 'ENTREGA' WHERE "canal" = 'ONLINE';

-- Telefone brasileiro com DDD (sem zero), só dígitos: celular com 9 (11 dígitos) ou fixo de 2 a 5
-- (10 dígitos). A mesma regra de telefoneValido (src/lib/entrega-regras.ts).
ALTER TABLE "orders" ADD CONSTRAINT "orders_telefone_formato"
  CHECK ("telefone" IS NULL OR "telefone" ~ '^[1-9]{2}(9[0-9]{8}|[2-5][0-9]{7})$');
ALTER TABLE "users" ADD CONSTRAINT "users_telefone_formato"
  CHECK ("telefone" IS NULL OR "telefone" ~ '^[1-9]{2}(9[0-9]{8}|[2-5][0-9]{7})$');

-- CHECK por canal: o online de ENTREGA tem endereço; o de RETIRADA não tem endereço nem frete; a
-- venda presencial não tem modo de entrega nem telefone. NOT VALID + VALIDATE: cria sem travar a
-- tabela e depois confere as linhas.
ALTER TABLE "orders" DROP CONSTRAINT "orders_canal_coerente";
ALTER TABLE "orders" ADD CONSTRAINT "orders_canal_coerente" CHECK (
  ("canal" = 'ONLINE' AND "user_id" IS NOT NULL
     AND "registrado_por_id" IS NULL AND "lancado_em" IS NULL AND "cliente_nome" IS NULL
     AND (("modo_entrega" = 'ENTREGA' AND "address_id" IS NOT NULL)
       OR ("modo_entrega" = 'RETIRADA' AND "address_id" IS NULL AND "delivery_fee" = 0)))
  OR ("canal" = 'PRESENCIAL' AND "user_id" IS NULL AND "address_id" IS NULL AND "delivery_fee" = 0
     AND "modo_entrega" IS NULL AND "telefone" IS NULL
     AND "total" > 0 AND "forma_pagamento" IS NOT NULL AND "lancado_em" IS NOT NULL
     AND "status" IN ('PAGO', 'ENTREGUE', 'CANCELADO'))
) NOT VALID;
ALTER TABLE "orders" VALIDATE CONSTRAINT "orders_canal_coerente";

-- CreateTable
CREATE TABLE "config_loja" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "taxa_entrega_centavos" INTEGER NOT NULL DEFAULT 1500,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_por_id" TEXT,

    CONSTRAINT "config_loja_pkey" PRIMARY KEY ("id"),
    -- Uma linha só, e a taxa nos limites do painel (MAX_TAXA_ENTREGA_CENTAVOS).
    CONSTRAINT "config_loja_uma_linha" CHECK ("id" = 1),
    CONSTRAINT "config_loja_taxa_valida" CHECK ("taxa_entrega_centavos" BETWEEN 0 AND 10000)
);

-- CreateIndex
CREATE INDEX "config_loja_atualizado_por_id_idx" ON "config_loja"("atualizado_por_id");

-- AddForeignKey
ALTER TABLE "config_loja" ADD CONSTRAINT "config_loja_atualizado_por_id_fkey" FOREIGN KEY ("atualizado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A linha da configuração, com a taxa decidida pela dona (R$ 15,00).
INSERT INTO "config_loja" ("id", "taxa_entrega_centavos") VALUES (1, 1500) ON CONFLICT ("id") DO NOTHING;
