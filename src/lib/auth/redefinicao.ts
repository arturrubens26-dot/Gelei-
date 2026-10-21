import "server-only";
import { db } from "@/lib/db";
import { emailConfigurado, enviarEmail } from "@/lib/email";
import { modeloRedefinicao, modeloSenhaAlterada } from "@/lib/email-modelos";
import { ErroNegocio } from "@/lib/erros";
import { gerarHash } from "./hash";
import { gerarToken, hashDoToken } from "./token";
import {
  FORMATO_TOKEN,
  MENSAGEM_LINK_INVALIDO,
  VALIDADE_LINK_SENHA_MS,
  conferenciaSuficiente,
  linkDeRedefinicao,
  mensagemSugerida,
  origemDoSite,
  type ConferenciaIdentidade,
  type LinkSenhaGeradoDTO,
  type OrigemRedefinicao,
} from "./redefinicao-regras";

/**
 * Redefinição de senha das CLIENTES (nunca de admin: a senha da dona só muda por
 * `npm run admin:senha`). Dois caminhos com o mesmo token:
 * - PAINEL (hoje, sem e-mail): a cliente chama a loja no Instagram, a dona confere a identidade e
 *   gera o link em /admin/clientes/[id] (`gerarLinkPeloPainel`);
 * - EMAIL (com SMTP): "Esqueci minha senha" manda o link (`pedirRedefinicaoPorEmail`, em `after()`).
 * O token (256 bits) vai no fragmento do link e só o SHA-256 dele fica no banco; vale 60 min, uma
 * vez, e um link novo invalida o anterior. A troca sobe `users.sessao_versao` (derruba as sessões).
 */

const emProducao = () => process.env.NODE_ENV === "production";

/** Limites contados NO BANCO (valem entre as instâncias da Netlify). */
const LIMITE_EMAIL_POR_CONTA_HORA = 3;
const LIMITE_EMAIL_POR_CONTA_DIA = 6;
/** Teto global de e-mails de redefinição por dia: protege a conta Gmail de bombardeio (~500/dia). */
const LIMITE_EMAILS_POR_DIA = 200;
const LIMITE_PAINEL_POR_ADMIN_HORA = 10;
const LIMITE_PAINEL_POR_CLIENTE_DIA = 3;
/** Registros mais antigos que isto são apagados (auditoria suficiente, dado mínimo). */
const GUARDAR_POR_MS = 365 * 24 * 60 * 60_000;
const HORA_MS = 60 * 60_000;
const DIA_MS = 24 * HORA_MS;

/**
 * Qual caminho as páginas /login e /esqueci-senha mostram: "email" com SMTP e APP_URL válida, ou
 * fora da produção (no desenvolvimento, sem SMTP, o link vai só para o log); senão, "instagram".
 */
export function modoRedefinicaoSenha(): "email" | "instagram" {
  if (emailConfigurado() && origemDoSite(process.env.APP_URL, emProducao())) return "email";
  return emProducao() ? "instagram" : "email";
}

/**
 * Cria o token da conta, invalidando os que ainda valiam (um link novo substitui o anterior). A
 * linha do usuário fica travada na transação: dois pedidos ao mesmo tempo não deixam dois valendo.
 */
async function criarToken(
  userId: string,
  origem: OrigemRedefinicao,
  extra: { geradoPorId?: string; conferencia?: ConferenciaIdentidade[]; observacao?: string | null } = {},
): Promise<{ token: string; expiraEm: Date }> {
  const token = gerarToken();
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + VALIDADE_LINK_SENHA_MS);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
    await tx.redefinicaoSenha.updateMany({
      where: { userId, usadoEm: null, invalidadoEm: null },
      data: { invalidadoEm: agora },
    });
    await tx.redefinicaoSenha.create({
      data: {
        userId,
        tokenHash: hashDoToken(token),
        origem,
        criadoEm: agora,
        expiraEm,
        geradoPorId: extra.geradoPorId ?? null,
        conferencia: extra.conferencia ?? [],
        observacao: extra.observacao ?? null,
      },
    });
  });
  // Limpeza de registros antigos (índice em criado_em). Falha aqui não atrapalha o link.
  await db.redefinicaoSenha
    .deleteMany({ where: { criadoEm: { lt: new Date(agora.getTime() - GUARDAR_POR_MS) } } })
    .catch((e) => console.error(`[senha] limpeza dos registros antigos falhou: ${(e as Error).name}`));
  return { token, expiraEm };
}

