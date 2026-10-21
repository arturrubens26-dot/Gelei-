-- Redefinição de senha (link gerado pela dona no painel ou pedido por e-mail) e versão de sessão.
-- Só acrescenta: o código antigo continua funcionando com ela. A troca de senha sobe
-- users.sessao_versao, que vai no JWT (claim "v"): as sessões antigas deixam de valer. Token sem "v"
-- conta como 0, então ninguém é deslogado no deploy.
--
-- Desfazer:
--   DROP TABLE "redefinicoes_senha";
--   DROP TYPE "OrigemRedefinicao";
--   ALTER TABLE "users" DROP COLUMN "sessao_versao";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261021210000_redefinir_senha';

-- CreateEnum
CREATE TYPE "OrigemRedefinicao" AS ENUM ('EMAIL', 'PAINEL');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "sessao_versao" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "redefinicoes_senha" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "origem" "OrigemRedefinicao" NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "usado_em" TIMESTAMP(3),
    "invalidado_em" TIMESTAMP(3),
    "gerado_por_id" TEXT,
    "conferencia" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "observacao" VARCHAR(200),

    CONSTRAINT "redefinicoes_senha_pkey" PRIMARY KEY ("id"),
    -- O link vence depois de criado; o hash é SHA-256 em hex.
    CONSTRAINT "redefinicoes_senha_validade" CHECK ("expira_em" > "criado_em"),
    CONSTRAINT "redefinicoes_senha_hash_hex" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    -- Link do painel só com a conferência registrada (pelo menos e-mail e nome). Sem CHECK em
    -- gerado_por_id: o SET NULL ao apagar a conta do admin a quebraria.
    CONSTRAINT "redefinicoes_senha_conferencia" CHECK (
      "conferencia" IS NOT NULL AND ("origem" <> 'PAINEL' OR cardinality("conferencia") >= 2)
    ),
    CONSTRAINT "redefinicoes_senha_usado_ou_invalidado" CHECK ("usado_em" IS NULL OR "invalidado_em" IS NULL)
);

-- CreateIndex
CREATE UNIQUE INDEX "redefinicoes_senha_token_hash_key" ON "redefinicoes_senha"("token_hash");

-- CreateIndex
CREATE INDEX "redefinicoes_senha_user_id_criado_em_idx" ON "redefinicoes_senha"("user_id", "criado_em");

-- CreateIndex
CREATE INDEX "redefinicoes_senha_criado_em_idx" ON "redefinicoes_senha"("criado_em");

-- CreateIndex
CREATE INDEX "redefinicoes_senha_gerado_por_id_idx" ON "redefinicoes_senha"("gerado_por_id");

-- AddForeignKey
ALTER TABLE "redefinicoes_senha" ADD CONSTRAINT "redefinicoes_senha_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redefinicoes_senha" ADD CONSTRAINT "redefinicoes_senha_gerado_por_id_fkey" FOREIGN KEY ("gerado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
