/**
 * Redefinição de senha: contrato e regras puras (servidor e navegador; sem rede, sem banco e sem
 * node:crypto, para poder ser importado por componentes de cliente). O token e o hash ficam em
 * src/lib/auth/redefinicao.ts (server-only). Testado em testes/redefinicao.test.ts.
 */

/** Validade do link de redefinição (painel e e-mail). */
export const VALIDADE_LINK_SENHA_MS = 60 * 60_000;

/** O que a dona conferiu antes de gerar o link no painel (`POST /api/admin/clientes/[id]/link-senha`). */
export const CONFERENCIAS = ["EMAIL", "NOME", "PEDIDO", "ENDERECO", "TELEFONE"] as const;
export type ConferenciaIdentidade = (typeof CONFERENCIAS)[number];

export const ROTULO_CONFERENCIA: Record<ConferenciaIdentidade, string> = {
  EMAIL: "Ela disse o e-mail da conta (sem eu sugerir)",
  NOME: "Ela disse o nome como está no cadastro",
  PEDIDO: "Ela disse algo de um pedido (sabores, kit, mês ou código)",
  ENDERECO: "Ela disse o bairro ou o CEP da entrega",
  TELEFONE: "Ela disse o telefone, e o final confere",
};

/** Máximo da observação opcional do painel. */
export const MAX_OBSERVACAO_LINK = 200;

export type OrigemRedefinicao = "EMAIL" | "PAINEL";
export type SituacaoLinkSenha = "VALENDO" | "USADO" | "VENCIDO" | "SUBSTITUIDO";

/** Mensagem única para token vencido, usado, substituído ou inexistente. */
export const MENSAGEM_LINK_INVALIDO = "Este link não vale mais. Peça um novo.";
/** Resposta 202 do "Esqueci minha senha" (igual com ou sem conta). */
export const MENSAGEM_PEDIDO_ENVIADO =
  "Se houver uma conta com esse e-mail, enviamos um link para criar uma senha nova. Ele vale por 1 hora. Confira também a caixa de spam.";

/** `buscarClientes` (em @/lib/clientes-admin): só contas de cliente, nunca de admin. */
export type ClienteResumoDTO = {
  id: string;
  nome: string;
  email: string;
  /** ISO. */
  criadoEm: string;
  /** Pedidos online. */
  pedidos: number;
};

/** `fichaDoCliente` (em @/lib/clientes-admin). */
export type ClienteDetalheDTO = ClienteResumoDTO & {
  enderecos: number;
  /** 4 últimos dígitos do último telefone informado num pedido (conferência); null se nunca informou. */
  telefoneFinal: string | null;
  /** Os 5 últimos pedidos online. `cepInicio`: os 5 primeiros dígitos do CEP (null na retirada). */
  ultimosPedidos: {
    id: string;
    codigo: string;
    createdAt: string;
    status: "PENDENTE" | "PAGO" | "ENVIADO" | "ENTREGUE" | "CANCELADO";
    total: number;
    resumo: string;
    modoEntrega: "ENTREGA" | "RETIRADA";
    bairro: string | null;
    cidade: string | null;
    cepInicio: string | null;
  }[];
  /** Histórico de links de redefinição (mais recente primeiro). */
  links: {
    criadoEm: string;
    origem: OrigemRedefinicao;
    /** Nome do admin que gerou (PAINEL); null no e-mail ou se a conta do admin saiu. */
    geradoPor: string | null;
    situacao: SituacaoLinkSenha;
    expiraEm: string;
  }[];
  /** Conta sem pedidos nem endereços: o painel avisa para conferir com mais cuidado. */
  semHistorico: boolean;
};

/** Resposta 201 de `POST /api/admin/clientes/[id]/link-senha` (o link aparece UMA vez). */
export type LinkSenhaGeradoDTO = {
  link: string;
  expiraEm: string;
  mensagemSugerida: string;
};
