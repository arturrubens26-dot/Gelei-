-- Encomendas de lembrancinhas (potinhos mini de 40 ml): a cliente solicita de 15 a 50 potinhos para
-- uma festa, a dona aprova, a cliente paga a ENTRADA (50% dos potinhos) e o RESTANTE (com o frete)
-- pelo checkout da InfinitePay até a entrega ou retirada. Entidade própria: NÃO é um `Order`.
--
-- Vem DEPOIS de 20261022220000_pagamento_retorno: as cobranças das encomendas ficam na MESMA tabela
-- `pagamentos` dos pedidos (plano 2026-10-21, seção 2.8), para o UNIQUE(gateway, transacao_nsu) valer
-- entre pedidos e encomendas: uma transação nunca quita as duas coisas. Em `pagamentos`:
--   - `order_id` passa a ser opcional; entram `encomenda_id` (FK) e `parcela` (ENTRADA | RESTANTE);
--   - CHECK `pagamentos_alvo`: exatamente um de order_id e encomenda_id, e `parcela` junto com a encomenda;
--   - CHECK `pagamentos_referencia_da_parcela`: a cobrança de encomenda tem o order_nsu
--     enc-<encomenda_id>-<parcela>-<n> da PRÓPRIA linha (o restante nunca quita a entrada).
-- O tipo "ModoEntrega" já existe (20261021230000_entrega_telefone) e é reaproveitado.
--
-- O resto só ACRESCENTA: cinco tipos, quatro tabelas e `products.disponivel_em_mini` (default false).
-- Os pedidos continuam funcionando igual: toda cobrança existente tem order_id.
-- Gerada com `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`;
-- as CHECKs e o INSERT da configuração, no fim, foram escritos à mão.
--
-- O recurso nasce DESATIVADO (config_lembrancinhas.ativo = false, com preço e pesos provisórios), sem
-- sabor marcado como mini, e o servidor recusa solicitações enquanto src/lib/dados-loja.ts não tiver
-- CNPJ/CPF e e-mail de contato (Decreto 7.962/2013, art. 2º; decisão D13).
--
-- Desfazer, SÓ enquanto nenhuma encomenda existir (apagar encomendas apagaria dinheiro recebido):
--   BEGIN;
--   SELECT count(*) FROM "encomendas";   -- precisa dar 0; se não der, ROLLBACK
--   ALTER TABLE "pagamentos" DROP CONSTRAINT "pagamentos_alvo", DROP CONSTRAINT "pagamentos_referencia_da_parcela";
--   DROP TABLE "encomenda_devolucoes";
--   ALTER TABLE "pagamentos" DROP COLUMN "encomenda_id", DROP COLUMN "parcela", ALTER COLUMN "order_id" SET NOT NULL;
--   DROP TABLE "encomenda_itens", "encomendas", "config_lembrancinhas";
--   DROP TYPE "EncomendaStatus", "ParcelaEncomenda", "AtorEncomenda", "DevolucaoStatus", "DevolucaoMotivo";
--   ALTER TABLE "products" DROP COLUMN "disponivel_em_mini";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261023120000_lembrancinhas';
--   COMMIT;
-- ("ModoEntrega" NÃO sai: é de orders.modo_entrega.)

