import { registrarErro } from "@/lib/api";
import { getUsuarioAtual } from "@/lib/auth/dal";
import { dentroDoLimitePorCliente } from "@/lib/auth/limitador";
import { origemPublica } from "@/lib/infinitepay";
import { processarRetorno } from "@/lib/pagamentos";
import { unstable_rethrow } from "next/navigation";

/**
 * GET /pagamento/retorno?order_nsu=...&transaction_nsu=...&slug=...&receipt_url=... — a cliente
 * clicou em "Continuar" na página da InfinitePay. Se a sessão é da dona do pedido, a transação é
 * conferida no payment_check com o order_nsu do nosso banco (até 8 s; erro não derruba) e, se pagou
 * este pedido, ele vira PAGO aqui mesmo (processarRetorno). Responde SEMPRE 303 (é uma navegação do
 * navegador: nunca JSON de erro na tela) para /order-confirmation/<id>?retorno=1, e a URL final perde
 * a transação e o comprovante. Referência desconhecida, de outra conta, limite estourado ou falha do
 * banco: /meus-pedidos (ou /, sem sessão). Nunca redireciona para uma URL vinda da query.
 */
export async function GET(request: Request): Promise<Response> {
  const origem = origemPublica() ?? new URL(request.url).origin;
  const redirecionar = (caminho: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: new URL(caminho, origem).toString(), "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" },
    });

  if (!dentroDoLimitePorCliente(request, "pagamento-retorno", { porIp: 30, janelaMs: 60_000 })) return redirecionar("/meus-pedidos");
  let usuarioId: string | null = null;
  try {
    usuarioId = (await getUsuarioAtual())?.id ?? null;
    return redirecionar(await processarRetorno(new URL(request.url).searchParams, usuarioId));
  } catch (e) {
    unstable_rethrow(e);
    registrarErro("pagamento/retorno", e);
    return redirecionar(usuarioId ? "/meus-pedidos" : "/");
  }
}
