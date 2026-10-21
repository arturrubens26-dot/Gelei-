/**
 * Modelos dos e-mails da loja (puros: sem rede), em texto e em HTML simples, pt-BR, sem imagens nem
 * rastreamento. Tudo o que vem da conta (o nome) é escapado no HTML. Testado em
 * testes/redefinicao.test.ts.
 */
import { horaDeBrasilia, primeiroNome } from "@/lib/auth/redefinicao-regras";
import { dadosLoja } from "@/lib/dados-loja";

export type EmailMontado = { assunto: string; texto: string; html: string };

/** Escapa texto para dentro do HTML (corpo e atributos entre aspas). */
export function escaparHtml(texto: string): string {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const contato = `Instagram @${dadosLoja.instagram.usuario} (${dadosLoja.instagram.url})`;

function envelope(paragrafos: string[]): string {
  const corpo = paragrafos.map((p) => `<p style="margin:0 0 16px">${p}</p>`).join("\n");
  return (
    '<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#fff8ef;color:#3b2416;' +
    'font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">' +
    `<div style="max-width:520px;margin:0 auto">${corpo}</div></body></html>`
  );
}

/** "Crie sua nova senha": o link (com o token no fragmento), a validade e o "se não foi você". */
export function modeloRedefinicao(entrada: { nome: string; link: string; expiraEm: Date }): EmailMontado {
  const nome = primeiroNome(entrada.nome);
  const hora = horaDeBrasilia(entrada.expiraEm);
  const texto = [
    `Oi, ${nome}!`,
    "Recebemos um pedido para criar uma senha nova na sua conta da Geleiô. Para criar, abra o link abaixo:",
    entrada.link,
    `O link vale até as ${hora} (horário de Brasília) e funciona uma vez só.`,
    "Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.",
    `Dúvidas: ${contato}.`,
  ].join("\n\n");
  const html = envelope([
    `Oi, ${escaparHtml(nome)}!`,
    "Recebemos um pedido para criar uma senha nova na sua conta da Geleiô.",
    `<a href="${escaparHtml(entrada.link)}" style="display:inline-block;padding:12px 20px;background:#8a1c2b;color:#ffffff;` +
      'text-decoration:none;border-radius:8px;font-weight:bold">Criar senha nova</a>',
    `O link vale até as ${hora} (horário de Brasília) e funciona uma vez só.`,
    "Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.",
    `Dúvidas: ${escaparHtml(contato)}.`,
  ]);
  return { assunto: "Crie sua nova senha na Geleiô", texto, html };
}

/** "Sua senha foi alterada": aviso depois da troca, com dia e hora, e como falar com a loja. */
export function modeloSenhaAlterada(entrada: { nome: string; quando: Date }): EmailMontado {
  const nome = primeiroNome(entrada.nome);
  const brasilia = new Date(entrada.quando.getTime() - 3 * 60 * 60_000);
  const dia = brasilia.toISOString().slice(0, 10).split("-").reverse().join("/");
  const hora = horaDeBrasilia(entrada.quando);
  const texto = [
    `Oi, ${nome}!`,
    `A senha da sua conta da Geleiô foi alterada em ${dia}, às ${hora} (horário de Brasília).`,
    `Se não foi você, fale com a gente agora mesmo: ${contato}.`,
  ].join("\n\n");
  const html = envelope([
    `Oi, ${escaparHtml(nome)}!`,
    `A senha da sua conta da Geleiô foi alterada em ${dia}, às ${hora} (horário de Brasília).`,
    `Se não foi você, fale com a gente agora mesmo: ${escaparHtml(contato)}.`,
  ]);
  return { assunto: "Sua senha da Geleiô foi alterada", texto, html };
}