-- CreateEnum
CREATE TYPE "EncomendaStatus" AS ENUM ('SOLICITADA', 'AGUARDANDO_ENTRADA', 'CONFIRMADA', 'EM_PRODUCAO', 'PRONTA', 'ENTREGUE', 'RECUSADA', 'EXPIRADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "ParcelaEncomenda" AS ENUM ('ENTRADA', 'RESTANTE');

-- CreateEnum
CREATE TYPE "AtorEncomenda" AS ENUM ('CLIENTE', 'LOJA', 'SISTEMA');

-- CreateEnum
CREATE TYPE "DevolucaoStatus" AS ENUM ('PENDENTE', 'FEITA');

-- CreateEnum
CREATE TYPE "DevolucaoMotivo" AS ENUM ('DESISTENCIA', 'CANCELAMENTO', 'PAGAMENTO_TARDIO', 'PAGAMENTO_DUPLICADO');

-- AlterTable
ALTER TABLE "pagamentos" ADD COLUMN     "encomenda_id" TEXT,
ADD COLUMN     "parcela" "ParcelaEncomenda",
ALTER COLUMN "order_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "disponivel_em_mini" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "config_lembrancinhas" (
    "id" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "preco_potinho" DECIMAL(10,2) NOT NULL,
    "peso_potinho_gramas" INTEGER NOT NULL,
    "peso_embalagem_gramas" INTEGER NOT NULL DEFAULT 0,
    "percentual_retido" INTEGER NOT NULL DEFAULT 100,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "config_lembrancinhas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encomendas" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "EncomendaStatus" NOT NULL DEFAULT 'SOLICITADA',
    "data_festa" DATE NOT NULL,
    "data_entrega" DATE NOT NULL,
    "modo_entrega" "ModoEntrega" NOT NULL,
    "address_id" TEXT,
    "telefone" VARCHAR(11) NOT NULL,
    "observacao" VARCHAR(300),
    "potinhos" INTEGER NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "frete" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "valor_entrada" DECIMAL(10,2) NOT NULL,
    "valor_restante" DECIMAL(10,2) NOT NULL,
    "peso_total_gramas" INTEGER NOT NULL,
    "responder_ate" TIMESTAMP(3) NOT NULL,
    "corte_em" TIMESTAMP(3) NOT NULL,
    "entrada_ate" TIMESTAMP(3),
    "percentual_aceito" INTEGER NOT NULL,
    "percentual_retido" INTEGER NOT NULL,
    "politica_versao" VARCHAR(20) NOT NULL,
    "politica_aceita_em" TIMESTAMP(3) NOT NULL,
    "idempotency_key" VARCHAR(100) NOT NULL,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aprovada_em" TIMESTAMP(3),
    "entrada_paga_em" TIMESTAMP(3),
    "entrada_forma" "PaymentMethod",
    "entrada_fora_do_site" BOOLEAN NOT NULL DEFAULT false,
    "entrada_observacao" VARCHAR(300),
    "entrada_registrada_por_id" TEXT,
    "producao_iniciada_em" TIMESTAMP(3),
    "pronta_em" TIMESTAMP(3),
    "restante_pago_em" TIMESTAMP(3),
    "restante_forma" "PaymentMethod",
    "restante_fora_do_site" BOOLEAN NOT NULL DEFAULT false,
    "restante_observacao" VARCHAR(300),
    "restante_registrado_por_id" TEXT,
    "entregue_em" TIMESTAMP(3),
    "encerrada_em" TIMESTAMP(3),
    "motivo_recusa" VARCHAR(300),
    "cancelada_por" "AtorEncomenda",
    "motivo_cancelamento" VARCHAR(300),
    "avisada_status" "EncomendaStatus",
    "avisada_em" TIMESTAMP(3),

    CONSTRAINT "encomendas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encomenda_itens" (
    "id" TEXT NOT NULL,
    "encomenda_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "preco_unitario" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "encomenda_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encomenda_devolucoes" (
    "id" TEXT NOT NULL,
    "encomenda_id" TEXT NOT NULL,
    "pagamento_id" TEXT,
    "motivo" "DevolucaoMotivo" NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "status" "DevolucaoStatus" NOT NULL DEFAULT 'PENDENTE',
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feita_em" TIMESTAMP(3),
    "observacao" VARCHAR(300),
    "registrada_por_id" TEXT,

    CONSTRAINT "encomenda_devolucoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "encomendas_user_id_criada_em_idx" ON "encomendas"("user_id", "criada_em");

-- CreateIndex
CREATE INDEX "encomendas_status_data_entrega_idx" ON "encomendas"("status", "data_entrega");

-- CreateIndex
CREATE INDEX "encomendas_status_responder_ate_idx" ON "encomendas"("status", "responder_ate");

-- CreateIndex
CREATE INDEX "encomendas_status_entrada_ate_idx" ON "encomendas"("status", "entrada_ate");

-- CreateIndex
CREATE INDEX "encomendas_entregue_em_idx" ON "encomendas"("entregue_em");

-- CreateIndex
CREATE INDEX "encomendas_restante_pago_em_idx" ON "encomendas"("restante_pago_em");

-- CreateIndex
CREATE INDEX "encomendas_address_id_idx" ON "encomendas"("address_id");

-- CreateIndex
CREATE INDEX "encomendas_restante_registrado_por_id_idx" ON "encomendas"("restante_registrado_por_id");

-- CreateIndex
CREATE INDEX "encomendas_entrada_registrada_por_id_idx" ON "encomendas"("entrada_registrada_por_id");

-- CreateIndex
CREATE UNIQUE INDEX "encomendas_user_id_idempotency_key_key" ON "encomendas"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "encomenda_itens_product_id_idx" ON "encomenda_itens"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "encomenda_itens_encomenda_id_product_id_key" ON "encomenda_itens"("encomenda_id", "product_id");

-- CreateIndex
CREATE INDEX "encomenda_devolucoes_encomenda_id_idx" ON "encomenda_devolucoes"("encomenda_id");

-- CreateIndex
CREATE INDEX "encomenda_devolucoes_status_feita_em_idx" ON "encomenda_devolucoes"("status", "feita_em");

-- CreateIndex
CREATE INDEX "encomenda_devolucoes_pagamento_id_idx" ON "encomenda_devolucoes"("pagamento_id");

-- CreateIndex
CREATE INDEX "encomenda_devolucoes_registrada_por_id_idx" ON "encomenda_devolucoes"("registrada_por_id");

-- CreateIndex
CREATE INDEX "pagamentos_encomenda_id_parcela_idx" ON "pagamentos"("encomenda_id", "parcela");

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_encomenda_id_fkey" FOREIGN KEY ("encomenda_id") REFERENCES "encomendas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encomendas" ADD CONSTRAINT "encomendas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encomendas" ADD CONSTRAINT "encomendas_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encomendas" ADD CONSTRAINT "encomendas_restante_registrado_por_id_fkey" FOREIGN KEY ("restante_registrado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encomendas" ADD CONSTRAINT "encomendas_entrada_registrada_por_id_fkey" FOREIGN KEY ("entrada_registrada_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encomenda_itens" ADD CONSTRAINT "encomenda_itens_encomenda_id_fkey" FOREIGN KEY ("encomenda_id") REFERENCES "encomendas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encomenda_itens" ADD CONSTRAINT "encomenda_itens_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encomenda_devolucoes" ADD CONSTRAINT "encomenda_devolucoes_encomenda_id_fkey" FOREIGN KEY ("encomenda_id") REFERENCES "encomendas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encomenda_devolucoes" ADD CONSTRAINT "encomenda_devolucoes_pagamento_id_fkey" FOREIGN KEY ("pagamento_id") REFERENCES "pagamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encomenda_devolucoes" ADD CONSTRAINT "encomenda_devolucoes_registrada_por_id_fkey" FOREIGN KEY ("registrada_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Regras que o Prisma não descreve (a API já confere; o banco também não deixa passar). Os limites
-- aqui são folgados: o exato (15 a 50 potinhos, 0 a 100%, datas) fica no código, como nos kits.

-- Cobrança: de um pedido OU de uma parcela de encomenda, nunca dos dois nem de nenhum.
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_alvo" CHECK (
  num_nonnulls("order_id", "encomenda_id") = 1
  AND (("encomenda_id" IS NULL) = ("parcela" IS NULL)));

-- A cobrança de encomenda leva o order_nsu da própria encomenda e parcela: enc-<id>-<PARCELA>-<n>.
-- É a referência gravada que vai ao payment_check: um link do RESTANTE nunca quita a ENTRADA.
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_referencia_da_parcela" CHECK (
  "encomenda_id" IS NULL
  OR "referencia_externa" ~ ('^enc-' || "encomenda_id" || '-' || "parcela"::text || '-[1-9][0-9]{0,2}$'));

