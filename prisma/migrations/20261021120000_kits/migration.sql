-- "Monte seu kit": kit de presente (caixa com N potes à escolha da cliente) e a composição de cada
-- caixa vendida. Só CRIA tabelas: order_items continua só com os potes avulsos, então o código antigo
-- segue funcionando com o banco novo.
-- Gerada com `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`;
-- as CHECKs e o INSERT do kit padrão, no fim, foram escritos à mão.
-- O kit nasce OCULTO (ativo = false): a dona confere preço e peso da caixa no painel e o ativa.
--
-- Desfazer, SÓ enquanto nenhum pedido tiver kit (apagar order_kits deixaria esses pedidos com um
-- total que não bate com os itens, e o Financeiro perderia os potes vendidos em kit):
--   BEGIN;
--   SELECT count(*) FROM "order_kits";   -- precisa dar 0; se não der, ROLLBACK
--   DROP TABLE "order_kit_sabores", "order_kits", "kits";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261021120000_kits';
--   COMMIT;

-- CreateTable
CREATE TABLE "kits" (
    "id" TEXT NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "descricao" VARCHAR(300) NOT NULL,
    "preco" DECIMAL(10,2) NOT NULL,
    "potes" INTEGER NOT NULL DEFAULT 3,
    "peso_caixa_gramas" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_kits" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "kit_id" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "preco_unitario" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "order_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_kit_sabores" (
    "id" TEXT NOT NULL,
    "order_kit_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "preco_avulso" DECIMAL(10,2) NOT NULL,
    "valor_rateado" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "order_kit_sabores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_kits_order_id_idx" ON "order_kits"("order_id");

-- CreateIndex
CREATE INDEX "order_kits_kit_id_idx" ON "order_kits"("kit_id");

-- CreateIndex
CREATE INDEX "order_kit_sabores_product_id_idx" ON "order_kit_sabores"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_kit_sabores_order_kit_id_product_id_key" ON "order_kit_sabores"("order_kit_id", "product_id");

-- AddForeignKey
ALTER TABLE "order_kits" ADD CONSTRAINT "order_kits_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_kits" ADD CONSTRAINT "order_kits_kit_id_fkey" FOREIGN KEY ("kit_id") REFERENCES "kits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_kit_sabores" ADD CONSTRAINT "order_kit_sabores_order_kit_id_fkey" FOREIGN KEY ("order_kit_id") REFERENCES "order_kits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_kit_sabores" ADD CONSTRAINT "order_kit_sabores_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras que o Prisma não descreve (a API já confere; o banco também não deixa passar).
-- Kit: preço positivo, de 2 a 6 potes por caixa e peso da caixa não negativo.
ALTER TABLE "kits"              ADD CONSTRAINT "kits_preco_positivo"                   CHECK ("preco" > 0);
ALTER TABLE "kits"              ADD CONSTRAINT "kits_potes_validos"                    CHECK ("potes" BETWEEN 2 AND 6);
ALTER TABLE "kits"              ADD CONSTRAINT "kits_peso_caixa_nao_negativo"          CHECK ("peso_caixa_gramas" >= 0);
-- Caixas do pedido e sua composição (o preço pode ser 0 só se o kit um dia for brinde; nunca negativo).
ALTER TABLE "order_kits"        ADD CONSTRAINT "order_kits_quantidade_positiva"        CHECK ("quantidade" > 0);
ALTER TABLE "order_kits"        ADD CONSTRAINT "order_kits_preco_nao_negativo"         CHECK ("preco_unitario" >= 0);
ALTER TABLE "order_kit_sabores" ADD CONSTRAINT "order_kit_sabores_quantidade_valida"   CHECK ("quantidade" BETWEEN 1 AND 6);
ALTER TABLE "order_kit_sabores" ADD CONSTRAINT "order_kit_sabores_valores_nao_negativos" CHECK ("preco_avulso" >= 0 AND "valor_rateado" >= 0);

-- O kit padrão, OCULTO. ON CONFLICT: rodar de novo (ou num banco onde o seed já o criou) não falha.
INSERT INTO "kits" ("id", "nome", "descricao", "preco", "potes", "peso_caixa_gramas", "ativo")
VALUES ('kit-presente', 'Kit Presente', 'Três geleias à sua escolha numa caixa de presente.', 40.00, 3, 150, false)
ON CONFLICT ("id") DO NOTHING;
