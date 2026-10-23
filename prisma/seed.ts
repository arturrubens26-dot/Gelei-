/**
 * Seed: popula o banco com produtos de exemplo e o usuário admin inicial.
 * Pode rodar várias vezes (usa upsert). Execute com: npx prisma db seed
 *
 * Só roda no banco LOCAL (localhost/127.0.0.1): com a DATABASE_URL do Neon numa máquina de
 * desenvolvimento, ele mexeria na loja no ar. Para um banco remoto de propósito (a primeira carga
 * do Neon, por exemplo), defina SEED_PERMITIR_REMOTO=1; aí ele só CRIA o que falta.
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

/** Hosts do banco deste computador (o `prisma dev` usa localhost). */
const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Host da DATABASE_URL, em minúsculas; `null` se a URL não der para ler. Nunca é impresso. */
function hostDoBanco(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

const host = hostDoBanco(connectionString);
const bancoRemoto = !(host && HOSTS_LOCAIS.has(host));
// Trava ANTES de qualquer conexão: um engano de .env não pode sobrescrever preços nem mexer no kit
// da loja no ar. O host não aparece na mensagem (nada do .env vai para o terminal ou para logs).
if (bancoRemoto && process.env.SEED_PERMITIR_REMOTO !== "1") {
  const motivo =
    host === null ? "não deu para ler o endereço da DATABASE_URL" : "a DATABASE_URL não aponta para o banco local (localhost ou 127.0.0.1)";
  console.error(
    `✖ Seed recusado: ${motivo}.\n` +
      "  O seed cria produtos, o kit e o admin, e no banco local ainda sobrescreve preços e descrições;\n" +
      "  num banco no ar (Neon), isso mexeria na loja de verdade.\n" +
      "  Se é isso mesmo (ex.: a primeira carga do Neon), rode de novo com SEED_PERMITIR_REMOTO=1\n" +
      "  (PowerShell: $env:SEED_PERMITIR_REMOTO='1'; npm run db:seed). Num banco remoto ele só cria o que falta.",
  );
  process.exit(1);
}
if (bancoRemoto) console.log("! Banco remoto (SEED_PERMITIR_REMOTO=1): só cria o que falta, sem sobrescrever nada.");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// Catálogo Geleiô. Peso como no rótulo real: Pimenta 112g; Abacaxi com Pimenta, Abacaxi e Maracujá 125g.
// Morango segue com 112g até chegar a foto do rótulo dele.
// PREÇOS PROVISÓRIOS: ajuste para os valores reais de venda.
const produtos = [
  {
    id: "pimenta-112g",
    nome: "Pimenta, 112g",
    descricao: "Geleia de pimenta com ardência equilibrada. Para petiscos, queijos e carnes.",
    preco: "15.00",
    pesoGramas: 112,
  },
  {
    id: "abacaxi-com-pimenta-125g",
    nome: "Abacaxi com Pimenta, 125g",
    descricao: "O doce do abacaxi com um ardido suave de pimenta. Vai bem com queijos e carnes.",
    preco: "15.00",
    pesoGramas: 125,
  },
  {
    id: "abacaxi-125g",
    nome: "Abacaxi, 125g",
    descricao: "Abacaxi maduro cozido devagar até virar geleia. Doce na medida, com acidez leve.",
    preco: "15.00",
    pesoGramas: 125,
  },
  {
    id: "morango-112g",
    nome: "Morango, 112g",
    descricao: "Morangos selecionados, cozidos em fogo baixo. Sabor de fruta de verdade.",
    preco: "15.00",
    pesoGramas: 112,
  },
  {
    id: "maracuja-125g",
    nome: "Maracujá, 125g",
    descricao: "Polpa de maracujá com sementes, azedinha e perfumada. Ótima em torradas e sobremesas.",
    preco: "15.00",
    pesoGramas: 125,
  },
] as const;

/**
 * Verso da foto (rascunho aprovado pela dona em 2026-10-21; ela revisa e edita pelo painel). Só
 * sabor, textura, cor e uso: nada de alegação de saúde nem de fato da receita que não sabemos.
 * Limites em src/lib/produtos-regras.ts (4 × 40 e 3 × 70).
 */
const VERSO: Record<(typeof produtos)[number]["id"], { harmonizacoes: string[]; destaques: string[] }> = {
  "pimenta-112g": {
    harmonizacoes: ["Cream cheese com torradas", "Queijo coalho na chapa", "Costelinha e carnes assadas", "Tábua de frios"],
    destaques: [
      "Doce e picante na mesma colherada",
      "Vermelho intenso que deixa a tábua de frios bonita",
      "Transforma um petisco simples em entrada de festa",
    ],
  },
  "abacaxi-com-pimenta-125g": {
    harmonizacoes: ["Queijo coalho na brasa", "Lombo ou pernil assado", "Frango grelhado", "Cream cheese com biscoito salgado"],
    destaques: [
      "O doce do abacaxi com um toque picante",
      "Pedacinhos de fruta e de pimenta à vista no pote",
      "Vai do aperitivo ao prato principal",
    ],
  },
  "abacaxi-125g": {
    harmonizacoes: ["Pão quentinho com manteiga", "Bolo simples e rocambole", "Iogurte com frutas", "Queijo minas frescal"],
    destaques: [
      "Sabor de abacaxi, docinho com a acidez da fruta",
      "Cor dourada que alegra o café da manhã",
      "Combina com doces e com salgados",
    ],
  },
  "maracuja-125g": {
    harmonizacoes: ["Cheesecake e mousse", "Iogurte com granola", "Queijo brie ou camembert", "Torradas no café da manhã"],
    destaques: ["Azedinha e perfumada, como a fruta", "Com as sementes, que dão crocância", "Cobertura pronta para sobremesas"],
  },
  "morango-112g": {
    harmonizacoes: ["Torradas e pão com manteiga", "Panqueca e waffle", "Sorvete de creme", "Queijo brie ou cream cheese"],
    destaques: [
      "Um clássico do café da manhã e do lanche",
      "Vermelho vivo e aroma de morango",
      "Ótima para rechear bolos e biscoitos",
    ],
  },
};

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
      // Em produção ou num banco remoto, o seed não sobrescreve preços/descrições que a dona possa
      // ter ajustado. "Pode entrar no Kit Presente" é decisão dela no painel: o update não mexe.
      update: process.env.NODE_ENV === "production" || bancoRemoto ? {} : dados,
      // Os potes do catálogo são do tamanho padrão (112 g e 125 g): entram no kit.
      create: { id: p.id, ...dados, permitidoEmKit: true, ...VERSO[p.id] },
    });
    // Verso: só preenche quando as duas listas estão vazias (nunca sobrescreve o que a dona editou).
    if (!bancoRemoto && process.env.NODE_ENV !== "production") {
      await db.product.updateMany({
        where: { id: p.id, harmonizacoes: { isEmpty: true }, destaques: { isEmpty: true } },
        data: VERSO[p.id],
      });
    }
  }
  console.log(`✔ ${produtos.length} produtos`);
}

