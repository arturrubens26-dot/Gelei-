import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { dentroDoLimite } from "@/lib/auth/limitador";
import { validarEnderecoComCep } from "@/lib/cep";
import { db } from "@/lib/db";
import { listarEnderecos, obterOuCriarEndereco } from "@/lib/enderecos";
import { enderecoSchema } from "@/lib/validacao";

/** GET /api/addresses — endereços salvos do usuário logado. */
export const GET = comTratamento("api/addresses GET", async () => {
  const auth = await autenticarApi();
  if (!auth.ok) return auth.resposta;

  return Response.json({ enderecos: await listarEnderecos(auth.usuario.id) });
});

/**
 * POST /api/addresses — salva um endereço novo para o usuário logado.
 * Confere o CEP (existência, cidade e UF) antes de salvar.
 */
export const POST = comTratamento("api/addresses POST", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi();
  if (!auth.ok) return auth.resposta;

  // Cada endereço novo consulta provedores externos de CEP: limite por usuário.
  if (!dentroDoLimite(`enderecos|${auth.usuario.id}`, 60, 60 * 60_000)) {
    return erro(429, "Muitos endereços cadastrados em pouco tempo. Tente novamente mais tarde.");
  }

  const corpo = await lerCorpo(request, enderecoSchema);
  if (!corpo.ok) return corpo.resposta;

  const validacao = await validarEnderecoComCep(corpo.dados);
  if (!validacao.ok) return erro(validacao.status, validacao.mensagem);

  // O limite por usuário e a deduplicação rodam juntos, sob lock, dentro da transação.
  const endereco = await db.$transaction((tx) =>
    obterOuCriarEndereco(tx, auth.usuario.id, corpo.dados, { limitar: true }),
  );
  return Response.json({ endereco }, { status: 201 });
});
