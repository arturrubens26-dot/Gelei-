import "server-only";
import { ErroNegocio } from "@/lib/erros";

/**
 * Limita quantas tarefas caras rodam ao mesmo tempo (ex.: bcrypt, consultas de CEP a
 * serviços externos). Quando o limite e a fila enchem, recusa na hora com 503 em vez de
 * deixar o processo (ou o provedor externo) ser inundado.
 */
export class Semaforo {
  private emUso = 0;
  private readonly fila: (() => void)[] = [];

  constructor(
    private readonly maximo: number,
    private readonly maximoNaFila: number,
  ) {}

  async executar<T>(tarefa: () => Promise<T>): Promise<T> {
    if (this.emUso >= this.maximo) {
      if (this.fila.length >= this.maximoNaFila) {
        throw new ErroNegocio(503, "Servidor ocupado no momento. Tente novamente em instantes.");
      }
      // Quem libera passa a vaga adiante (sem decrementar `emUso`).
      await new Promise<void>((liberado) => this.fila.push(liberado));
    } else {
      this.emUso += 1;
    }

    try {
      return await tarefa();
    } finally {
      const proximo = this.fila.shift();
      if (proximo) proximo();
      else this.emUso -= 1;
    }
  }
}
