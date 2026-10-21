import { after } from "next/server";
import { comTratamento, erro, lerCorpo, origemInvalida, registrarErro } from "@/lib/api";
import { dentroDoLimite, dentroDoLimitePorCliente } from "@/lib/auth/limitador";
import { modoRedefinicaoSenha, pedirRedefinicaoPorEmail } from "@/lib/auth/redefinicao";
import { MENSAGEM_PEDIDO_ENVIADO } from "@/lib/auth/redefinicao-regras";
import { dadosLoja } from "@/lib/dados-loja";
import { esqueciSenhaSchema } from "@/lib/validacao";

const MINUTOS_15 = 15 * 60_000;
const HORA = 60 * 60_000;
const DIA = 24 * HORA;

/**
 * POST /api/auth/esqueci-senha `{ email }` → 202 `{ ok: true, mensagem }`, SEMPRE igual e antes de
 * procurar a conta (o tempo de resposta não revela quem tem conta). A busca, o token e o envio vão em
 * `after()`. 400 e-mail malformado; 403 CSRF; 404 sem o caminho por e-mail (produção sem SMTP: a
 * página orienta o Instagram); 429 por IP (só com IP_HEADER_CONFIAVEL).
 */
export const POST = comTratamento("api/auth/esqueci-senha", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  if (modoRedefinicaoSenha() !== "email") {
    return erro(404, `A recuperação por e-mail ainda não está disponível. Fale com a loja no Instagram @${dadosLoja.instagram.usuario}.`);
  }
  if (
    !dentroDoLimitePorCliente(request, "esqueci-senha-15min", { porIp: 5, janelaMs: MINUTOS_15 }) ||
    !dentroDoLimitePorCliente(request, "esqueci-senha-dia", { porIp: 20, janelaMs: DIA })
  ) {
    return erro(429, "Muitos pedidos. Aguarde alguns minutos e tente de novo.");
  }

  const corpo = await lerCorpo(request, esqueciSenhaSchema);
  if (!corpo.ok) return corpo.resposta;
  const { email } = corpo.dados;

  // Por e-mail, em memória (3 por hora nesta instância; o limite que vale entre instâncias é contado
  // no banco). Estourou: a resposta é a mesma e nada é enviado.
  if (dentroDoLimite(`esqueci-senha|email|${email}`, 3, HORA)) {
    after(() => pedirRedefinicaoPorEmail(email).catch((e) => registrarErro("api/auth/esqueci-senha (envio)", e)));
  }
  return Response.json({ ok: true, mensagem: MENSAGEM_PEDIDO_ENVIADO }, { status: 202 });
});