-- Configuração: preço positivo, pesos plausíveis e percentual retido de 0 a 100.
ALTER TABLE "config_lembrancinhas" ADD CONSTRAINT "config_lembrancinhas_valores" CHECK (
  "preco_potinho" > 0
  AND "peso_potinho_gramas" BETWEEN 1 AND 1000
  AND "peso_embalagem_gramas" BETWEEN 0 AND 5000
  AND "percentual_retido" BETWEEN 0 AND 100);

-- A entrega ou retirada é antes do dia da festa.
ALTER TABLE "encomendas" ADD CONSTRAINT "encomendas_datas" CHECK ("data_entrega" < "data_festa");

-- Entrega tem endereço; retirada na loja não tem endereço nem frete.
ALTER TABLE "encomendas" ADD CONSTRAINT "encomendas_entrega_coerente" CHECK (
  ("modo_entrega" = 'ENTREGA' AND "address_id" IS NOT NULL)
  OR ("modo_entrega" = 'RETIRADA' AND "address_id" IS NULL AND "frete" = 0));

-- Dinheiro coerente: total = potinhos + frete = entrada + restante; entrada sempre positiva.
ALTER TABLE "encomendas" ADD CONSTRAINT "encomendas_valores" CHECK (
  "potinhos" BETWEEN 1 AND 200
  AND "subtotal" > 0 AND "frete" >= 0 AND "total" = "subtotal" + "frete"
  AND "valor_entrada" > 0 AND "valor_restante" >= 0 AND "valor_entrada" + "valor_restante" = "total"
  AND "peso_total_gramas" > 0
  AND "percentual_retido" BETWEEN 0 AND 100);

