/**
 * Ensaio com DINHEIRO REAL na InfinitePay (não há sandbox), para confirmar o formato da API antes de
 * abrir a loja. Roda neste computador, no PowerShell, com a chave no .env só durante o ensaio:
 *
 *   npx tsx scripts/ensaio-infinitepay.ts criar 100
 *       cria um link de R$ 1,00 (order_nsu ensaio-<data>, vale 30 min, single_payment) e mostra o
 *       link para pagar, os NOMES dos campos da resposta, o host do link e se veio o slug.
 *   npx tsx scripts/ensaio-infinitepay.ts retorno "<endereço inteiro copiado da barra do navegador>"
 *       lê os parâmetros do retorno (order_nsu, transaction_nsu, slug...) e confere no payment_check.
 *   npx tsx scripts/ensaio-infinitepay.ts conferir <order_nsu> <transaction_nsu> <slug>
 *       só a conferência (payment_check).
 *
 * Variáveis (do .env ou do ambiente): INFINITEPAY_HANDLE, INFINITEPAY_API_KEY e, opcional,
 * INFINITEPAY_API_URL (só 127.0.0.1/localhost: para ensaiar o próprio script contra
 * testes/infinitepay-falso.mjs). A chave NUNCA é impressa. Nada aqui grava no banco.
 */
import {
  FORMATO_HANDLE,
  dataComFusoDeBrasilia,
  lerConferencia,
  lerRespostaDoLink,
  origemDeTesteDe,
} from "../src/lib/infinitepay-regras";

try {
  process.loadEnvFile();
} catch {
  // sem .env: as variáveis vêm do ambiente
}

const API = origemDeTesteDe(process.env.INFINITEPAY_API_URL) ?? "https://api.checkout.infinitepay.io";
const handle = process.env.INFINITEPAY_HANDLE?.trim() ?? "";
const chave = process.env.INFINITEPAY_API_KEY?.trim() ?? "";
const RETORNO_DO_ENSAIO = "https://geleio.netlify.app/?ensaio=1";

function sair(mensagem: string): never {
  console.error(mensagem);
  process.exit(1);
}

/** Campos conhecidos aparecem com o valor; os desconhecidos, só pelo nome (podem ter dados pessoais). */
function resumir(json: unknown, conhecidos: readonly string[]): string {
  if (!json || typeof json !== "object" || Array.isArray(json)) return `(resposta não é um objeto: ${typeof json})`;
  const linhas: string[] = [];
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (conhecidos.includes(k) && (typeof v !== "object" || v === null)) linhas.push(`  ${k}: ${JSON.stringify(v)}`);
    else if (v && typeof v === "object" && !Array.isArray(v)) linhas.push(`  ${k}: { ${Object.keys(v).join(", ")} }`);
    else linhas.push(`  ${k}: (${Array.isArray(v) ? "lista" : typeof v})`);
  }
  return linhas.join("\n");
}

