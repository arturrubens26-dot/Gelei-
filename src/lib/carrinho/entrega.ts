import type { CotacaoEntrega } from "./store";

export type ResultadoEntrega =
  | { ok: true; cotacao: CotacaoEntrega }
  | { ok: false; mensagem: string };

/** Máscara de CEP enquanto digita: "01310100" → "01310-100". */
export function mascararCep(valor: string): string {
  const d = valor.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** Chama /api/delivery/calculate. O servidor valida o CEP e calcula o frete. */
export async function calcularEntrega(cep: string, pesoTotalGramas: number): Promise<ResultadoEntrega> {
  try {
    const resposta = await fetch("/api/delivery/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cep, pesoTotalGramas }),
    });
    const dados = await resposta.json().catch(() => null);
    if (!resposta.ok) {
      return { ok: false, mensagem: dados?.erro ?? "Não foi possível calcular a entrega." };
    }
    return {
      ok: true,
      cotacao: {
        cep: cep.replace(/\D/g, ""),
        valor: dados.valor,
        regiao: dados.regiao,
        pesoTotalGramas: dados.pesoTotalGramas,
        endereco: dados.endereco
          ? {
              rua: dados.endereco.rua ?? "",
              bairro: dados.endereco.bairro ?? "",
              cidade: dados.endereco.cidade ?? "",
              estado: dados.endereco.estado ?? "",
            }
          : undefined,
      },
    };
  } catch {
    return { ok: false, mensagem: "Sem conexão. Verifique sua internet e tente de novo." };
  }
}