/**
 * Kit de presente (a migração 20261021120000_kits já o cria, oculto). Rodar de novo NÃO mexe em
 * nada dele, nem em `ativo`: mostrar ou ocultar é decisão da dona, no painel. Se o kit não existir,
 * nasce OCULTO, a menos que SEED_KIT_VISIVEL=1 (para testar a página /kits num banco novo).
 * Antes, a visibilidade dependia de NODE_ENV: o seed rodado de uma máquina de desenvolvimento com
 * a DATABASE_URL do Neon ativaria o kit na loja no ar.
 */
async function semearKit() {
  const visivel = process.env.SEED_KIT_VISIVEL === "1";
  const kit = await db.kit.upsert({
    where: { id: "kit-presente" },
    update: {},
    create: {
      id: "kit-presente",
      nome: "Kit Presente",
      descricao: "Três geleias à sua escolha numa caixa de presente.",
      preco: "40.00",
      potes: 3,
      // Peso da caixa vazia provisório: troque pelo real no painel.
      pesoCaixaGramas: 150,
      ativo: visivel,
    },
  });
  console.log(`✔ kit-presente (${kit.ativo ? "visível" : "oculto"} na loja; mostre ou oculte em /admin/products)`);
}

/**
 * Lembrancinhas (potinhos mini). A migração 20261023120000_lembrancinhas já cria a configuração
 * DESATIVADA, e nenhum sabor nasce "disponível em mini": rodar o seed não muda nada disso. Só com
 * SEED_LEMBRANCINHAS_ATIVAS=1, e só no banco LOCAL, ele marca os sabores do catálogo como mini e
 * ativa o recurso, para testar /lembrancinhas num banco novo. Isso pula de propósito a trava do painel
 * (que só ativa com CNPJ/CPF e e-mail de contato em src/lib/dados-loja.ts): é ambiente de teste.
 */
async function semearLembrancinhas() {
  const ativar = process.env.SEED_LEMBRANCINHAS_ATIVAS === "1" && !bancoRemoto;
  await db.configLembrancinhas.upsert({
    where: { id: "lembrancinhas" },
    update: ativar ? { ativo: true } : {},
    // Valores provisórios (decisões D1, D4 e D10), os mesmos da migração.
    create: { id: "lembrancinhas", ativo: ativar, precoPotinho: "6.00", pesoPotinhoGramas: 110, pesoEmbalagemGramas: 300, percentualRetido: 100 },
  });
  if (ativar) {
    const { count } = await db.product.updateMany({ where: { id: { in: produtos.map((p) => p.id) } }, data: { disponivelEmMini: true } });
    console.log(`✔ lembrancinhas ATIVAS (SEED_LEMBRANCINHAS_ATIVAS=1): ${count} sabores marcados como mini`);
  } else {
    console.log("✔ lembrancinhas (configuração conferida; ative e marque os sabores mini no painel)");
  }
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
  await semearKit();
  await semearLembrancinhas();
  await semearAdmin();
}

principal()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
