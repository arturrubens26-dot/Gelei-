-- Despesas da loja (tela /admin/expenses). Migração só aditiva: cria enums, tabela e índices.
-- Gerada com `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`;
-- as CHECKs no fim foram escritas à mão (o Prisma não as representa no schema).

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('INGREDIENTES', 'EMBALAGENS', 'ROTULOS', 'ENTREGA', 'MARKETING', 'EQUIPAMENTOS', 'TAXAS', 'OUTROS');

-- CreateEnum
CREATE TYPE "ExpenseUnit" AS ENUM ('UN', 'KG', 'G', 'L', 'ML', 'PACOTE', 'CAIXA', 'METRO');

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "descricao" VARCHAR(120) NOT NULL,
    "categoria" "ExpenseCategory" NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "unidade" "ExpenseUnit" NOT NULL,
    "valor_total" DECIMAL(10,2) NOT NULL,
    "data" DATE NOT NULL,
    "fornecedor" VARCHAR(80),
    "observacao" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criado_por_id" TEXT,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_data_idx" ON "expenses"("data");

-- CreateIndex
CREATE INDEX "expenses_criado_por_id_idx" ON "expenses"("criado_por_id");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Regras que valem mesmo fora da API (mesmo espírito de 20261013231500_endurecimento).
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_valor_positivo"      CHECK ("valor_total" > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_quantidade_positiva" CHECK ("quantidade" > 0);