const desde = (ms: number) => ({ gte: new Date(Date.now() - ms) });

/**
 * Caminho B ("Esqueci minha senha"), chamado em `after()`: a resposta 202 já saiu, igual para
 * qualquer e-mail. Conta inexistente ou de admin, limite estourado ou falha de envio: nada acontece
 * para quem pediu, e o log leva só o id da conta (nunca o e-mail nem o link).
 */
export async function pedirRedefinicaoPorEmail(email: string): Promise<void> {
  const usuario = await db.user.findUnique({ where: { email }, select: { id: true, nome: true, email: true, isAdmin: true } });
  if (!usuario) return;
  if (usuario.isAdmin) {
    console.warn(`[senha] pedido de redefinição por e-mail para a conta de admin ${usuario.id}: ignorado`);
    return;
  }
  if (!origemDoSite(process.env.APP_URL, emProducao())) {
    console.error("[senha] APP_URL ausente ou sem https: link de redefinição não enviado.");
    return;
  }
  const [naHora, noDia, global] = await Promise.all([
    db.redefinicaoSenha.count({ where: { userId: usuario.id, origem: "EMAIL", criadoEm: desde(HORA_MS) } }),
    db.redefinicaoSenha.count({ where: { userId: usuario.id, origem: "EMAIL", criadoEm: desde(DIA_MS) } }),
    db.redefinicaoSenha.count({ where: { origem: "EMAIL", criadoEm: desde(DIA_MS) } }),
  ]);
  if (naHora >= LIMITE_EMAIL_POR_CONTA_HORA || noDia >= LIMITE_EMAIL_POR_CONTA_DIA) {
    console.warn(`[senha] limite de pedidos por e-mail da conta ${usuario.id}: nada enviado`);
    return;
  }
  if (global >= LIMITE_EMAILS_POR_DIA) {
    console.error(`[senha] teto de ${LIMITE_EMAILS_POR_DIA} e-mails de redefinição por dia atingido: nada enviado`);
    return;
  }

  const { token, expiraEm } = await criarToken(usuario.id, "EMAIL");
  const link = linkDeRedefinicao(process.env.APP_URL, token, emProducao())!;
  if (!emailConfigurado()) {
    // Só no desenvolvimento (modoRedefinicaoSenha não oferece o e-mail em produção sem SMTP).
    if (emProducao()) {
      console.error(`[senha] sem SMTP em produção: link da conta ${usuario.id} não enviado`);
      return;
    }
    console.info(`[email] (sem SMTP) link de redefinição: ${link}`);
    return;
  }
  try {
    await enviarEmail(usuario.email, modeloRedefinicao({ nome: usuario.nome, link, expiraEm }));
    console.info(`[senha] link de redefinição enviado por e-mail para a conta ${usuario.id}`);
  } catch (e) {
    console.error(`[senha] e-mail de redefinição da conta ${usuario.id} não saiu: ${(e as Error).message}`);
  }
}

/**
 * Caminho A: a dona gera o link no painel depois de conferir a identidade (seção 3.3 do plano). A
 * conta precisa ser de cliente (admin: 404) e a conferência, suficiente (400 em `conferencia`).
 */
