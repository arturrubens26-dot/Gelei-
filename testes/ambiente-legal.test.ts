// Testes da trava dos dados legais (D13): o formato do CNPJ/CPF e do e-mail da loja, e o bypass do teste
// ponta a ponta (E2E_DADOS_LEGAIS) que nunca pode valer no site publicado. Rode com: npm run test:unit
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { appUrlEmLoopback, e2eDadosLegaisAtivo, motivoDeRecusarE2eDadosLegais, validarAmbiente } from "@/lib/ambiente";
import { cnpjValido, cpfValido, dadosLegais, documentoValido, emailValido, pendenciasLegais } from "@/lib/dados-loja";

describe("CNPJ", () => {
  it("aceita CNPJ com os dígitos verificadores certos, com ou sem máscara", () => {
    assert.equal(cnpjValido("11.222.333/0001-81"), true);
    assert.equal(cnpjValido("11222333000181"), true);
    assert.equal(cnpjValido("  11.222.333/0001-81  "), true);
    assert.equal(cnpjValido("00.000.000/0001-91"), true, "o CNPJ do Banco do Brasil");
  });
  it("recusa dígito verificador errado, tamanho errado e sequência repetida", () => {
    assert.equal(cnpjValido("11.222.333/0001-80"), false);
    assert.equal(cnpjValido("11.222.333/0001-82"), false);
    assert.equal(cnpjValido("11.222.333/0001"), false);
    assert.equal(cnpjValido("112223330001811"), false);
    assert.equal(cnpjValido("00.000.000/0000-00"), false);
    assert.equal(cnpjValido("11.111.111/1111-11"), false);
    assert.equal(cnpjValido("abc"), false);
    assert.equal(cnpjValido(""), false);
  });
});

describe("CPF", () => {
  it("aceita CPF com os dígitos verificadores certos, com ou sem máscara", () => {
    assert.equal(cpfValido("529.982.247-25"), true);
    assert.equal(cpfValido("52998224725"), true);
    assert.equal(cpfValido("111.444.777-35"), true);
  });
  it("recusa dígito errado, tamanho errado e sequência repetida", () => {
    assert.equal(cpfValido("529.982.247-24"), false);
    assert.equal(cpfValido("529.982.247-2"), false);
    assert.equal(cpfValido("111.111.111-11"), false);
    assert.equal(cpfValido("000.000.000-00"), false);
    assert.equal(cpfValido(""), false);
  });
  it("documentoValido aceita um ou outro", () => {
    assert.equal(documentoValido("529.982.247-25"), true);
    assert.equal(documentoValido("11.222.333/0001-81"), true);
    assert.equal(documentoValido("123"), false);
  });
});

describe("e-mail de contato", () => {
  it("aceita e-mails de formato normal", () => {
    for (const e of ["contato@geleio.com.br", "ana.maria+loja@exemplo.com", "a@b.co", "geleio_loja@sub.dominio.org"]) {
      assert.equal(emailValido(e), true, e);
    }
  });
  it("recusa o que não é e-mail", () => {
    for (const e of ["", "contato@", "@geleio.com", "contato@geleio", "contato@geleio.c", "contato geleio@x.com", "a@@b.com", "a..b@x.com", ".a@x.com", "a.@x.com", "a@-x.com", "a@x..com", "<a>@x.com"]) {
      assert.equal(emailValido(e), false, JSON.stringify(e));
    }
  });
});

describe("pendências legais", () => {
  it("vazio bloqueia", () => {
    assert.deepEqual(pendenciasLegais({ documento: null, email: null }), ["o CNPJ (ou CPF) da loja", "o e-mail de contato"]);
    assert.deepEqual(pendenciasLegais({ documento: "  ", email: "" }), ["o CNPJ (ou CPF) da loja", "o e-mail de contato"]);
  });
  it("os dados que estão no código hoje (CPF e e-mail da dona) não deixam pendência", () => {
    assert.deepEqual(pendenciasLegais(dadosLegais), []);
  });
  it("preenchido com formato inválido continua bloqueando, com a mensagem certa", () => {
    assert.deepEqual(pendenciasLegais({ documento: "123", email: "contato@" }), ["um CNPJ (ou CPF) válido da loja", "um e-mail de contato válido"]);
    assert.deepEqual(pendenciasLegais({ documento: "11.222.333/0001-80", email: "contato@geleio.com.br" }), ["um CNPJ (ou CPF) válido da loja"]);
  });
  it("completo e válido libera", () => {
    assert.deepEqual(pendenciasLegais({ documento: "11.222.333/0001-81", email: "contato@geleio.com.br" }), []);
    assert.deepEqual(pendenciasLegais({ documento: "529.982.247-25", email: "contato@geleio.com.br" }), []);
  });
});

