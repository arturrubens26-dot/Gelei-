import "server-only";

/**
 * Limitadores em memória (janela fixa). Valem por instância do servidor: em produção com
 * várias instâncias, troque por um armazenamento compartilhado (Redis, Upstash...).
 */

type Contador = { quantidade: number; expiraEm: number };

const MAX_CHAVES = 50_000;

/** Mantém o mapa pequeno: remove expiradas e, se continuar cheio, as mais antigas. */
function aparar(mapa: Map<string, Contador>): void {
  if (mapa.size < MAX_CHAVES) return;
  const agora = Date.now();
  for (const [chave, contador] of mapa) {
    if (contador.expiraEm < agora) mapa.delete(chave);
  }
  // Ainda cheio (inundação de chaves distintas): descarta as mais antigas (ordem de inserção).
  let excedente = mapa.size - Math.floor(MAX_CHAVES * 0.9);
  for (const chave of mapa.keys()) {
    if (excedente-- <= 0) break;
    mapa.delete(chave);
  }
}

// --- tentativas de login ----------------------------------------------------

const tentativas = new Map<string, Contador>();
const JANELA_TENTATIVAS_MS = 15 * 60 * 1000;

/**
 * Reserva uma tentativa ANTES de gastar CPU com a senha (síncrono: uma rajada paralela de
 * palpites não passa toda de uma vez). Devolve `false` se o limite da janela já foi atingido.
 * Em caso de sucesso, devolva a vaga com `liberarTentativa` ou zere com `limparTentativas`.
 */
export function reservarTentativa(chave: string, max: number): boolean {
  const agora = Date.now();
  let registro = tentativas.get(chave);
  if (!registro || registro.expiraEm < agora) {
    aparar(tentativas);
    registro = { quantidade: 0, expiraEm: agora + JANELA_TENTATIVAS_MS };
    tentativas.set(chave, registro);
  }
  if (registro.quantidade >= max) return false;
  registro.quantidade += 1;
  return true;
}

/** Devolve uma vaga reservada (login que deu certo não conta contra a conta). */
export function liberarTentativa(chave: string): void {
  const registro = tentativas.get(chave);
  if (registro && registro.quantidade > 0) registro.quantidade -= 1;
}

export function limparTentativas(chave: string): void {
  tentativas.delete(chave);
}

/** Falhas toleradas por conta + IP a cada 15 minutos (IP só existe com proxy confiável). */
export const LIMITE_TENTATIVAS_CONTA_E_IP = 8;
/** Teto por conta, qualquer que seja o IP (vários IPs não multiplicam as tentativas sem limite). */
export const LIMITE_TENTATIVAS_POR_CONTA_COM_IP = 40;
/** Sem IP confiável só existe o limite por conta (aceita que alguém possa travar a conta de outro). */
export const LIMITE_TENTATIVAS_POR_CONTA_SEM_IP = 8;

// --- usos (rotas custosas) --------------------------------------------------

const usos = new Map<string, Contador>();

/** Conta um uso e diz se ainda está dentro do limite. */
export function dentroDoLimite(chave: string, max: number, janelaMs: number): boolean {
  const agora = Date.now();
  const registro = usos.get(chave);
  if (!registro || registro.expiraEm < agora) {
    aparar(usos);
    usos.set(chave, { quantidade: 1, expiraEm: agora + janelaMs });
    return true;
  }
  registro.quantidade += 1;
  return registro.quantidade <= max;
}

// --- identificação do cliente -----------------------------------------------

/**
 * IP do cliente, SÓ se você disser qual cabeçalho o seu proxy/CDN confiável define
 * (IP_HEADER_CONFIAVEL, ex.: "x-real-ip", "cf-connecting-ip" ou "x-forwarded-for").
 * Sem a variável não existe IP confiável: qualquer cabeçalho de IP viria do próprio
 * cliente e seria forjável, então devolvemos `null`. Não há adivinhação por heurística.
 *
 * Em "x-forwarded-for" vale o ÚLTIMO valor (o que o nosso proxy acrescentou); o primeiro
 * é controlado pelo cliente. O seu proxy precisa SOBRESCREVER (ou acrescentar ao fim) o
 * cabeçalho escolhido; se ele repassar o valor do cliente intacto, o IP continua forjável.
 */
export function ipConfiavel(request: Request): string | null {
  const nome = process.env.IP_HEADER_CONFIAVEL?.trim().toLowerCase();
  if (!nome) return null;
  const valor = request.headers.get(nome);
  if (!valor) return null;
  const ip = nome === "x-forwarded-for" ? valor.split(",").at(-1) : valor;
  return ip?.trim() || null;
}

/**
 * Limite por IP. Sem IP confiável NÃO há limite por cliente: um balde "global" deixaria
 * qualquer anônimo bloquear a rota para todo mundo. Nesse caso a CPU e os serviços
 * externos são protegidos pelos semáforos (src/lib/semaforo.ts), não por este limite.
 */
export function dentroDoLimitePorCliente(
  request: Request,
  rotulo: string,
  limites: { porIp: number; janelaMs: number },
): boolean {
  const ip = ipConfiavel(request);
  return ip ? dentroDoLimite(`${rotulo}|ip|${ip}`, limites.porIp, limites.janelaMs) : true;
}
