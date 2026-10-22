-- Retorno do navegador registrado na cobrança (só aditiva). Quando a cliente volta da InfinitePay,
-- o site grava a hora (retorno_em) sem confirmar nada: a tela fica em "confirmando" e não abre link
-- novo por 30 min, enquanto o aviso (webhook) chega. A transação que vem na URL do retorno continua
-- não sendo gravada (é dado da cliente).
--
-- Desfazer:
--   ALTER TABLE "pagamentos" DROP COLUMN "retorno_em";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261022220000_pagamento_retorno';

-- AlterTable
ALTER TABLE "pagamentos" ADD COLUMN "retorno_em" TIMESTAMP(3);