async function chamar(caminho: string, corpo: unknown): Promise<{ status: number; json: unknown }> {
  if (!FORMATO_HANDLE.test(handle)) sair('INFINITEPAY_HANDLE ausente ou inválido (a InfiniteTag sem "$", ex.: geleio).');
  if (!chave) sair("INFINITEPAY_API_KEY ausente (cole no .env só durante o ensaio; nunca no chat).");
  const r = await fetch(`${API}${caminho}`, {
    method: "POST",
    headers: { "X-Api-Key": chave, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  const texto = await r.text();
  let json: unknown = null;
  try {
    json = JSON.parse(texto);
  } catch {
    json = `(não é JSON: ${texto.length} caracteres)`;
  }
  return { status: r.status, json };
}

async function criar(centavosTexto: string | undefined) {
  const centavos = Number(centavosTexto ?? "100");
  if (!Number.isInteger(centavos) || centavos < 100 || centavos > 5000) sair("Valor em centavos, de 100 (R$ 1,00) a 5000.");
  const agora = new Date();
  const orderNsu = `ensaio-${dataComFusoDeBrasilia(agora).slice(0, 16).replace(/\D/g, "")}`;
  const corpo = {
    handle,
    order_nsu: orderNsu,
    items: [{ description: "Ensaio Geleiô (será devolvido)", quantity: 1, price: centavos }],
    redirect_url: RETORNO_DO_ENSAIO,
    options: {
      single_payment: true,
      valid_until: dataComFusoDeBrasilia(new Date(agora.getTime() + 30 * 60_000)),
      assured_installments: 0,
      require_delivery_address: false,
      payment_methods_enabled: ["credit_card", "pix"],
    },
  };
  console.log(`API: ${API}\nCriando link de R$ ${(centavos / 100).toFixed(2).replace(".", ",")} (order_nsu ${orderNsu})...`);
  const { status, json } = await chamar("/links", corpo);
  console.log(`HTTP ${status}. Campos da resposta:\n${resumir(json, ["slug", "invoice_slug", "id", "status", "message", "error"])}`);
  const origemLocal = origemDeTesteDe(process.env.INFINITEPAY_API_URL);
  const lido = lerRespostaDoLink(json, { origemLocal });
  if (!lido) {
    console.log("\nO site NÃO reconheceu o link nessa resposta (campo url/link/checkout_url com https em *.infinitepay.io).");
    console.log("Mande os NOMES dos campos acima para ajustar o src/lib/infinitepay-regras.ts (lerRespostaDoLink).");
    process.exit(1);
  }
  console.log(`\nO site reconheceu o link. Host: ${new URL(lido.url).host}. Slug na resposta: ${lido.slug ? "SIM" : "NÃO"}.`);
  console.log(`\nAbra e pague (vale 30 min):\n${lido.url}\n`);
  console.log("Depois de pagar, clique em \"Continuar\": o navegador abre a loja com ?ensaio=1&... na barra de endereço.");
  console.log('Copie o endereço INTEIRO e rode:  npx tsx scripts/ensaio-infinitepay.ts retorno "<endereço>"');
}

async function conferir(orderNsu?: string, transacaoNsu?: string, slug?: string) {
  if (!orderNsu || !transacaoNsu || !slug) sair("Uso: conferir <order_nsu> <transaction_nsu> <slug>");
  console.log(`API: ${API}\nConferindo no payment_check...`);
  const { status, json } = await chamar("/payment_check", { handle, order_nsu: orderNsu, transaction_nsu: transacaoNsu, slug });
  console.log(
    `HTTP ${status}. Resposta:\n${resumir(json, ["success", "paid", "amount", "paid_amount", "installments", "capture_method", "order_nsu", "currency", "message"])}`,
  );
  const lida = lerConferencia(json);
  console.log(
    lida
      ? `\nO site entende esta resposta: success=${lida.success}, paid=${lida.paid}, amount=${lida.amount}, paid_amount=${lida.paid_amount}, ` +
          `installments=${lida.installments}, capture_method=${lida.capture_method}.`
      : "\nO site NÃO entende esta resposta (lerConferencia): mande os nomes dos campos para ajustar.",
  );
}

async function retorno(endereco?: string) {
  if (!endereco) sair('Uso: retorno "<endereço inteiro copiado da barra do navegador>"');
  let url: URL;
  try {
    url = new URL(endereco);
  } catch {
    sair("Isso não parece um endereço. Copie da barra do navegador, com https://.");
  }
  console.log(`Parâmetros do retorno: ${[...url.searchParams.keys()].join(", ") || "(nenhum)"}`);
  const p = url.searchParams;
  console.log(`capture_method: ${p.get("capture_method") ?? "(não veio)"}; receipt_url: ${p.get("receipt_url") ? new URL(p.get("receipt_url")!).host : "(não veio)"}`);
  await conferir(p.get("order_nsu") ?? undefined, p.get("transaction_nsu") ?? undefined, p.get("slug") ?? p.get("invoice_slug") ?? undefined);
}

const [comando, ...args] = process.argv.slice(2);
const acoes: Record<string, () => Promise<void>> = {
  criar: () => criar(args[0]),
  conferir: () => conferir(args[0], args[1], args[2]),
  retorno: () => retorno(args[0]),
};
const acao = comando ? acoes[comando] : undefined;
if (!acao) sair("Uso: npx tsx scripts/ensaio-infinitepay.ts criar <centavos> | retorno \"<endereço>\" | conferir <order_nsu> <transaction_nsu> <slug>");
acao().catch((e: unknown) => sair(`Falhou: ${e instanceof Error ? `${e.name}: ${e.message}` : "erro"}`));
