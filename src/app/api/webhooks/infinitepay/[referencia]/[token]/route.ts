import { unstable_rethrow } from "next/navigation";
import { comTratamento, lerJsonDoAviso, registrarErro } from "@/lib/api";
import { infinitePayConfigurado } from "@/lib/infinitepay";
import { avisoAutentico, processarAvisoDaInfinitePay } from "@/lib/pagamentos";

/** order_nsu dos links do ensaio: ensaio-AAAAMMDDhhmm (scripts/ensaio-infinitepay.ts). */
const FORMATO_ENSAIO = /^ensaio-\d{12}$/;

/**
 * POST /api/webhooks/infinitepay/<referencia>/<token> — aviso de pagamento aprovado da InfinitePay.
 *
 * O aviso NÃO é prova de nada (não é assinado): o token HMAC da cobrança no caminho prova só que quem
 * chama conhece a URL que nós demos; a transação e o slug do corpo viram um "candidato", e o servidor
 * confere no payment_check com a própria chave, a referência do NOSSO banco e o valor
 * (src/lib/pagamentos.ts). Sem CSRF: é servidor para servidor.
 *
 * Respostas (`{ recebido, resultado }`):
 * - 401: token errado (nada é lido nem gravado);
 * - 200: confirmado, já confirmado antes, divergente (a dona confere no app), recusado de vez ou
 *   ignorado (cobrança desconhecida, corpo sem transação);
 * - 400: a InfinitePay não respondeu à conferência, ainda não acha a transação, ainda não marca como
 *   pago, a cobrança acabou de ser conferida, ou QUALQUER falha nossa (banco fora, por exemplo): ela
 *   repete o aviso;
 * - 404: pagamento desligado (sem chave).
 */
export const POST = comTratamento(
  "api/webhooks/infinitepay",
  async (request: Request, ctx: RouteContext<"/api/webhooks/infinitepay/[referencia]/[token]">) => {
    if (!infinitePayConfigurado()) return Response.json({ erro: "Recurso indisponível." }, { status: 404 });
    const { referencia, token } = await ctx.params;
    // Ensaio com dinheiro real (scripts/ensaio-infinitepay.ts --aviso): só registra a chegada no log e
    // responde 400, para ver se e quando a InfinitePay repete. Não lê o corpo nem toca no banco.
    if (FORMATO_ENSAIO.test(referencia) && token === "ensaio") {
      console.info(`[webhooks/infinitepay] aviso de ENSAIO ${referencia} recebido; respondendo 400 de propósito`);
      return Response.json({ recebido: false, resultado: "ensaio" }, { status: 400 });
    }
    // O token é conferido ANTES de ler o corpo: quem não tem a URL não gasta nem a leitura.
    if (!avisoAutentico(referencia, token)) {
      return Response.json({ recebido: false, resultado: "token-invalido" }, { status: 401 });
    }
    // Daqui em diante, QUALQUER falha (banco fora, corpo grande demais, erro inesperado) responde 400:
    // é o código que a InfinitePay repete. Um 500 ou 503 poderia fazer o aviso se perder.
    try {
      const corpo = await lerJsonDoAviso(request);
      const { status, resultado } = await processarAvisoDaInfinitePay(referencia, token, corpo);
      if (status !== 200) console.warn(`[webhooks/infinitepay] aviso de ${referencia}: ${resultado} (${status})`);
      return Response.json({ recebido: status === 200, resultado }, { status });
    } catch (e) {
      unstable_rethrow(e);
      registrarErro(`webhooks/infinitepay ${referencia}`, e);
      return Response.json({ recebido: false, resultado: "erro" }, { status: 400 });
    }
  },
);
