import "server-only";
import nodemailer from "nodemailer";
import type { EmailMontado } from "@/lib/email-modelos";
import { Semaforo } from "@/lib/semaforo";

/**
 * Envio de e-mail por SMTP (Gmail com senha de app, ou outro provedor). Desligado sem as variáveis:
 * `emailConfigurado()` só é verdadeiro com SMTP_HOST, SMTP_PORT (465 com TLS direto ou 587 com
 * STARTTLS), SMTP_USER, SMTP_PASS e EMAIL_REMETENTE ("Geleiô <conta@gmail.com>"; no Gmail precisa ser
 * a própria conta). EMAIL_RESPONDER_PARA é opcional. Os logs nunca levam o destinatário nem o
 * conteúdo (o link de redefinição é um segredo).
 */

type ConfigSmtp = { host: string; porta: 465 | 587; usuario: string; senha: string; remetente: string; responderPara?: string };

function configSmtp(): ConfigSmtp | null {
  const host = process.env.SMTP_HOST?.trim();
  const porta = Number(process.env.SMTP_PORT);
  const usuario = process.env.SMTP_USER?.trim();
  const senha = process.env.SMTP_PASS;
  const remetente = process.env.EMAIL_REMETENTE?.trim();
  if (!host || !usuario || !senha || !remetente || (porta !== 465 && porta !== 587)) return null;
  const responderPara = process.env.EMAIL_RESPONDER_PARA?.trim() || undefined;
  return { host, porta, usuario, senha, remetente, responderPara };
}

/** Todas as variáveis do SMTP definidas e com a porta 465 ou 587. */
export function emailConfigurado(): boolean {
  return configSmtp() !== null;
}

/** Variáveis do SMTP definidas pela metade (o validarAmbiente avisa na subida, sem derrubar o site). */
export function smtpIncompleto(): boolean {
  const alguma = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_REMETENTE"].some((v) => process.env[v]?.trim());
  return alguma && !emailConfigurado();
}

let transporte: ReturnType<typeof nodemailer.createTransport> | null = null;

function obterTransporte(config: ConfigSmtp) {
  transporte ??= nodemailer.createTransport({
    host: config.host,
    port: config.porta,
    // 465: TLS desde o início; 587: STARTTLS obrigatório (nunca texto puro).
    secure: config.porta === 465,
    requireTLS: config.porta === 587,
    auth: { user: config.usuario, pass: config.senha },
    // A função síncrona da Netlify tem 60 s: nenhum envio pode travar a requisição.
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  });
  return transporte;
}

/** No máximo 2 envios ao mesmo tempo (o Gmail limita conexões), com fila curta. */
const envios = new Semaforo(2, 20);

/**
 * Envia um e-mail. Sem SMTP configurado, lança (quem chama decide: a redefinição só usa e-mail com
 * `emailConfigurado()`). Erros do provedor sobem com a mensagem cortada (sem o destinatário).
 */
export async function enviarEmail(para: string, email: EmailMontado): Promise<void> {
  const config = configSmtp();
  if (!config) throw new Error("SMTP não configurado.");
  await envios.executar(async () => {
    try {
      await obterTransporte(config).sendMail({
        from: config.remetente,
        to: para,
        replyTo: config.responderPara,
        subject: email.assunto,
        text: email.texto,
        html: email.html,
      });
    } catch (e) {
      const codigo = (e as { code?: string }).code;
      // A mensagem do provedor pode citar o destinatário ("recipient rejected: <x@y>"): sai trocado.
      const motivo = (e instanceof Error ? e.message : "erro").replace(/[^\s@<>"']+@[^\s@<>"']+/g, "<e-mail>").slice(0, 120);
      throw new Error(`envio SMTP falhou${codigo ? ` (${codigo})` : ""}: ${motivo}`);
    }
  });
}
