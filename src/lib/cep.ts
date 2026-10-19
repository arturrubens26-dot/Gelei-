import "server-only";
import consultaCep from "cep-promise";
import { Semaforo } from "@/lib/semaforo";

export type EnderecoDoCep = {
  cep: string;
  rua: string;
  bairro: string;
  cidade: string;
  estado: string;
};

export type ResultadoCep =
  | { ok: true; endereco: EnderecoDoCep }
  | { ok: false; motivo: "invalido" | "indisponivel" };

// Cache curto: evita martelar os serviços externos e acelera o checkout (o CEP é consultado
// no carrinho e de novo ao criar o pedido). CEP inexistente também é guardado, por menos tempo.
const cache = new Map<string, { expiraEm: number; endereco: EnderecoDoCep | null }>();
const TTL_MS = 30 * 60 * 1000;
const TTL_INVALIDO_MS = 5 * 60 * 1000;
const MAX_NO_CACHE = 5000;

function guardar(cep: string, endereco: EnderecoDoCep | null) {
  if (cache.size >= MAX_NO_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(cep, { expiraEm: Date.now() + (endereco ? TTL_MS : TTL_INVALIDO_MS), endereco });
}

// No máximo 4 consultas simultâneas aos provedores (fila de 20): uma enxurrada de CEPs
// distintos não pode fazer os provedores bloquearem o IP do servidor para todo mundo.
const consultasEmCurso = new Semaforo(4, 20);

const NAO_ENCONTRADO = /n[ãa]o encontrado|not found/i;

/**
 * Valida o CEP e busca o endereço (cep-promise consulta BrasilAPI, ViaCEP e
 * outros em paralelo). Recebe CEP já normalizado (8 dígitos).
 *
 * - `invalido`: formato inválido, ou pelo menos 2 provedores independentes dizem que não existe.
 * - `indisponivel`: nenhuma base respondeu direito (ex.: fora do ar/sem rede). Se só um provedor
 *   diz "não encontrado" e os outros falharam, não dá para afirmar que o CEP não existe.
 */
export async function consultarCep(cep: string): Promise<ResultadoCep> {
  const guardado = cache.get(cep);
  if (guardado && guardado.expiraEm > Date.now()) {
    return guardado.endereco
      ? { ok: true, endereco: guardado.endereco }
      : { ok: false, motivo: "invalido" };
  }

  try {
    const r = await consultasEmCurso.executar(() => consultaCep(cep, { timeout: 6000 }));
    const endereco: EnderecoDoCep = {
      cep: r.cep,
      rua: r.street,
      bairro: r.neighborhood,
      cidade: r.city,
      estado: r.state,
    };
    guardar(cep, endereco);
    return { ok: true, endereco };
  } catch (e) {
    // Fila cheia do semáforo: é do nosso lado, deixa subir como 503.
    if (e instanceof Error && e.name === "ErroNegocio") throw e;

    const tipo = (e as { type?: string }).type;
    const erros = (e as { errors?: { message?: string }[] }).errors ?? [];
    // Na prática, para um CEP inexistente só alguns provedores dizem "não encontrado" (os demais
    // falham por conta própria: XML ilegível, bug de biblioteca, fora do ar). Exigir TODOS faria quase
    // todo CEP errado virar "serviço indisponível". Dois provedores independentes concordando basta;
    // um único "não encontrado" com os outros em erro continua ambíguo (503).
    const naoEncontrados = erros.filter((x) => NAO_ENCONTRADO.test(x.message ?? "")).length;
    if (tipo === "validation_error" || naoEncontrados >= 2) {
      guardar(cep, null);
      return { ok: false, motivo: "invalido" };
    }
    console.error(`[cep] serviços de CEP indisponíveis (${tipo ?? (e instanceof Error ? e.name : "erro")})`);
    return { ok: false, motivo: "indisponivel" };
  }
}

/** "São Paulo", "sao paulo " e "Mogi-Guaçu"/"Mogi Guaçu" viram a mesma coisa para comparar. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ValidacaoEndereco = { ok: true } | { ok: false; status: 422 | 503; mensagem: string };

/**
 * Confere se o CEP existe e se cidade/UF digitadas batem com ele. Sem isso, dá
 * para informar um CEP de capital (frete barato) com endereço em outro estado.
 */
export async function validarEnderecoComCep(e: {
  cep: string;
  cidade: string;
  estado: string;
}): Promise<ValidacaoEndereco> {
  const consulta = await consultarCep(e.cep);
  if (!consulta.ok) {
    return consulta.motivo === "invalido"
      ? { ok: false, status: 422, mensagem: "CEP inválido ou não encontrado." }
      : { ok: false, status: 503, mensagem: "Não foi possível validar o CEP agora. Tente novamente em instantes." };
  }
  const real = consulta.endereco;
  if (real.estado.toUpperCase() !== e.estado.toUpperCase()) {
    return { ok: false, status: 422, mensagem: `Esse CEP é de ${real.cidade}/${real.estado}, mas o estado informado é ${e.estado}.` };
  }
  if (normalizar(real.cidade) !== normalizar(e.cidade)) {
    return { ok: false, status: 422, mensagem: `Esse CEP é de ${real.cidade}/${real.estado}, mas a cidade informada é ${e.cidade}.` };
  }
  return { ok: true };
}
