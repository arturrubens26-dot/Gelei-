/** Canal de venda, formas de pagamento e regras puras da venda presencial (servidor e navegador). */
import { hojeNaLoja } from "@/lib/despesas";
import { TRANSICOES_PRESENCIAL, type StatusPedido } from "@/lib/status";

export const TODOS_CANAIS = ["ONLINE", "PRESENCIAL"] as const;

export type CanalPedido = (typeof TODOS_CANAIS)[number];

export const ROTULO_CANAL: Record<CanalPedido, string> = {
  ONLINE: "Online",
  PRESENCIAL: "Presencial",
};

export const FORMAS_PAGAMENTO = ["DINHEIRO", "PIX", "CARTAO_DEBITO", "CARTAO_CREDITO", "OUTRO"] as const;

export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export const ROTULO_FORMA_PAGAMENTO: Record<FormaPagamento, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "PIX",
  CARTAO_DEBITO: "Cartão de débito",
  CARTAO_CREDITO: "Cartão de crédito",
  OUTRO: "Outro",
};

/** Status com que a venda presencial nasce: entregue na hora (padrão) ou paga para entregar depois. */
export const STATUS_INICIAIS_PRESENCIAL = ["ENTREGUE", "PAGO"] as const;

/**
 * Preço unitário máximo na venda presencial: R$ 999,99. Um pote custa ~R$ 25; o teto pega o erro de
 * digitar "2490" no lugar de "24,90", que inflaria o faturamento.
 */
export const MAX_PRECO_UNITARIO_CENTAVOS = 99_999;

/** Itens (produtos diferentes) por venda presencial. */
export const MAX_ITENS_VENDA = 50;

/**
 * Acima disto (R$ 2.000,00) a venda só entra com confirmação explícita (`confirmarValorAlto`): pega
 * "99" digitado no lugar de "9" sem barrar uma venda grande de verdade (atacado).
 */
export const LIMITE_CONFIRMACAO_CENTAVOS = 200_000;

/** Até quantos dias atrás uma venda pode ser lançada (mês já fechado mexido sem querer). */
export const DIAS_RETROATIVOS = 90;

/** "2026-10-18" − 90 dias → "2026-07-20" (contas em UTC ao meio-dia: nunca muda de dia). */
export function somarDias(dia: string, dias: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Dia mais antigo aceito para uma venda lançada hoje. */
export function diaMinimoDaVenda(hoje: string = hojeNaLoja()): string {
  const limite = somarDias(hoje, -DIAS_RETROATIVOS);
  return limite > "2020-01-01" ? limite : "2020-01-01";
}

/**
 * createdAt da venda: agora, se não veio data ou ela é hoje; meio-dia de Brasília do dia informado,
 * se é retroativa (o Brasil não tem horário de verão desde 2019: -03:00 fixo).
 */
export function dataDaVenda(dia: string | undefined, agora: Date): Date {
  return !dia || dia === hojeNaLoja(agora) ? agora : new Date(`${dia}T12:00:00-03:00`);
}

/**
 * Texto livre que pode ir para a tela do admin: recusa controles C0/C1, marcas invisíveis de direção
 * (que invertem o texto na lista, ex.: U+202E) e meio caractere UTF-16 solto (vira "�" ao gravar).
 */
const TEXTO_INVALIDO =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function textoLivreValido(texto: string): boolean {
  return !TEXTO_INVALIDO.test(texto);
}

type ItemComparavel = { productId: string; quantidade: number; precoUnitarioCentavos: number };

/**
 * A venda já lançada com a mesma Idempotency-Key é a MESMA venda que está chegando agora?
 * - itens, forma de pagamento, nome e observação: iguais;
 * - data: só é comparada se veio no pedido (sem data = "hoje"; um reenvio depois da meia-noite
 *   não pode virar "outra venda");
 * - status: o pedido pode ter mudado depois (Entregue, Estornada); vale se o status atual é o pedido
 *   ou um que se alcança a partir dele.
 */
export function mesmaVenda(
  existente: {
    itens: ItemComparavel[];
    formaPagamento: string | null;
    clienteNome: string | null;
    observacao: string | null;
    diaDaVenda: string;
    status: StatusPedido;
  },
  entrada: {
    itens: ItemComparavel[];
    formaPagamento: string;
    clienteNome: string | null;
    observacao: string | null;
    data?: string;
    status: StatusPedido;
  },
): boolean {
  const mesmosItens =
    existente.itens.length === entrada.itens.length &&
    entrada.itens.every((i) =>
      existente.itens.some(
        (e) => e.productId === i.productId && e.quantidade === i.quantidade && e.precoUnitarioCentavos === i.precoUnitarioCentavos,
      ),
    );
  const statusCompativel =
    existente.status === entrada.status || TRANSICOES_PRESENCIAL[entrada.status].includes(existente.status);
  return (
    mesmosItens &&
    statusCompativel &&
    existente.formaPagamento === entrada.formaPagamento &&
    existente.clienteNome === entrada.clienteNome &&
    existente.observacao === entrada.observacao &&
    (entrada.data === undefined || existente.diaDaVenda === entrada.data)
  );
}

/** Nome mostrado nas listas: o do cadastro (online) ou o digitado pelo admin (presencial). */
export function nomeDoCliente(p: { clienteNome: string | null; user: { nome: string } | null }): string {
  if (p.user) return p.user.nome;
  return p.clienteNome ? `Venda presencial · ${p.clienteNome}` : "Venda presencial";
}
