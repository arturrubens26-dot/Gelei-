import "server-only";
import bcrypt from "bcryptjs";
import { Semaforo } from "@/lib/semaforo";

/**
 * Senhas com bcrypt. O bcryptjs é JavaScript puro e custa centenas de milissegundos de
 * CPU por operação, então no máximo 2 rodam juntas (fila de 8); acima disso a requisição
 * é recusada com 503 em vez de travar o servidor numa enxurrada de logins/cadastros.
 *
 * Custo 11 (OWASP recomenda no mínimo 10). Hashes antigos com outro custo continuam
 * funcionando em `compare`.
 */
const CUSTO = 11;
const fila = new Semaforo(2, 8);

export const gerarHash = (senha: string): Promise<string> => fila.executar(() => bcrypt.hash(senha, CUSTO));

export const conferirSenha = (senha: string, hash: string): Promise<boolean> =>
  fila.executar(() => bcrypt.compare(senha, hash));

// Calculado já na subida: comparado quando o e-mail não existe, para o tempo de resposta
// não revelar quais e-mails estão cadastrados (e sem custo extra na primeira falha).
const hashFalso = bcrypt.hash("senha-que-ninguem-usa", CUSTO);

export async function conferirContraHashFalso(senha: string): Promise<boolean> {
  return conferirSenha(senha, await hashFalso);
}
