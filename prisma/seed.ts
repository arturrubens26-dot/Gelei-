/**
 * Seed: popula o banco com produtos de exemplo e o usuário admin inicial.
 * Pode rodar várias vezes (usa upsert). Execute com: npx prisma db seed
 */
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/client";

try {
  process.loadEnvFile();
} catch {
  // Sem .env: usa só as variáveis do ambiente.
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL não está definida.");
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// Catálogo Geleiô. Peso como no rótulo real: Pimenta 112g; Abacaxi com Pimenta, Abacaxi e Maracujá 125g.
// Morango segue com 112g até chegar a foto do rótulo dele.
// PREÇOS PROVISÓRIOS: ajuste para os valores reais de venda.
const produtos = [
  {
    id: "pimenta-112g",
    nome: "Pimenta, 112g",
    descricao: "Geleia de pimenta com ardência equilibrada. Para petiscos, queijos e carnes.",
    preco: "24.90",
    pesoGramas: 112,
  },
  {
    id: "abacaxi-com-pimenta-125g",
    nome: "Abacaxi com Pimenta, 125g",
    descricao: "O doce do abacaxi com um ardido suave de pimenta. Vai bem com queijos e carnes.",
    preco: "24.90",
    pesoGramas: 125,
  },
  {
    id: "abacaxi-125g",
    nome: "Abacaxi, 125g",
    descricao: "Abacaxi maduro cozido devagar até virar geleia. Doce na medida, com acidez leve.",
    preco: "22.90",
    pesoGramas: 125,
  },
  {
    id: "morango-112g",
    nome: "Morango, 112g",
    descricao: "Morangos selecionados, cozidos em fogo baixo. Sabor de fruta de verdade.",
    preco: "24.90",
    pesoGramas: 112,
  },
  {
    id: "maracuja-125g",
    nome: "Maracujá, 125g",
    descricao: "Polpa de maracujá com sementes, azedinha e perfumada. Ótima em torradas e sobremesas.",
    preco: "23.90",
    pesoGramas: 125,
  },
] as const;

/** Produtos com foto real em public/produtos/<id>.jpg. */
const COM_FOTO = new Set(["pimenta-112g", "abacaxi-com-pimenta-125g", "abacaxi-125g", "maracuja-125g"]);

async function semearProdutos() {
  for (const p of produtos) {
    const dados = {
      nome: p.nome,
      descricao: p.descricao,
      preco: p.preco,
      pesoGramas: p.pesoGramas,
      // Foto real quando houver; senão, a ilustração no formato do rótulo.
      imagemUrl: COM_FOTO.has(p.id) ? `/produtos/${p.id}.jpg` : `/produtos/${p.id}.svg`,
    };
    await db.product.upsert({
      where: { id: p.id },
      // Em produção o seed não sobrescreve preços/descrições que o admin possa ter ajustado.
      update: process.env.NODE_ENV === "production" ? {} : dados,
      create: { id: p.id, ...dados },
    });
  }
  console.log(`✔ ${produtos.length} produtos`);
}

async function semearAdmin() {
  const emProducao = process.env.NODE_ENV === "production";
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@geleio.local").toLowerCase();
  const nome = process.env.SEED_ADMIN_NAME ?? "Administrador Geleiô";
  let senha = process.env.SEED_ADMIN_PASSWORD;

  if (!senha) {
    if (emProducao) {
      throw new Error("Defina SEED_ADMIN_PASSWORD para criar o admin em produção.");
    }
    // Nunca deixamos uma senha fixa no código: em dev, gera uma aleatória.
    senha = randomBytes(12).toString("base64url");
    console.log(`! SEED_ADMIN_PASSWORD não definida. Senha gerada (aparece só agora): ${senha}`);
  }
  // Painel administrativo: em produção exige senha longa e e-mail próprio (o padrão é previsível).
  const minimo = emProducao ? 12 : 8;
  if (senha.length < minimo) {
    throw new Error(`SEED_ADMIN_PASSWORD deve ter pelo menos ${minimo} caracteres.`);
  }
  if (emProducao && !process.env.SEED_ADMIN_EMAIL) {
    throw new Error("Defina SEED_ADMIN_EMAIL (um e-mail seu) para criar o admin em produção.");
  }

  const existente = await db.user.findUnique({ where: { email } });
  if (existente) {
    // Nunca promove uma conta comum a admin: se alguém se cadastrou com este e-mail antes
    // do seed, promovê-la entregaria o painel a quem conhece a senha dela.
    if (!existente.isAdmin) {
      throw new Error(
        `Já existe uma conta comum com o e-mail ${email}. Escolha outro SEED_ADMIN_EMAIL ou ` +
          "apague/ajuste essa conta manualmente. O seed não promove contas existentes a admin.",
      );
    }
    // Não redefine a senha de um admin existente ao rodar o seed de novo.
    console.log(`✔ admin já existia (${email}); senha mantida`);
    return;
  }

  await db.user.create({
    data: {
      email,
      nome,
      passwordHash: await bcrypt.hash(senha, 12),
      isAdmin: true,
    },
  });
  console.log(`✔ admin criado (${email})`);
}

async function principal() {
  await semearProdutos();
  await semearAdmin();
}

principal()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
