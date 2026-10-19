-- Produção (/admin/production): insumos, lotes de geleia, custos do lote e ajustes de estoque;
-- e a compra de insumo ligada à despesa (expenses.insumo_id + quantidade_base). Só aditiva.
-- Gerada com `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`;
-- as CHECKs no fim foram escritas à mão (o Prisma não as representa no schema).
--
-- Desfazer (perde produções, insumos e o vínculo das compras):
--   ALTER TABLE "expenses" DROP CONSTRAINT "expenses_insumo_id_fkey", DROP CONSTRAINT "expenses_insumo_com_quantidade",
--     DROP CONSTRAINT "expenses_quantidade_base_positiva", DROP COLUMN "insumo_id", DROP COLUMN "quantidade_base";
--   DROP TABLE "ajustes_estoque", "producao_custos", "producao_itens", "producoes", "insumos";
--   DROP TYPE "InsumoTipo"; DROP TYPE "InsumoUnit";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261017140000_producao';
-- CreateEnum
CREATE TYPE "InsumoUnit" AS ENUM ('G', 'ML', 'UN');

-- CreateEnum
CREATE TYPE "InsumoTipo" AS ENUM ('INGREDIENTE', 'EMBALAGEM');

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "insumo_id" TEXT,
ADD COLUMN     "quantidade_base" DECIMAL(14,3);

-- CreateTable
CREATE TABLE "insumos" (
    "id" TEXT NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "tipo" "InsumoTipo" NOT NULL,
    "unidade" "InsumoUnit" NOT NULL,
    "estoque_minimo" DECIMAL(14,3),
    "controla_estoque" BOOLEAN NOT NULL DEFAULT true,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insumos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "producoes" (
    "id" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "product_id" TEXT,
    "nome" VARCHAR(80) NOT NULL,
    "potes" INTEGER NOT NULL,
    "observacao" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criado_por_id" TEXT,

    CONSTRAINT "producoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "producao_itens" (
    "id" TEXT NOT NULL,
    "producao_id" TEXT NOT NULL,
    "insumo_id" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "custo_unitario" DECIMAL(16,6) NOT NULL,

    CONSTRAINT "producao_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "producao_custos" (
    "id" TEXT NOT NULL,
    "producao_id" TEXT NOT NULL,
    "descricao" VARCHAR(60) NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "producao_custos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ajustes_estoque" (
    "id" TEXT NOT NULL,
    "insumo_id" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "motivo" VARCHAR(120) NOT NULL,
    "data" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criado_por_id" TEXT,

    CONSTRAINT "ajustes_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "insumos_nome_key" ON "insumos"("nome");

-- CreateIndex
CREATE INDEX "producoes_data_idx" ON "producoes"("data");

-- CreateIndex
CREATE INDEX "producoes_product_id_idx" ON "producoes"("product_id");

-- CreateIndex
CREATE INDEX "producoes_criado_por_id_idx" ON "producoes"("criado_por_id");

-- CreateIndex
CREATE INDEX "producao_itens_producao_id_idx" ON "producao_itens"("producao_id");

-- CreateIndex
CREATE INDEX "producao_itens_insumo_id_idx" ON "producao_itens"("insumo_id");

-- CreateIndex
CREATE INDEX "producao_custos_producao_id_idx" ON "producao_custos"("producao_id");

-- CreateIndex
CREATE INDEX "ajustes_estoque_insumo_id_idx" ON "ajustes_estoque"("insumo_id");

-- CreateIndex
CREATE INDEX "expenses_insumo_id_idx" ON "expenses"("insumo_id");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "insumos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producoes" ADD CONSTRAINT "producoes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producoes" ADD CONSTRAINT "producoes_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producao_itens" ADD CONSTRAINT "producao_itens_producao_id_fkey" FOREIGN KEY ("producao_id") REFERENCES "producoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producao_itens" ADD CONSTRAINT "producao_itens_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "insumos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producao_custos" ADD CONSTRAINT "producao_custos_producao_id_fkey" FOREIGN KEY ("producao_id") REFERENCES "producoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ajustes_estoque" ADD CONSTRAINT "ajustes_estoque_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "insumos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ajustes_estoque" ADD CONSTRAINT "ajustes_estoque_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Regras que valem mesmo fora da API.
ALTER TABLE "producoes"       ADD CONSTRAINT "producoes_potes_positivos"          CHECK ("potes" > 0);
ALTER TABLE "producao_itens"  ADD CONSTRAINT "producao_itens_quantidade_positiva" CHECK ("quantidade" > 0);
ALTER TABLE "producao_itens"  ADD CONSTRAINT "producao_itens_custo_nao_negativo"  CHECK ("custo_unitario" >= 0);
ALTER TABLE "producao_custos" ADD CONSTRAINT "producao_custos_valor_nao_negativo" CHECK ("valor" >= 0);
ALTER TABLE "ajustes_estoque" ADD CONSTRAINT "ajustes_estoque_quantidade_nao_zero" CHECK ("quantidade" <> 0);
ALTER TABLE "insumos"         ADD CONSTRAINT "insumos_estoque_minimo_nao_negativo" CHECK ("estoque_minimo" IS NULL OR "estoque_minimo" >= 0);
-- Compra de insumo: insumo e quantidade que entrou no estoque andam juntos.
ALTER TABLE "expenses"        ADD CONSTRAINT "expenses_insumo_com_quantidade"     CHECK (("insumo_id" IS NULL) = ("quantidade_base" IS NULL));
ALTER TABLE "expenses"        ADD CONSTRAINT "expenses_quantidade_base_positiva"  CHECK ("quantidade_base" IS NULL OR "quantidade_base" > 0);