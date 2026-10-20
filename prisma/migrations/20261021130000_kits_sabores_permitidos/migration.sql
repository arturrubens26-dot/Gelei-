-- "Monte seu kit": só os sabores marcados entram na caixa. Antes, o servidor aceitava no kit QUALQUER
-- produto ativo: se a dona cadastrasse um pote de 250 g a R$ 28, a cliente levaria 3 por R$ 40.
-- A coluna nova `permitido_em_kit` é opt-in (produto novo nasce FORA do kit; a dona marca "Pode
-- entrar no Kit Presente" no painel). Os potes que já existem no tamanho padrão (100 g a 130 g: os
-- atuais têm 112 g e 125 g) já entram marcados.
-- Gerada com `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`;
-- o UPDATE, no fim, foi escrito à mão. Só ACRESCENTA uma coluna com default: o código antigo continua
-- funcionando com o banco novo.
--
-- Desfazer (a qualquer momento; nenhum pedido depende da coluna, mas o código novo depende dela):
--   BEGIN;
--   ALTER TABLE "products" DROP COLUMN "permitido_em_kit";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261021130000_kits_sabores_permitidos';
--   COMMIT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "permitido_em_kit" BOOLEAN NOT NULL DEFAULT false;

-- Potes do tamanho padrão já entram no kit.
UPDATE "products" SET "permitido_em_kit" = true WHERE "peso_gramas" BETWEEN 100 AND 130;
