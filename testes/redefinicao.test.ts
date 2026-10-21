import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONFERENCIAS,
  FORMATO_TOKEN,
  conferenciaSuficiente,
  horaDeBrasilia,
  linkDeRedefinicao,
  mensagemSugerida,
  origemDoSite,
  primeiroNome,
  sessaoValida,
  situacaoDoLink,
} from "../src/lib/auth/redefinicao-regras";
import { gerarToken, hashDoToken } from "../src/lib/auth/token";
import { escaparHtml, modeloRedefinicao, modeloSenhaAlterada } from "../src/lib/email-modelos";

describe("token e hash", () => {
  it("token de 43 caracteres base64url, diferente a cada vez", () => {
    const a = gerarToken();
    const b = gerarToken();
    assert.match(a, /^[A-Za-z0-9_-]{43}$/);
    assert.match(a, FORMATO_TOKEN);
    assert.notEqual(a, b);
  });

  it("hash SHA-256 em hex de 64 caracteres, estável", () => {
    const token = gerarToken();
    assert.match(hashDoToken(token), /^[0-9a-f]{64}$/);
    assert.equal(hashDoToken(token), hashDoToken(token));
    assert.equal(hashDoToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("link de redefinição", () => {
  const token = "A".repeat(43);

  it("só com APP_URL https em produção; token no fragmento", () => {
    assert.equal(linkDeRedefinicao("https://geleio.netlify.app", token, true), `https://geleio.netlify.app/redefinir-senha#t=${token}`);
    assert.equal(linkDeRedefinicao("https://geleio.netlify.app/qualquer/caminho?x=1", token, true), `https://geleio.netlify.app/redefinir-senha#t=${token}`);
    assert.equal(linkDeRedefinicao("http://geleio.netlify.app", token, true), null);
    assert.equal(linkDeRedefinicao(undefined, token, true), null);
    assert.equal(linkDeRedefinicao("  ", token, true), null);
    assert.equal(linkDeRedefinicao("https://user:senha@geleio.netlify.app", token, true), null);
    assert.equal(linkDeRedefinicao("javascript:alert(1)", token, false), null);
  });

  it("fora da produção aceita http e, sem APP_URL, o localhost", () => {
    assert.equal(linkDeRedefinicao("http://localhost:3100", token, false), `http://localhost:3100/redefinir-senha#t=${token}`);
    assert.equal(linkDeRedefinicao(undefined, token, false), `http://localhost:3000/redefinir-senha#t=${token}`);
    assert.equal(origemDoSite(undefined, false), "http://localhost:3000");
  });

  it("recusa token fora do formato", () => {
    assert.equal(linkDeRedefinicao("https://geleio.netlify.app", "curto", true), null);
    assert.equal(linkDeRedefinicao("https://geleio.netlify.app", `${"A".repeat(42)}#`, true), null);
  });
});

describe("conferência de identidade", () => {
  it("e-mail e nome sempre; com histórico, também pedido ou endereço", () => {
    assert.equal(conferenciaSuficiente(["EMAIL", "NOME"], false), true);
    assert.equal(conferenciaSuficiente(["EMAIL"], false), false);
    assert.equal(conferenciaSuficiente(["NOME", "PEDIDO"], true), false);
    assert.equal(conferenciaSuficiente(["EMAIL", "NOME"], true), false);
    assert.equal(conferenciaSuficiente(["EMAIL", "NOME", "PEDIDO"], true), true);
    assert.equal(conferenciaSuficiente(["EMAIL", "NOME", "ENDERECO"], true), true);
    // O telefone é registro a mais: não substitui pedido nem endereço.
    assert.equal(conferenciaSuficiente(["EMAIL", "NOME", "TELEFONE"], true), false);
    assert.deepEqual([...CONFERENCIAS], ["EMAIL", "NOME", "PEDIDO", "ENDERECO", "TELEFONE"]);
  });
});

describe("situação do link e versão de sessão", () => {
  const agora = Date.parse("2026-10-21T15:00:00Z");
  const base = { usadoEm: null, invalidadoEm: null, expiraEm: new Date(agora + 60_000) };

  it("valendo, usado, substituído e vencido", () => {
    assert.equal(situacaoDoLink(base, agora), "VALENDO");
    assert.equal(situacaoDoLink({ ...base, usadoEm: new Date(agora) }, agora), "USADO");
    assert.equal(situacaoDoLink({ ...base, invalidadoEm: new Date(agora) }, agora), "SUBSTITUIDO");
    assert.equal(situacaoDoLink({ ...base, expiraEm: new Date(agora) }, agora), "VENCIDO");
    // Usado vence a substituição (o registro não chega a ter os dois, mas a ordem fica clara).
    assert.equal(situacaoDoLink({ ...base, expiraEm: new Date(agora - 1), usadoEm: new Date(agora - 2) }, agora), "USADO");
  });

  it("sessão vale só com a mesma versão; token sem \"v\" chega como 0", () => {
    assert.equal(sessaoValida(0, 0), true);
    assert.equal(sessaoValida(0, 1), false);
    assert.equal(sessaoValida(2, 2), true);
    assert.equal(sessaoValida(3, 2), false);
  });
});

describe("regra da senha nova (cadastro e redefinição)", () => {
  const carregar = () => import("../src/lib/validacao");

  it("8 caracteres no mínimo e 72 bytes no máximo, com acentos contando em bytes", async () => {
    const { senhaNovaSchema, registroSchema, redefinirSenhaSchema } = await carregar();
    assert.equal(senhaNovaSchema.safeParse("1234567").success, false);
    assert.equal(senhaNovaSchema.safeParse("12345678").success, true);
    assert.equal(senhaNovaSchema.safeParse("a".repeat(72)).success, true);
    assert.equal(senhaNovaSchema.safeParse("a".repeat(73)).success, false);
    assert.equal(senhaNovaSchema.safeParse("ç".repeat(36)).success, true); // 72 bytes
    assert.equal(senhaNovaSchema.safeParse("ç".repeat(37)).success, false); // 74 bytes
    // O cadastro usa a mesma regra.
    assert.equal(registroSchema.safeParse({ nome: "Ana", email: "a@b.co", senha: "1234567" }).success, false);
    // Token ausente vira "" (a rota responde a mensagem única); a senha é conferida no schema.
    const semToken = redefinirSenhaSchema.parse({ senha: "12345678" });
    assert.equal(semToken.token, "");
    assert.equal(redefinirSenhaSchema.safeParse({ token: "x", senha: "curta" }).success, false);
  });

  it("link do painel: conferência sem repetidos e observação curta sem caracteres de controle", async () => {
    const { linkSenhaSchema } = await carregar();
    assert.deepEqual(linkSenhaSchema.parse({ conferencia: ["EMAIL", "NOME", "EMAIL"] }), { conferencia: ["EMAIL", "NOME"], observacao: null });
    assert.equal(linkSenhaSchema.safeParse({ conferencia: ["EMAIL", "CPF"] }).success, false);
    assert.equal(linkSenhaSchema.safeParse({ conferencia: ["EMAIL"], observacao: "x".repeat(201) }).success, false);
    assert.equal(linkSenhaSchema.safeParse({ conferencia: ["EMAIL"], observacao: "a‮b" }).success, false);
    assert.equal(linkSenhaSchema.parse({ conferencia: ["EMAIL"], observacao: " DM de 21/10 " }).observacao, "DM de 21/10");
  });
});

describe("mensagem sugerida e e-mails", () => {
  const expira = new Date("2026-10-21T18:40:00Z"); // 15:40 em Brasília
  const link = `https://geleio.netlify.app/redefinir-senha#t=${"B".repeat(43)}`;

  it("primeiro nome, hora de Brasília e o link sozinho na última linha", () => {
    assert.equal(primeiroNome("  Maria Clara Souza "), "Maria");
    assert.equal(horaDeBrasilia(expira), "15:40");
    const m = mensagemSugerida("Maria Clara", link, expira, new Date("2026-10-21T17:40:00Z"));
    assert.match(m, /^Oi, Maria! /);
    assert.match(m, /até as 15:40 de hoje/);
    assert.equal(m.split("\n").at(-1), link);
    // Gerado às 23:30 de Brasília: vale até 00:30 de amanhã.
    const tarde = mensagemSugerida("Ana", link, new Date("2026-10-22T03:30:00Z"), new Date("2026-10-22T02:30:00Z"));
    assert.match(tarde, /até as 00:30 de amanhã/);
  });

  it("escapa o nome no HTML e traz o link e a validade", () => {
    assert.equal(escaparHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    const e = modeloRedefinicao({ nome: "<script>alert(1)</script> Silva", link, expiraEm: expira });
    assert.ok(!e.html.includes("<script>"));
    assert.ok(e.html.includes("&lt;script&gt;"));
    assert.ok(e.texto.includes(link));
    assert.ok(e.html.includes(`href="${link}"`));
    assert.match(e.texto, /até as 15:40/);
    const alterada = modeloSenhaAlterada({ nome: "Ana <b>", quando: expira });
    assert.match(alterada.texto, /21\/10\/2026, às 15:40/);
    assert.ok(alterada.html.includes("Oi, Ana!")); // só o primeiro nome
    assert.ok(!alterada.html.includes("<b>"));
  });
});
