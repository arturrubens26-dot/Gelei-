-- Planilha financeira (/admin/planilha): categorias editáveis, entradas manuais, saldo inicial, importações e
-- auditoria das alterações financeiras.
--
-- ADITIVA: só tabelas novas e colunas novas NULAS ou com DEFAULT em `expenses`. O código antigo continua
-- funcionando com ela (pode ir para a produção antes do deploy, como sempre). As despesas que já existem ganham
-- `categoria_id` = a categoria semeada do grupo delas (`saida-<categoria>`), então nenhuma fica sem categoria.
--
-- As tabelas, os índices e as chaves estrangeiras saíram de
--   prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- As CHECKs, o índice único por nome (sem diferenciar maiúsculas), a semeadura e o preenchimento de
-- `expenses.categoria_id` foram escritos à mão. A semeadura usa ON CONFLICT DO NOTHING (rodar de novo não duplica).
--
-- Como desfazer (perde as entradas manuais, as categorias criadas, o saldo inicial e o histórico; as despesas
-- continuam, só perdem a categoria editável, a versão e quem alterou):
--   ALTER TABLE "expenses" DROP CONSTRAINT "expenses_categoria_id_fkey";
--   ALTER TABLE "expenses" DROP CONSTRAINT "expenses_atualizado_por_id_fkey";
--   ALTER TABLE "expenses" DROP CONSTRAINT "expenses_importacao_id_fkey";
--   DROP INDEX "expenses_criado_por_id_idempotency_key_key";
--   DROP INDEX "expenses_categoria_id_idx"; DROP INDEX "expenses_importacao_id_idx"; DROP INDEX "expenses_atualizado_por_id_idx";
--   ALTER TABLE "expenses" DROP COLUMN "categoria_id", DROP COLUMN "forma_pagamento", DROP COLUMN "versao",
--     DROP COLUMN "atualizado_em", DROP COLUMN "atualizado_por_id", DROP COLUMN "idempotency_key", DROP COLUMN "importacao_id";
--   DROP TABLE "auditoria_financeira"; DROP TABLE "entradas_manuais"; DROP TABLE "config_financeiro";
--   DROP TABLE "categorias_financeiras"; DROP TABLE "importacoes";
--   DROP TYPE "AcaoAuditoria"; DROP TYPE "TipoLancamento";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261107200000_planilha_financeira';

-- CreateEnum
CREATE TYPE "TipoLancamento" AS ENUM ('ENTRADA', 'SAIDA');

