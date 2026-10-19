import { comTratamento, erro, lerJson } from "@/lib/api";
import { mercadoPagoConfigurado } from "@/lib/mercadopago";
import { assinaturaDoAvisoValida } from "@/lib/mercadopago-regras";
import { processarAvisoDoMercadoPago } from "@/lib/pagamentos";

/**
 * POST /api/webhooks/mercadopago — aviso do Mercado Pago de que um pagamento mudou.
 *
 * O aviso NÃO é prova de nada: só o id é usado, e só se for de uma cobrança que nós criamos. O
 * servidor então consulta o pagamento na API do Mercado Pago com o próprio token e confere pedido e
 * valor (src/lib/pagamentos.ts). Com MERCADOPAGO_WEBHOOK_SECRET definida, avisos sem a assinatura
 * certa são recusados (401). Responde 200 para o que ignora, senão o Mercado Pago repete o aviso.
 */
export const POST = comTratamento("api/webhooks/mercadopago", async (request: Request) => {
  if (!mercadoPagoConfigurado()) return erro(404, "Recurso indisponível.");

  const url = new URL(request.url);
  let dataId = url.searchParams.get("data.id");
  let tipo = url.searchParams.get("type");

  const segredo = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim();
  if (
    segredo &&
    !assinaturaDoAvisoValida({
      cabecalho: request.headers.get("x-signature"),
      requestId: request.headers.get("x-request-id"),
      dataId,
      segredo,
    })
  ) {
    return erro(401, "Assinatura inválida.");
  }

  // Sem os dados na URL (formato antigo), tenta o corpo: { type, data: { id } }.
  if (!dataId || !tipo) {
    const corpo = (await lerJson(request)) as { type?: unknown; data?: { id?: unknown } } | undefined;
    tipo ??= typeof corpo?.type === "string" ? corpo.type : null;
    const doCorpo = corpo?.data?.id;
    dataId ??= typeof doCorpo === "string" || typeof doCorpo === "number" ? String(doCorpo) : null;
  }

  if (tipo !== "payment" || !dataId || !/^\d{1,20}$/.test(dataId)) {
    return Response.json({ recebido: true });
  }
  const resultado = await processarAvisoDoMercadoPago(dataId);
  return Response.json({ recebido: true, resultado });
});
