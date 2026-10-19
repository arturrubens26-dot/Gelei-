-- Cobranças PIX (Mercado Pago). Um pedido online pode ter várias (o PIX expira e o cliente gera
-- outro); o pedido só vira PAGO quando o servidor consulta o gateway e o valor confere.
--
-- Desfazer (dentro de uma transação; só antes de existir cobrança real):
--   BEGIN;
--   DROP TABLE "pagamentos";
--   DROP TYPE "PaymentStatus";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261019200000_pagamentos_pix';
--   COMMIT;

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDENTE', 'APROVADO', 'CANCELADO', 'RECUSADO', 'ESTORNADO');

-- CreateTable
CREATE TABLE "pagamentos" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "gateway" VARCHAR(20) NOT NULL,
    "referencia_externa" VARCHAR(64) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDENTE',
    "status_gateway" VARCHAR(40),
    "valor" DECIMAL(10,2) NOT NULL,
    "copia_e_cola" TEXT NOT NULL,
    "qr_code_base64" TEXT,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consultado_em" TIMESTAMP(3),
    "aprovado_em" TIMESTAMP(3),

    CONSTRAINT "pagamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pagamentos_order_id_idx" ON "pagamentos"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_gateway_referencia_externa_key" ON "pagamentos"("gateway", "referencia_externa");

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras que o Prisma não descreve: valor positivo; data de aprovação só em cobrança que foi paga.
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_valor_positivo" CHECK ("valor" > 0);
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_aprovacao_coerente"
  CHECK ("aprovado_em" IS NULL OR "status" IN ('APROVADO', 'ESTORNADO'));