export async function gerarLinkPeloPainel(entrada: {
  clienteId: string;
  adminId: string;
  conferencia: ConferenciaIdentidade[];
  observacao: string | null;
}): Promise<LinkSenhaGeradoDTO> {
  if (!origemDoSite(process.env.APP_URL, emProducao())) {
    throw new ErroNegocio(503, "Configure a APP_URL do site (https) para gerar links de redefinição.");
  }
  const cliente =
    entrada.clienteId.length > 0 && entrada.clienteId.length <= 100
      ? await db.user.findUnique({
          where: { id: entrada.clienteId },
          select: {
            id: true,
            nome: true,
            isAdmin: true,
            _count: { select: { addresses: true, orders: { where: { canal: "ONLINE" } } } },
          },
        })
      : null;
  if (!cliente || cliente.isAdmin) throw new ErroNegocio(404, "Cliente não encontrado.");

  const temHistorico = cliente._count.addresses > 0 || cliente._count.orders > 0;
  if (!conferenciaSuficiente(entrada.conferencia, temHistorico)) {
    const mensagem = temHistorico
      ? "Confira o e-mail, o nome e algo de um pedido ou do endereço antes de gerar o link."
      : "Confira o e-mail e o nome antes de gerar o link.";
    throw new ErroNegocio(400, mensagem, { conferencia: [mensagem] });
  }

  const [doAdmin, doCliente] = await Promise.all([
    db.redefinicaoSenha.count({ where: { geradoPorId: entrada.adminId, origem: "PAINEL", criadoEm: desde(HORA_MS) } }),
    db.redefinicaoSenha.count({ where: { userId: cliente.id, origem: "PAINEL", criadoEm: desde(DIA_MS) } }),
  ]);
  if (doAdmin >= LIMITE_PAINEL_POR_ADMIN_HORA) {
    throw new ErroNegocio(429, "Muitos links gerados na última hora. Espere um pouco e tente de novo.");
  }
  if (doCliente >= LIMITE_PAINEL_POR_CLIENTE_DIA) {
    throw new ErroNegocio(429, "Esta conta já recebeu 3 links hoje. Se for preciso, tente amanhã.");
  }

  const { token, expiraEm } = await criarToken(cliente.id, "PAINEL", {
    geradoPorId: entrada.adminId,
    conferencia: entrada.conferencia,
    observacao: entrada.observacao,
  });
  const link = linkDeRedefinicao(process.env.APP_URL, token, emProducao())!;
  console.info(
    `[senha] admin ${entrada.adminId} gerou link de redefinição para a conta ${cliente.id} ` +
      `(conferiu: ${entrada.conferencia.join(",")})`,
  );
  return { link, expiraEm: expiraEm.toISOString(), mensagemSugerida: mensagemSugerida(cliente.nome, link, expiraEm) };
}

/**
 * Troca a senha com o token. A senha nova já foi validada (senhaNovaSchema) ANTES de gastar o token.
 * Token vencido, usado, substituído, inexistente ou de admin: a mesma mensagem (400). O bcrypt roda
 * fora da transação; dentro dela, marcar o token como usado é atômico (duas abas não usam duas vezes).
 * Devolve a conta, para o aviso "sua senha foi alterada" (enviado em `after()`).
 */
export async function redefinirComToken(token: string, senha: string): Promise<{ userId: string; nome: string; email: string }> {
  if (!FORMATO_TOKEN.test(token)) throw new ErroNegocio(400, MENSAGEM_LINK_INVALIDO);
  const registro = await db.redefinicaoSenha.findUnique({
    where: { tokenHash: hashDoToken(token) },
    select: {
      id: true,
      userId: true,
      origem: true,
      usadoEm: true,
      invalidadoEm: true,
      expiraEm: true,
      user: { select: { isAdmin: true, nome: true, email: true } },
    },
  });
  if (!registro || registro.usadoEm || registro.invalidadoEm || registro.expiraEm.getTime() <= Date.now() || registro.user.isAdmin) {
    throw new ErroNegocio(400, MENSAGEM_LINK_INVALIDO);
  }

  const passwordHash = await gerarHash(senha);
  await db.$transaction(async (tx) => {
    const agora = new Date();
    const usado = await tx.redefinicaoSenha.updateMany({
      where: { id: registro.id, usadoEm: null, invalidadoEm: null, expiraEm: { gt: agora } },
      data: { usadoEm: agora },
    });
    if (usado.count !== 1) throw new ErroNegocio(400, MENSAGEM_LINK_INVALIDO);
    // De novo aqui dentro: a conta pode ter virado admin depois do link.
    const conta = await tx.user.updateMany({
      where: { id: registro.userId, isAdmin: false },
      data: { passwordHash, sessaoVersao: { increment: 1 } },
    });
    if (conta.count !== 1) throw new ErroNegocio(400, MENSAGEM_LINK_INVALIDO);
    await tx.redefinicaoSenha.updateMany({
      where: { userId: registro.userId, usadoEm: null, invalidadoEm: null },
      data: { invalidadoEm: agora },
    });
  });
  console.info(`[senha] senha da conta ${registro.userId} redefinida pelo link (${registro.origem})`);
  return { userId: registro.userId, nome: registro.user.nome, email: registro.user.email };
}

/** Aviso "Sua senha foi alterada" (só com SMTP; falha vai para o log, sem o e-mail). */
export async function avisarSenhaAlterada(conta: { userId: string; nome: string; email: string }): Promise<void> {
  if (!emailConfigurado()) return;
  try {
    await enviarEmail(conta.email, modeloSenhaAlterada({ nome: conta.nome, quando: new Date() }));
  } catch (e) {
    console.error(`[senha] aviso de senha alterada da conta ${conta.userId} não saiu: ${(e as Error).message}`);
  }
}
