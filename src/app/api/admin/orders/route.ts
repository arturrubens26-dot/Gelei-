import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { listarPedidosAdmin } from "@/lib/admin";
import { dentroDoLimite } from "@/lib/auth/limitador";
import { statusPedidoSchema, vendaPresencialSchema } from "@/lib/validacao";
import { TODOS_CANAIS, type CanalPedido } from "@/lib/vendas";
import { registrarVendaPresencial } from "@/lib/vendas-presenciais";

const MAX_PAGINA = 10_000;
const FORMATO_CHAVE = /^[A-Za-z0-9_-]{8,100}$/;

/**
 * GET /api/admin/orders?status=PENDENTE&canal=PRESENCIAL&pagina=1 — todos os pedidos (admin).
 * Valida is_admin no banco a cada chamada.
 */
export const GET = comTratamento("api/admin/orders GET", async (request: Request) => {
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;

  const { searchParams } = new URL(request.url);

  const statusBruto = searchParams.get("status");
  const status = statusBruto ? statusPedidoSchema.safeParse(statusBruto) : null;
  if (status && !status.success) return erro(400, "Status inválido.");

  const canalBruto = searchParams.get("canal");
  if (canalBruto && !(TODOS_CANAIS as readonly string[]).includes(canalBruto)) return erro(400, "Canal inválido.");
  const canal = (canalBruto ?? undefined) as CanalPedido | undefined;

  const pagina = Number(searchParams.get("pagina") ?? "1");
  if (!Number.isInteger(pagina) || pagina < 1 || pagina > MAX_PAGINA) return erro(400, "Página inválida.");

  return Response.json(await listarPedidosAdmin({ status: status?.data, canal, pagina }));
});

/**
 * POST /api/admin/orders — lança uma venda presencial (feira, balcão).
 * Entrada: { itens: [{ productId, quantidade, precoUnitarioCentavos }], formaPagamento,
 *            status?: ENTREGUE (padrão) | PAGO, data?: "AAAA-MM-DD" (padrão: hoje), clienteNome?, observacao? }
 * Cabeçalho `Idempotency-Key` OBRIGATÓRIO: reenviar a mesma chave devolve a venda já lançada (200).
 */
export const POST = comTratamento("api/admin/orders POST", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;

  const chave = request.headers.get("idempotency-key");
  if (!chave || !FORMATO_CHAVE.test(chave)) {
    return erro(400, "Envie o cabeçalho Idempotency-Key (de 8 a 100 letras, números, _ ou -).");
  }

  const corpo = await lerCorpo(request, vendaPresencialSchema);
  if (!corpo.ok) return corpo.resposta;

  // Por admin, contado só depois de validar (pedido inválido não gasta a cota): folga para uma feira
  // movimentada, mas segura um script ou uma conta comprometida. Em memória, por instância.
  if (!dentroDoLimite(`vendas-presenciais|${auth.usuario.id}`, 200, 60 * 60_000)) {
    return erro(429, "Muitas vendas lançadas em pouco tempo. Tente novamente mais tarde.");
  }

  const { venda, repetida } = await registrarVendaPresencial(auth.usuario.id, corpo.dados, chave);
  return Response.json({ venda }, { status: repetida ? 200 : 201 });
});