describe("bypass do teste ponta a ponta (E2E_DADOS_LEGAIS)", () => {
  const local: Record<string, string | undefined> = { E2E_DADOS_LEGAIS: "1", APP_URL: "http://localhost:3200" };
  it("APP_URL em loopback", () => {
    assert.equal(appUrlEmLoopback("http://localhost:3200"), true);
    assert.equal(appUrlEmLoopback("http://127.0.0.1:3100/"), true);
    assert.equal(appUrlEmLoopback("https://localhost:3200"), false, "https não é o teste local");
    assert.equal(appUrlEmLoopback("https://geleio.example"), false);
    assert.equal(appUrlEmLoopback("http://localhost.geleio.example"), false);
    assert.equal(appUrlEmLoopback("http://user:senha@localhost:3200"), false);
    assert.equal(appUrlEmLoopback("localhost:3200"), false);
    assert.equal(appUrlEmLoopback(undefined), false);
  });
  it("vale só com a flag em 1 e um ambiente local", () => {
    assert.equal(e2eDadosLegaisAtivo(local), true);
    assert.equal(e2eDadosLegaisAtivo({ ...local, E2E_DADOS_LEGAIS: "0" }), false);
    assert.equal(e2eDadosLegaisAtivo({ ...local, E2E_DADOS_LEGAIS: undefined }), false);
    assert.equal(e2eDadosLegaisAtivo({ ...local, APP_ENV: "development" }), true);
    assert.equal(e2eDadosLegaisAtivo({ ...local, APP_ENV: "demo" }), true, "o .env local usa APP_ENV=demo para o pagamento simulado");
  });
  it("recusa com NETLIFY, APP_ENV publicado ou APP_URL que não é loopback (inclusive sem APP_URL)", () => {
    assert.match(motivoDeRecusarE2eDadosLegais({ ...local, NETLIFY: "true" }) ?? "", /Netlify/);
    assert.equal(e2eDadosLegaisAtivo({ ...local, NETLIFY: "true" }), false);
    assert.equal(e2eDadosLegaisAtivo({ ...local, APP_ENV: "production" }), false);
    assert.equal(e2eDadosLegaisAtivo({ ...local, APP_ENV: "Produção" }), false);
    assert.equal(e2eDadosLegaisAtivo({ ...local, APP_ENV: "demo", APP_URL: "https://demo.geleio.example" }), false, "demonstração publicada: a APP_URL não é local");
    assert.equal(e2eDadosLegaisAtivo({ ...local, APP_URL: "https://geleio.example" }), false);
    assert.equal(e2eDadosLegaisAtivo({ ...local, APP_URL: undefined }), false);
    assert.equal(e2eDadosLegaisAtivo({ E2E_DADOS_LEGAIS: "1" }), false);
  });
});

describe("validarAmbiente recusa E2E_DADOS_LEGAIS fora de um ambiente local", () => {
  const env = process.env as Record<string, string | undefined>;
  const VARIAVEIS = ["DATABASE_URL", "SESSION_SECRET", "E2E_DADOS_LEGAIS", "NETLIFY", "APP_ENV", "APP_URL", "INFINITEPAY_HANDLE", "INFINITEPAY_API_KEY", "INFINITEPAY_API_URL", "PAGAMENTOS_SIMULADOS"];
  const guardado = Object.fromEntries(VARIAVEIS.map((v) => [v, env[v]]));
  const configurar = (extra: Record<string, string | undefined>) => {
    for (const v of VARIAVEIS) delete env[v];
    Object.assign(env, { DATABASE_URL: "postgresql://x@localhost/x", SESSION_SECRET: "s".repeat(40) }, extra);
  };
  afterEach(() => {
    for (const v of VARIAVEIS) {
      if (guardado[v] === undefined) delete env[v];
      else env[v] = guardado[v];
    }
  });

  it("sem a variável, sobe em qualquer ambiente (inclusive na Netlify)", () => {
    configurar({ NETLIFY: "true", APP_URL: "https://geleio.example" });
    assert.doesNotThrow(() => validarAmbiente());
  });
  it("local (APP_URL em http://localhost, sem NETLIFY): sobe", () => {
    configurar({ E2E_DADOS_LEGAIS: "1", APP_URL: "http://localhost:3200" });
    assert.doesNotThrow(() => validarAmbiente());
  });
  it("na Netlify: não sobe", () => {
    configurar({ E2E_DADOS_LEGAIS: "1", NETLIFY: "true", APP_URL: "http://localhost:3200" });
    assert.throws(() => validarAmbiente(), /E2E_DADOS_LEGAIS é só para o teste ponta a ponta neste computador/);
  });
  it("com APP_ENV de produção: não sobe; APP_ENV=demo local (o .env desta máquina) sobe, e demonstração publicada não", () => {
    configurar({ E2E_DADOS_LEGAIS: "1", APP_ENV: "production", APP_URL: "http://localhost:3200" });
    assert.throws(() => validarAmbiente(), /APP_ENV=production/);
    configurar({ E2E_DADOS_LEGAIS: "1", APP_ENV: "demo", APP_URL: "http://localhost:3200" });
    assert.doesNotThrow(() => validarAmbiente());
    configurar({ E2E_DADOS_LEGAIS: "1", APP_ENV: "demo", APP_URL: "https://demo.geleio.example" });
    assert.throws(() => validarAmbiente(), /APP_URL/);
  });
  it("com APP_URL do site (https) ou sem APP_URL: não sobe", () => {
    configurar({ E2E_DADOS_LEGAIS: "1", APP_URL: "https://geleio.example" });
    assert.throws(() => validarAmbiente(), /APP_URL/);
    configurar({ E2E_DADOS_LEGAIS: "1" });
    assert.throws(() => validarAmbiente(), /APP_URL/);
  });
  it("E2E_DADOS_LEGAIS=0 é inofensivo", () => {
    configurar({ E2E_DADOS_LEGAIS: "0", NETLIFY: "true", APP_URL: "https://geleio.example" });
    assert.doesNotThrow(() => validarAmbiente());
  });
});
