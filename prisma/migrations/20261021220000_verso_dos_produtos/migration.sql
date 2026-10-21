-- Verso da foto dos produtos: "Harmoniza com" e "Por que você vai gostar" (duas listas curtas de texto).
-- Só acrescenta: o código antigo continua funcionando com ela. A migração não traz texto: a dona
-- cola o conteúdo no painel (o prisma/seed.ts traz o rascunho só para o banco local).
--
-- Desfazer:
--   ALTER TABLE "products" DROP CONSTRAINT "products_harmonizacoes_limite", DROP CONSTRAINT "products_destaques_limite",
--     DROP COLUMN "harmonizacoes", DROP COLUMN "destaques";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261021220000_verso_dos_produtos';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "destaques" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "harmonizacoes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Limites (os mesmos de src/lib/produtos-regras.ts): no máximo 4 harmonizações de 40 caracteres e
-- 3 destaques de 70. Sem subconsulta numa CHECK, o tamanho de cada item é conferido pelo total
-- (itens + separadores); o limite por item fica na API. NOT NULL dentro da CHECK: o Prisma cria a
-- lista como coluna anulável, e um NOT NULL na coluna apareceria como diferença no próximo diff.
ALTER TABLE "products" ADD CONSTRAINT "products_harmonizacoes_limite" CHECK (
  "harmonizacoes" IS NOT NULL AND cardinality("harmonizacoes") <= 4
  AND char_length(array_to_string("harmonizacoes", '|')) <= 4 * 40 + 3
);
ALTER TABLE "products" ADD CONSTRAINT "products_destaques_limite" CHECK (
  "destaques" IS NOT NULL AND cardinality("destaques") <= 3
  AND char_length(array_to_string("destaques", '|')) <= 3 * 70 + 2
);
