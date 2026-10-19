import "server-only";

/**
 * Erro de regra de negócio esperado (pedido inválido, endereço fora do limite…),
 * já com o status HTTP certo. Rotas embrulhadas em `comTratamento` o convertem
 * em resposta `{ erro, detalhes? }` sem tratá-lo como falha do servidor.
 */
export class ErroNegocio extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    readonly detalhes?: unknown,
  ) {
    super(mensagem);
    this.name = "ErroNegocio";
  }
}
