import { comTratamento, lerJsonDoAviso } from "@/lib/api";
import { infinitePayConfigurado } from "@/lib/infinitepay";
import { avisoAutentico, processarAvisoDaInfinitePay } from "@/lib/pagamentos";

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
 * - 400: a InfinitePay não respondeu à conferência, ainda não marca como pago ou a cobrança acabou de
 *   ser conferida: ela repete o aviso;
 * - 404: pagamento desligado (sem chave).
 */
export const POST = comTratamento(
  "api/webhooks/infinitepay",
  async (request: Request, ctx: RouteContext<"/api/webhooks/infinitepay/[referencia]/[token]">) => {
    if (!infinitePayConfigurado()) return Response.json({ erro: "Recurso indisponível." }, { status: 404 });
    const { referencia, token } = await ctx.params;
    // O token é conferido ANTES de ler o corpo: quem não tem a URL não gasta nem a leitura.
    if (!avisoAutentico(referencia, token)) {
      return Response.json({ recebido: false, resultado: "token-invalido" }, { status: 401 });
    }
    const corpo = await lerJsonDoAviso(request);
    const { status, resultado } = await processarAvisoDaInfinitePay(referencia, token, corpo);
    if (status !== 200) console.warn(`[webhooks/infinitepay] aviso de ${referencia}: ${resultado} (${status})`);
    return Response.json({ recebido: status === 200, resultado }, { status });
  },
);