-- Telefone: a mesma regra de orders.telefone (telefoneValido em src/lib/entrega-regras.ts).
ALTER TABLE "encomendas" ADD CONSTRAINT "encomendas_telefone" CHECK ("telefone" ~ '^[1-9]{2}(9[0-9]{8}|[2-5][0-9]{7})$');

-- Cada status com os fatos que ele exige. Em especial: ENTREGUE só quitada (restante pago).
ALTER TABLE "encomendas" ADD CONSTRAINT "encomendas_status_coerente" CHECK (
  ("status" NOT IN ('CONFIRMADA', 'EM_PRODUCAO', 'PRONTA', 'ENTREGUE') OR "entrada_paga_em" IS NOT NULL)
  AND ("status" <> 'AGUARDANDO_ENTRADA' OR ("aprovada_em" IS NOT NULL AND "entrada_ate" IS NOT NULL))
  AND ("status" <> 'ENTREGUE' OR ("restante_pago_em" IS NOT NULL AND "entregue_em" IS NOT NULL))
  AND ("status" <> 'RECUSADA' OR "motivo_recusa" IS NOT NULL)
  AND ("status" <> 'CANCELADA' OR "cancelada_por" IS NOT NULL)
  AND ("status" NOT IN ('RECUSADA', 'EXPIRADA', 'CANCELADA') OR "encerrada_em" IS NOT NULL)
  AND (("restante_pago_em" IS NULL) = ("restante_forma" IS NULL))
  AND (NOT "restante_fora_do_site" OR "restante_pago_em" IS NOT NULL));

-- Percentual da política: o que a cliente aceitou (0 a 100) e o que vale de fato, que nunca passa do aceito.
ALTER TABLE "encomendas" ADD CONSTRAINT "encomendas_percentuais" CHECK (
  "percentual_aceito" BETWEEN 0 AND 100 AND "percentual_retido" <= "percentual_aceito");

-- Entrada registrada pela dona (fora do site, ou dada como recebida depois de uma conferência que não
-- fechou): exige a data, a forma e a encomenda já confirmada; pelo site, esses campos ficam vazios.
ALTER TABLE "encomendas" ADD CONSTRAINT "encomendas_entrada_fora_do_site" CHECK (
  (NOT "entrada_fora_do_site" OR ("entrada_paga_em" IS NOT NULL AND "entrada_forma" IS NOT NULL))
  AND ("entrada_fora_do_site" OR ("entrada_forma" IS NULL AND "entrada_observacao" IS NULL AND "entrada_registrada_por_id" IS NULL)));

-- Itens.
ALTER TABLE "encomenda_itens" ADD CONSTRAINT "encomenda_itens_valores" CHECK ("quantidade" BETWEEN 1 AND 200 AND "preco_unitario" > 0);

-- Devolução: valor positivo; FEITA tem data, PENDENTE não.
ALTER TABLE "encomenda_devolucoes" ADD CONSTRAINT "encomenda_devolucoes_coerente" CHECK (
  "valor" > 0 AND (("status" = 'FEITA') = ("feita_em" IS NOT NULL)));

-- A configuração, DESATIVADA e com valores provisórios (decisões D1, D4 e D10): R$ 6,00 por potinho,
-- 110 g por potinho cheio, 300 g de embalagem e 100% da entrada retida depois do corte.
-- `atualizado_em` é @updatedAt (sem default no SQL), por isso entra no INSERT. ON CONFLICT: rodar de
-- novo (ou num banco onde o seed já a criou) não falha.
INSERT INTO "config_lembrancinhas" ("id", "ativo", "preco_potinho", "peso_potinho_gramas", "peso_embalagem_gramas", "percentual_retido", "atualizado_em")
VALUES ('lembrancinhas', false, 6.00, 110, 300, 100, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
