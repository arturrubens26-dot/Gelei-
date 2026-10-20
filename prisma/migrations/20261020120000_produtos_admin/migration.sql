-- Cadastro de produtos pelo painel: "visível na loja" (ativo) e fotos enviadas (guardadas no banco,
-- porque a Netlify não guarda arquivos enviados). Aditiva: os produtos atuais continuam visíveis.
--
-- Desfazer (dentro de uma transação; apaga as fotos enviadas pelo painel):
--   BEGIN;
--   DROP TABLE "produto_fotos";
--   ALTER TABLE "products" DROP COLUMN "ativo";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261020120000_produtos_admin';
--   COMMIT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "ativo" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "produto_fotos" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "dados" BYTEA NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "produto_fotos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "produto_fotos_product_id_idx" ON "produto_fotos"("product_id");

-- AddForeignKey
ALTER TABLE "produto_fotos" ADD CONSTRAINT "produto_fotos_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Regras que o Prisma não descreve: tipo de imagem conhecido e foto de no máximo 2 MB.
ALTER TABLE "produto_fotos" ADD CONSTRAINT "produto_fotos_tipo_valido" CHECK ("tipo" IN ('image/jpeg', 'image/png', 'image/webp'));
ALTER TABLE "produto_fotos" ADD CONSTRAINT "produto_fotos_tamanho" CHECK (octet_length("dados") BETWEEN 1 AND 2097152);
-- Preço e peso positivos (o painel não deixa passar; o banco também não).
ALTER TABLE "products" ADD CONSTRAINT "products_preco_positivo" CHECK ("preco" > 0);
ALTER TABLE "products" ADD CONSTRAINT "products_peso_positivo" CHECK ("peso_gramas" > 0);
