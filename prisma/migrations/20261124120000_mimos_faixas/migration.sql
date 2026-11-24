-- Mimos em duas faixas (decisão da dona, 2026-11-24): de 10 a 19 potinhos, um sabor só, a R$ 7,00 cada;
-- de 20 em diante, até 2 sabores, ao preço que já existe (`preco_potinho`). Aditiva: só uma coluna nova,
-- com o padrão de R$ 7,00 para a linha que já existe. As encomendas antigas guardam o próprio preço.
ALTER TABLE "config_lembrancinhas" ADD COLUMN "preco_potinho_poucos" DECIMAL(10,2) NOT NULL DEFAULT 7.00;
ALTER TABLE "config_lembrancinhas" ADD CONSTRAINT "config_lembrancinhas_preco_poucos" CHECK ("preco_potinho_poucos" > 0);