-- CreateEnum
CREATE TYPE "AcaoAuditoria" AS ENUM ('CRIOU', 'ALTEROU', 'EXCLUIU', 'IMPORTOU', 'DESFEZ_IMPORTACAO', 'PROMOVEU_ADMIN', 'REBAIXOU_ADMIN');

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "atualizado_em" TIMESTAMP(3),
ADD COLUMN     "atualizado_por_id" TEXT,
ADD COLUMN     "categoria_id" TEXT,
ADD COLUMN     "forma_pagamento" "PaymentMethod",
ADD COLUMN     "idempotency_key" VARCHAR(100),
ADD COLUMN     "importacao_id" TEXT,
ADD COLUMN     "versao" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "categorias_financeiras" (
    "id" TEXT NOT NULL,
    "tipo" "TipoLancamento" NOT NULL,
    "nome" VARCHAR(40) NOT NULL,
    "grupo" "ExpenseCategory",
    "fora_do_resultado" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "atualizado_por_id" TEXT,

    CONSTRAINT "categorias_financeiras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entradas_manuais" (
    "id" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "categoria_id" TEXT NOT NULL,
    "descricao" VARCHAR(120) NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "forma_pagamento" "PaymentMethod",
    "observacao" VARCHAR(300),
    "versao" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" VARCHAR(100),
    "importacao_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criado_por_id" TEXT,
    "atualizado_em" TIMESTAMP(3),
    "atualizado_por_id" TEXT,

    CONSTRAINT "entradas_manuais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_financeiro" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "saldo_inicial" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saldo_inicial_em" DATE,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_por_id" TEXT,

    CONSTRAINT "config_financeiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "importacoes" (
    "id" TEXT NOT NULL,
    "arquivo_nome" VARCHAR(120) NOT NULL,
    "arquivo_hash" CHAR(64) NOT NULL,
    "linhas" INTEGER NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criado_por_id" TEXT,
    "desfeita_em" TIMESTAMP(3),
    "desfeita_por_id" TEXT,

    CONSTRAINT "importacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria_financeira" (
    "id" TEXT NOT NULL,
    "entidade" VARCHAR(30) NOT NULL,
    "entidade_id" TEXT NOT NULL,
    "acao" "AcaoAuditoria" NOT NULL,
    "antes" JSONB,
    "depois" JSONB,
    "admin_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_financeira_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categorias_financeiras_tipo_ativo_ordem_idx" ON "categorias_financeiras"("tipo", "ativo", "ordem");

-- CreateIndex
CREATE INDEX "categorias_financeiras_atualizado_por_id_idx" ON "categorias_financeiras"("atualizado_por_id");

-- CreateIndex
CREATE INDEX "entradas_manuais_data_idx" ON "entradas_manuais"("data");

-- CreateIndex
CREATE INDEX "entradas_manuais_categoria_id_idx" ON "entradas_manuais"("categoria_id");

-- CreateIndex
CREATE INDEX "entradas_manuais_importacao_id_idx" ON "entradas_manuais"("importacao_id");

-- CreateIndex
CREATE INDEX "entradas_manuais_atualizado_por_id_idx" ON "entradas_manuais"("atualizado_por_id");

-- CreateIndex
CREATE UNIQUE INDEX "entradas_manuais_criado_por_id_idempotency_key_key" ON "entradas_manuais"("criado_por_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "config_financeiro_atualizado_por_id_idx" ON "config_financeiro"("atualizado_por_id");

-- CreateIndex
CREATE INDEX "importacoes_arquivo_hash_idx" ON "importacoes"("arquivo_hash");

-- CreateIndex
CREATE INDEX "importacoes_criado_por_id_idx" ON "importacoes"("criado_por_id");

-- CreateIndex
CREATE INDEX "importacoes_desfeita_por_id_idx" ON "importacoes"("desfeita_por_id");

-- CreateIndex
CREATE INDEX "auditoria_financeira_entidade_entidade_id_idx" ON "auditoria_financeira"("entidade", "entidade_id");

-- CreateIndex
CREATE INDEX "auditoria_financeira_criado_em_idx" ON "auditoria_financeira"("criado_em");

-- CreateIndex
CREATE INDEX "auditoria_financeira_admin_id_idx" ON "auditoria_financeira"("admin_id");

-- CreateIndex
CREATE INDEX "expenses_categoria_id_idx" ON "expenses"("categoria_id");

-- CreateIndex
CREATE INDEX "expenses_importacao_id_idx" ON "expenses"("importacao_id");

-- CreateIndex
CREATE INDEX "expenses_atualizado_por_id_idx" ON "expenses"("atualizado_por_id");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_criado_por_id_idempotency_key_key" ON "expenses"("criado_por_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_financeiras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_atualizado_por_id_fkey" FOREIGN KEY ("atualizado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_importacao_id_fkey" FOREIGN KEY ("importacao_id") REFERENCES "importacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias_financeiras" ADD CONSTRAINT "categorias_financeiras_atualizado_por_id_fkey" FOREIGN KEY ("atualizado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas_manuais" ADD CONSTRAINT "entradas_manuais_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_financeiras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas_manuais" ADD CONSTRAINT "entradas_manuais_importacao_id_fkey" FOREIGN KEY ("importacao_id") REFERENCES "importacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas_manuais" ADD CONSTRAINT "entradas_manuais_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas_manuais" ADD CONSTRAINT "entradas_manuais_atualizado_por_id_fkey" FOREIGN KEY ("atualizado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_financeiro" ADD CONSTRAINT "config_financeiro_atualizado_por_id_fkey" FOREIGN KEY ("atualizado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "importacoes" ADD CONSTRAINT "importacoes_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "importacoes" ADD CONSTRAINT "importacoes_desfeita_por_id_fkey" FOREIGN KEY ("desfeita_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria_financeira" ADD CONSTRAINT "auditoria_financeira_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------------------
-- À mão: regras que o Prisma não descreve.

-- Nome único por tipo, sem diferenciar maiúsculas ("Gás" e "gás" são a mesma categoria).
CREATE UNIQUE INDEX "categorias_financeiras_tipo_nome_key" ON "categorias_financeiras"("tipo", lower("nome"));

-- Só saída tem grupo (o enum antigo das Despesas); nome não pode ser vazio.
ALTER TABLE "categorias_financeiras" ADD CONSTRAINT "categorias_financeiras_coerente" CHECK (
  ("tipo" = 'SAIDA' OR "grupo" IS NULL) AND length(btrim("nome")) > 0 AND "ordem" BETWEEN 0 AND 9999);

ALTER TABLE "entradas_manuais" ADD CONSTRAINT "entradas_manuais_valores" CHECK (
  "valor" > 0 AND length(btrim("descricao")) > 0 AND "versao" >= 0);

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_versao" CHECK ("versao" >= 0);

-- Linha única, como config_loja.
ALTER TABLE "config_financeiro" ADD CONSTRAINT "config_financeiro_linha_unica" CHECK ("id" = 1);

ALTER TABLE "importacoes" ADD CONSTRAINT "importacoes_linhas" CHECK ("linhas" >= 0);

-- Semeadura: uma categoria de SAÍDA por grupo antigo (rótulos de ROTULO_CATEGORIA, src/lib/despesas.ts), mais os
-- extras do plano. Ids legíveis: o código conhece `saida-<grupo>` (a tela de Despesas grava nessa categoria).
INSERT INTO "categorias_financeiras" ("id", "tipo", "nome", "grupo", "fora_do_resultado", "ordem", "atualizado_em") VALUES
  ('saida-ingredientes', 'SAIDA', 'Ingredientes', 'INGREDIENTES', false, 10, CURRENT_TIMESTAMP),
  ('saida-embalagens', 'SAIDA', 'Potes e embalagens', 'EMBALAGENS', false, 20, CURRENT_TIMESTAMP),
  ('saida-rotulos', 'SAIDA', 'Rótulos e adesivos', 'ROTULOS', false, 30, CURRENT_TIMESTAMP),
  ('saida-entrega', 'SAIDA', 'Entrega e frete', 'ENTREGA', false, 40, CURRENT_TIMESTAMP),
  ('saida-marketing', 'SAIDA', 'Divulgação', 'MARKETING', false, 50, CURRENT_TIMESTAMP),
  ('saida-equipamentos', 'SAIDA', 'Equipamentos e utensílios', 'EQUIPAMENTOS', false, 60, CURRENT_TIMESTAMP),
  ('saida-taxas', 'SAIDA', 'Taxas e impostos', 'TAXAS', false, 70, CURRENT_TIMESTAMP),
  ('saida-taxas-infinitepay', 'SAIDA', 'Taxas da InfinitePay', 'TAXAS', false, 75, CURRENT_TIMESTAMP),
  ('saida-outros', 'SAIDA', 'Outros', 'OUTROS', false, 80, CURRENT_TIMESTAMP),
  ('saida-retirada', 'SAIDA', 'Retirada da dona (pró-labore)', 'OUTROS', true, 90, CURRENT_TIMESTAMP),
  ('entrada-outras-vendas', 'ENTRADA', 'Outras vendas (fora do site)', NULL, false, 10, CURRENT_TIMESTAMP),
  ('entrada-reembolso', 'ENTRADA', 'Reembolso de compra', NULL, false, 20, CURRENT_TIMESTAMP),
  ('entrada-outras', 'ENTRADA', 'Outras entradas', NULL, false, 30, CURRENT_TIMESTAMP),
  ('entrada-aporte', 'ENTRADA', 'Aporte da dona', NULL, true, 40, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "config_financeiro" ("id", "saldo_inicial", "atualizado_em") VALUES (1, 0, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;

-- Toda despesa que já existe ganha a categoria do grupo dela.
UPDATE "expenses" SET "categoria_id" = 'saida-' || lower("categoria"::text) WHERE "categoria_id" IS NULL;
