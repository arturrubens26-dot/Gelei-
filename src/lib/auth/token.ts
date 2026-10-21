/**
 * Token do link de redefinição de senha (node:crypto: só no servidor). Fora de redefinicao.ts para
 * os testes conseguirem importar (aquele é server-only).
 */
import { createHash, randomBytes } from "node:crypto";

/** 32 bytes aleatórios em base64url (43 caracteres, sem "="). */
export function gerarToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 em hex (64 caracteres). Um hash rápido basta: o token tem 256 bits de entropia. */
export function hashDoToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
