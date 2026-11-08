-- Mimos: itens adicionais (florzinhas, paninho na tampa, caixinha, colherzinha).
--
-- ADITIVA: só acrescenta (uma coluna com DEFAULT 0, três tabelas e quatro linhas de cadastro). O código antigo
-- continua funcionando com ela. A única mudança em algo que já existe é a CHECK `encomendas_valores`, trocada
-- por uma que soma também os adicionais (com adicionais = 0, que é o caso de toda encomenda já gravada, as duas
-- dizem exatamente o mesmo). Mimos continuam DESLIGADOS em produção: a migração não liga nada.
--
-- As tabelas, os índices e as chaves estrangeiras saíram de
--   prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- As CHECKs, a troca da `encomendas_valores` e o INSERT dos quatro itens foram escritos à mão.
--
-- Como desfazer (só enquanto nenhuma encomenda tiver adicional; antes, apague ou arquive `encomenda_adicionais`):
--   ALTER TABLE "encomendas" DROP CONSTRAINT "encomendas_valores";
--   ALTER TABLE "encomendas" ADD CONSTRAINT "encomendas_valores" CHECK (
--     "potinhos" BETWEEN 1 AND 200
--     AND "subtotal" > 0 AND "frete" >= 0 AND "total" = "subtotal" + "frete"
--     AND "valor_entrada" > 0 AND "valor_restante" >= 0 AND "valor_entrada" + "valor_restante" = "total"
--     AND "peso_total_gramas" > 0
--     AND "percentual_retido" BETWEEN 0 AND 100);
--   ALTER TABLE "encomendas" DROP COLUMN "adicionais";
--   DROP TABLE "encomenda_adicionais"; DROP TABLE "mimo_adicional_fotos"; DROP TABLE "mimo_adicionais";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261107120000_mimos_adicionais';

-- AlterTable
ALTER TABLE "encomendas" ADD COLUMN     "adicionais" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "mimo_adicionais" (
    "id" TEXT NOT NULL,
    "nome" VARCHAR(60) NOT NULL,
    "descricao" VARCHAR(160) NOT NULL,
    "preco_por_potinho" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "imagem_url" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mimo_adicionais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mimo_adicional_fotos" (
    "id" TEXT NOT NULL,
    "adicional_id" TEXT NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "dados" BYTEA NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mimo_adicional_fotos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encomenda_adicionais" (
    "id" TEXT NOT NULL,
    "encomenda_id" TEXT NOT NULL,
    "adicional_id" TEXT NOT NULL,
    "nome" VARCHAR(60) NOT NULL,
    "preco_por_potinho" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "encomenda_adicionais_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mimo_adicionais_ativo_ordem_idx" ON "mimo_adicionais"("ativo", "ordem");

-- CreateIndex
CREATE INDEX "mimo_adicional_fotos_adicional_id_idx" ON "mimo_adicional_fotos"("adicional_id");

-- CreateIndex
CREATE INDEX "encomenda_adicionais_adicional_id_idx" ON "encomenda_adicionais"("adicional_id");

-- CreateIndex
CREATE UNIQUE INDEX "encomenda_adicionais_encomenda_id_adicional_id_key" ON "encomenda_adicionais"("encomenda_id", "adicional_id");

-- AddForeignKey
ALTER TABLE "mimo_adicional_fotos" ADD CONSTRAINT "mimo_adicional_fotos_adicional_id_fkey" FOREIGN KEY ("adicional_id") REFERENCES "mimo_adicionais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encomenda_adicionais" ADD CONSTRAINT "encomenda_adicionais_encomenda_id_fkey" FOREIGN KEY ("encomenda_id") REFERENCES "encomendas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encomenda_adicionais" ADD CONSTRAINT "encomenda_adicionais_adicional_id_fkey" FOREIGN KEY ("adicional_id") REFERENCES "mimo_adicionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preço por potinho de 0 a 999,99 (0 = sem custo); nome e descrição preenchidos; foto só dos tipos aceitos.
ALTER TABLE "mimo_adicionais" ADD CONSTRAINT "mimo_adicionais_valores" CHECK (
  "preco_por_potinho" >= 0 AND "preco_por_potinho" <= 999.99
  AND length(btrim("nome")) > 0 AND length(btrim("descricao")) > 0
  AND "ordem" BETWEEN 0 AND 1000);
ALTER TABLE "mimo_adicional_fotos" ADD CONSTRAINT "mimo_adicional_fotos_tipo" CHECK ("tipo" IN ('image/jpeg', 'image/png', 'image/webp'));
ALTER TABLE "encomenda_adicionais" ADD CONSTRAINT "encomenda_adicionais_valores" CHECK (
  "preco_por_potinho" >= 0 AND "preco_por_potinho" <= 999.99 AND length(btrim("nome")) > 0);
ALTER TABLE "encomendas" ADD CONSTRAINT "encomendas_adicionais_positivo" CHECK ("adicionais" >= 0);

-- Dinheiro coerente: total = potinhos + adicionais + frete = entrada + restante; entrada sempre positiva.
-- (Troca a `encomendas_valores` da migração 20261023120000_lembrancinhas.)
ALTER TABLE "encomendas" DROP CONSTRAINT "encomendas_valores";
ALTER TABLE "encomendas" ADD CONSTRAINT "encomendas_valores" CHECK (
  "potinhos" BETWEEN 1 AND 200
  AND "subtotal" > 0 AND "frete" >= 0 AND "adicionais" >= 0 AND "total" = "subtotal" + "adicionais" + "frete"
  AND "valor_entrada" > 0 AND "valor_restante" >= 0 AND "valor_entrada" + "valor_restante" = "total"
  AND "peso_total_gramas" > 0
  AND "percentual_retido" BETWEEN 0 AND 100);

-- Os quatro itens pedidos pela dona, ATIVOS e com preço R$ 0,00 (sem custo) até ela ajustar no painel.
-- Sem imagem enviada, a loja mostra a ilustração padrão de cada um, com a legenda "Imagem ilustrativa".
INSERT INTO "mimo_adicionais" ("id", "nome", "descricao", "preco_por_potinho", "ativo", "ordem", "atualizado_em") VALUES
  ('florzinhas', 'Florzinhas', 'Florzinhas para enfeitar cada potinho.', 0, true, 1, CURRENT_TIMESTAMP),
  ('paninho-na-tampa', 'Paninho na tampa', 'Um paninho de tecido cobrindo a tampa de cada potinho.', 0, true, 2, CURRENT_TIMESTAMP),
  ('caixinha', 'Caixinha confeccionada para o pote', 'Uma caixinha confeccionada para acomodar cada potinho.', 0, true, 3, CURRENT_TIMESTAMP),
  ('colherzinha', 'Colherzinha pequena', 'Uma colherzinha pequena para cada convidado saborear a geleia.', 0, true, 4, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
