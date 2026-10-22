-- InfinitePay no lugar do Mercado Pago (que nunca recebeu credencial). A tabela "pagamentos" passa
-- de PIX com QR Code para link do checkout hospedado: saem o copia e cola e o QR; entram o link, a
-- transação conferida (UNIQUE por gateway), o candidato ainda não conferido e o que foi pago.
--
-- Desfazer (só enquanto não houver cobrança real da InfinitePay):
--   BEGIN;
--   ALTER TABLE "pagamentos" DROP CONSTRAINT "pagamentos_transacao_aprovada", DROP CONSTRAINT "pagamentos_parcelas_validas",
--     DROP CONSTRAINT "pagamentos_valor_pago_positivo", DROP CONSTRAINT "pagamentos_metodo_valido";
--   DROP INDEX "pagamentos_gateway_transacao_nsu_key";
--   ALTER TABLE "pagamentos" DROP COLUMN "avisado_em", DROP COLUMN "aviso_slug", DROP COLUMN "aviso_transacao_nsu",
--     DROP COLUMN "checkout_url", DROP COLUMN "comprovante_url", DROP COLUMN "fatura_slug", DROP COLUMN "metodo",
--     DROP COLUMN "parcelas", DROP COLUMN "transacao_nsu", DROP COLUMN "valor_pago",
--     ADD COLUMN "copia_e_cola" TEXT NOT NULL DEFAULT '', ADD COLUMN "qr_code_base64" TEXT;
--   ALTER TABLE "pagamentos" ALTER COLUMN "copia_e_cola" DROP DEFAULT;
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261021200000_infinitepay';
--   COMMIT;

-- Guarda: cobrança do Mercado Pago perderia o copia e cola. Não deve existir (o gateway nunca foi
-- ligado); se existir, migre à mão. As linhas "simulado" do banco local ficam (perdem só o QR).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "pagamentos" WHERE "gateway" = 'mercadopago') THEN
    RAISE EXCEPTION 'Há cobranças do Mercado Pago na tabela pagamentos: migre à mão.';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "pagamentos" DROP COLUMN "copia_e_cola",
DROP COLUMN "qr_code_base64",
ADD COLUMN     "avisado_em" TIMESTAMP(3),
ADD COLUMN     "aviso_slug" VARCHAR(100),
ADD COLUMN     "aviso_transacao_nsu" VARCHAR(100),
ADD COLUMN     "checkout_url" VARCHAR(500),
ADD COLUMN     "comprovante_url" VARCHAR(500),
ADD COLUMN     "fatura_slug" VARCHAR(100),
ADD COLUMN     "metodo" VARCHAR(20),
ADD COLUMN     "parcelas" INTEGER,
ADD COLUMN     "transacao_nsu" VARCHAR(100),
ADD COLUMN     "valor_pago" DECIMAL(10,2);

-- CreateIndex: a mesma transação nunca quita duas cobranças (vale entre pedidos).
CREATE UNIQUE INDEX "pagamentos_gateway_transacao_nsu_key" ON "pagamentos"("gateway", "transacao_nsu");

-- Só cobrança aprovada (ou devolvida depois) tem transação; parcelas de 1 a 12; o que foi pago é
-- positivo; o método é o que o checkout devolve.
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_transacao_aprovada"
  CHECK ("transacao_nsu" IS NULL OR "status" IN ('APROVADO', 'ESTORNADO'));
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_parcelas_validas"
  CHECK ("parcelas" IS NULL OR "parcelas" BETWEEN 1 AND 12);
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_valor_pago_positivo"
  CHECK ("valor_pago" IS NULL OR "valor_pago" > 0);
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_metodo_valido"
  CHECK ("metodo" IS NULL OR "metodo" IN ('pix', 'credit_card'));
