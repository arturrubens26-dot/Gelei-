/**
 * Planilha financeira: regras puras (sem banco, sem `Date` local), usadas no servidor e no navegador.
 * Datas como o Excel brasileiro escreve (dd/mm, sempre dia antes do mês), número de série do Excel, valores,
 * impressão digital de duplicado, TSV colado do Excel, mapeamento de colunas, top N + "Outros", resultado
 * diário com saldo acumulado, margem e variação contra o ano anterior. Dinheiro sempre em centavos inteiros.
 * Testado em testes/planilha.test.ts.
 */
import { lerValorEmCentavos } from "@/lib/dinheiro";
import type { FormaPagamento } from "@/lib/vendas";
import type { TipoLancamento } from "@/lib/planilha/tipos";

// --- datas ("AAAA-MM-DD", sempre em UTC puro: nada de fuso do computador) --------------------------------

const PADRAO_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** O dia existe no calendário? ("2026-02-29" não; "2028-02-29" sim). */
export function diaValido(dia: string): boolean {
  const m = PADRAO_DIA.exec(dia);
  if (!m) return false;
  const [ano, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mes < 1 || mes > 12 || d < 1) return false;
  return d <= diasNoMes(ano, mes);
}

function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");
const montarDia = (ano: number, mes: number, d: number) => `${String(ano).padStart(4, "0")}-${doisDigitos(mes)}-${doisDigitos(d)}`;

/** "2026-11-07" + 3 → "2026-11-10" (negativo volta). */
export function somarDias(dia: string, delta: number): string {
  const [ano, mes, d] = dia.split("-").map(Number);
  const t = new Date(Date.UTC(ano, mes - 1, d + delta));
  return montarDia(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Dias de `de` até `ate` (0 se iguais; negativo se `ate` vem antes). */
export function diasEntre(de: string, ate: string): number {
  const ms = (dia: string) => {
    const [a, m, d] = dia.split("-").map(Number);
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((ms(ate) - ms(de)) / 86_400_000);
}

const NOMES_DIA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(dia: string): number {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

export const nomeDiaDaSemana = (dia: string) => NOMES_DIA_SEMANA[diaDaSemana(dia)];

/** Último dia do mês "AAAA-MM" ("2026-02" → "2026-02-28"). */
export function fimDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return montarDia(a, m, diasNoMes(a, m));
}

/** O mês de "hoje" inteiro: o período padrão da planilha. */
export function periodoDoMes(hoje: string): { de: string; ate: string } {
  const mes = hoje.slice(0, 7);
  return { de: `${mes}-01`, ate: fimDoMes(mes) };
}

/** O mesmo dia um ano antes (29/02 vira 28/02). */
export function mesmoDiaAnoAnterior(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  return montarDia(a - 1, m, Math.min(d, diasNoMes(a - 1, m)));
}

export const PRIMEIRO_DIA = "2020-01-01";

export type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: string };

/**
 * Período pedido à API: dias reais, `de <= ate`, de 2020 em diante e no máximo `maxDias` dias (inclusive).
 * Não limita o futuro: "o mês atual" vai até o último dia do mês.
 */
export function validarPeriodo(de: string, ate: string, maxDias: number): Resultado<{ de: string; ate: string }> {
  if (!diaValido(de) || !diaValido(ate)) return { ok: false, erro: "Período inválido (use AAAA-MM-DD)." };
  if (de > ate) return { ok: false, erro: "A data inicial é depois da final." };
  if (de < PRIMEIRO_DIA) return { ok: false, erro: "Use datas de 2020 em diante." };
  if (ate > "2099-12-31") return { ok: false, erro: "Período inválido." };
  if (diasEntre(de, ate) + 1 > maxDias) return { ok: false, erro: `O período pode ter no máximo ${maxDias} dias.` };
  return { ok: true, valor: { de, ate } };
}

/**
 * Data digitada na planilha, sempre DIA antes do mês (como no Excel em português): "7/11", "07/11/26",
 * "07/11/2026", "7-11-2026", "7.11.2026" e também "2026-11-07". Sem ano = ano de `hoje`. Ano com 2 dígitos =
 * 20xx. "02/13/2026" é erro (não existe mês 13): nunca troca para mês/dia. Data futura e antes de 2020: erro.
 */
export function lerDataPlanilha(texto: string, hoje: string): Resultado<string> {
  const t = texto.trim();
  if (!t) return { ok: false, erro: "Informe a data." };
  let dia: string | null = null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) dia = montarDia(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  else {
    const br = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t);
    if (!br) return { ok: false, erro: "Data inválida (use dia/mês/ano, ex.: 07/11/2026)." };
    const ano = br[3] === undefined ? Number(hoje.slice(0, 4)) : br[3].length === 2 ? 2000 + Number(br[3]) : Number(br[3]);
    dia = montarDia(ano, Number(br[2]), Number(br[1]));
  }
  if (!diaValido(dia)) return { ok: false, erro: "Essa data não existe." };
  if (dia < PRIMEIRO_DIA) return { ok: false, erro: "Use uma data de 2020 em diante." };
  if (dia > hoje) return { ok: false, erro: "A data não pode ser depois de hoje." };
  return { ok: true, valor: dia };
}

/**
 * Número de série de data do Excel (sistema 1900) → "AAAA-MM-DD". A hora (parte fracionária) é ignorada.
 * O Excel conta um 29/02/1900 que não existiu (série 60): ele é recusado; de 61 em diante, desconta o dia a mais.
 * Fora de 1 a 2958465 (31/12/9999): null.
 */
export function serieExcelParaDia(serie: number): string | null {
  if (!Number.isFinite(serie)) return null;
  const n = Math.floor(serie);
  if (n < 1 || n > 2_958_465 || n === 60) return null;
  // Até a série 59, a contagem parte de 31/12/1899; depois do dia falso, de 30/12/1899.
  const base = n < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const t = new Date(base + n * 86_400_000);
  return montarDia(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** "AAAA-MM-DD" → série do Excel (o inverso de `serieExcelParaDia`), para exportar a data como data. */
export function diaParaSerieExcel(dia: string): number {
  const [a, m, d] = dia.split("-").map(Number);
  const n = Math.round((Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
  return n <= 60 ? n - 1 : n;
}

// --- valores ----------------------------------------------------------------------------------------------

/**
 * Valor digitado ou colado: "12,5", "R$ 1.234,56", "-12,50", "R$ -5", "(12,50)" (negativo do Excel contábil)
 * ou um número vindo do Excel (12.5). Devolve CENTAVOS com sinal; zero é aceito aqui (quem chama decide).
 * Mais de 2 casas ou formato ambíguo ("1.2,5"): erro, nunca adivinha.
 */
export function lerValorPlanilha(entrada: string | number): Resultado<number> {
  if (typeof entrada === "number") {
    if (!Number.isFinite(entrada)) return { ok: false, erro: "Valor inválido." };
    const centavos = Math.round(entrada * 100);
    if (Math.abs(entrada * 100 - centavos) > 1e-6) return { ok: false, erro: "Use no máximo 2 casas decimais." };
    return { ok: true, valor: centavos === 0 ? 0 : centavos };
  }
  let t = entrada.trim().replace(/ /g, " ");
  if (!t) return { ok: false, erro: "Informe o valor." };
  let negativo = false;
  const parenteses = /^\((.*)\)$/.exec(t);
  if (parenteses) {
    negativo = true;
    t = parenteses[1].trim();
  }
  // O sinal pode vir antes ou depois do "R$": "-R$ 5,00", "R$ -5,00", "- 5".
  t = t.replace(/^R\$\s*/i, "");
  if (/^[-−–]/.test(t)) {
    if (negativo) return { ok: false, erro: "Valor inválido." };
    negativo = true;
    t = t.slice(1).trim().replace(/^R\$\s*/i, "");
  }
  if (/^\+/.test(t)) t = t.slice(1).trim();
  const centavos = lerValorEmCentavos(t);
  if (centavos === null) return { ok: false, erro: "Valor inválido (ex.: 12,50 ou R$ 1.234,56)." };
  return { ok: true, valor: negativo && centavos !== 0 ? -centavos : centavos };
}

/** Centavos → "1234,56" (para pôr num campo ou num CSV). */
export function centavosParaTexto(centavos: number): string {
  const sinal = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  return `${sinal}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Percentual com 1 casa (12,3%), ou null quando a base é zero. */
export function percentual(parte: number, total: number): number | null {
  if (!total) return null;
  return Math.round((parte / total) * 1000) / 10;
}

/** Margem = lucro ÷ entradas, em % com 1 casa; null sem entradas (a tela mostra "—"). */
export function margem(resultadoCentavos: number, entradasCentavos: number): number | null {
  if (entradasCentavos <= 0) return null;
  return percentual(resultadoCentavos, entradasCentavos);
}

/** Variação contra o ano anterior, em % com 1 casa; null quando o ano anterior não tem base (zero ou sem dado). */
export function variacao(atual: number, anterior: number | null | undefined): number | null {
  if (anterior === null || anterior === undefined || anterior === 0) return null;
  return Math.round(((atual - anterior) / Math.abs(anterior)) * 1000) / 10;
}

// --- textos, tipo e forma de pagamento ---------------------------------------------------------------------

/** Minúsculas, sem acento, espaços colapsados: "  Açúcar  Cristal " → "acucar cristal". */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Impressão digital de duplicado: `tipo | data | valorCentavos | descrição normalizada`. Só um AVISO: duas
 * compras iguais no mesmo dia existem (não há UNIQUE no banco).
 */
export function impressaoDigital(l: { tipo: TipoLancamento; data: string; valorCentavos: number; descricao: string }): string {
  return `${l.tipo}|${l.data}|${l.valorCentavos}|${normalizarTexto(l.descricao)}`;
}

/** "Entrada", "E", "Receita", "+" → ENTRADA; "Saída", "S", "Despesa", "Gasto", "-" → SAIDA; senão null. */
export function lerTipo(texto: string): TipoLancamento | null {
  const t = normalizarTexto(texto);
  if (["entrada", "entradas", "e", "receita", "receitas", "credito", "+"].includes(t)) return "ENTRADA";
  if (["saida", "saidas", "s", "despesa", "despesas", "gasto", "gastos", "debito", "-"].includes(t)) return "SAIDA";
  return null;
}

/** "Pix", "Dinheiro", "Espécie", "Débito", "Crédito", "Cartão" (= crédito), "Outro" → a forma; vazio ou desconhecido → null. */
export function lerFormaPagamento(texto: string): FormaPagamento | null {
  const t = normalizarTexto(texto);
  if (!t) return null;
  if (t === "pix") return "PIX";
  if (["dinheiro", "especie", "em especie"].includes(t)) return "DINHEIRO";
  if (/debito/.test(t)) return "CARTAO_DEBITO";
  if (/credito|^cartao$/.test(t)) return "CARTAO_CREDITO";
  if (["outro", "outros", "outra"].includes(t)) return "OUTRO";
  return null;
}

// --- colar do Excel (TSV) ----------------------------------------------------------------------------------

/**
 * Texto copiado do Excel (`text/plain`): células separadas por TAB, linhas por \n ou \r\n. Célula entre aspas
 * pode ter TAB, quebra de linha e `""` (aspas). A última linha vazia que o Excel põe é ignorada.
 */
export function lerTsv(texto: string): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let celula = "";
  let i = 0;
  let inicioDaCelula = true;
  while (i < texto.length) {
    const c = texto[i];
    if (inicioDaCelula && c === '"') {
      // Célula entre aspas: vai até a aspa que fecha (seguida de TAB, quebra ou fim).
      let fim = i + 1;
      let valor = "";
      let fechou = false;
      while (fim < texto.length) {
        if (texto[fim] === '"') {
          if (texto[fim + 1] === '"') {
            valor += '"';
            fim += 2;
            continue;
          }
          fechou = true;
          break;
        }
        valor += texto[fim];
        fim++;
      }
      const depois = texto[fim + 1];
      if (fechou && (depois === undefined || depois === "\t" || depois === "\n" || depois === "\r")) {
        celula = valor;
        i = fim + 1;
        inicioDaCelula = false;
        continue;
      }
      // Aspas que não fecham do jeito do Excel: é texto comum.
    }
    inicioDaCelula = false;
    if (c === "\t") {
      linha.push(celula);
      celula = "";
      inicioDaCelula = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(celula);
      linhas.push(linha);
      linha = [];
      celula = "";
      inicioDaCelula = true;
    } else celula += c;
    i++;
  }
  if (celula !== "" || linha.length > 0) {
    linha.push(celula);
    linhas.push(linha);
  }
  // Linhas totalmente vazias no fim (a quebra final do Excel) saem.
  while (linhas.length && linhas[linhas.length - 1].every((c) => c.trim() === "")) linhas.pop();
  return linhas;
}

export const CAMPOS_PLANILHA = ["data", "tipo", "categoria", "descricao", "valor", "observacao", "forma"] as const;
export type CampoPlanilha = (typeof CAMPOS_PLANILHA)[number];

/** Nomes de cabeçalho reconhecidos (já normalizados), inclusive os da guia "Base" do exemplo da dona. */
const SINONIMOS: Record<CampoPlanilha, string[]> = {
  data: ["data", "dia", "data do lancamento", "data lancamento", "datas"],
  tipo: ["tipo", "entrada/saida", "entrada ou saida", "e/s", "natureza", "movimento"],
  categoria: ["categoria", "categorias", "grupo", "classificacao", "conta"],
  descricao: ["descricao", "descricoes", "historico", "item", "produto", "detalhe", "lancamento"],
  valor: ["valor", "valores", "valor (r$)", "valor r$", "r$", "total", "quantia", "montante"],
  observacao: ["observacao", "observacoes", "obs", "obs.", "nota", "notas", "comentario"],
  forma: ["forma", "forma de pagamento", "pagamento", "meio de pagamento", "forma pagamento"],
};

/** Que campo é este cabeçalho? ("Descrição" → "descricao"); null se não reconhece. */
export function campoDoCabecalho(texto: string): CampoPlanilha | null {
  const t = normalizarTexto(texto).replace(/:$/, "");
  for (const campo of CAMPOS_PLANILHA) if (SINONIMOS[campo].includes(t)) return campo;
  return null;
}

/** A linha parece cabeçalho? (pelo menos 2 nomes conhecidos, um deles Data ou Valor). */
export function pareceCabecalho(linha: string[]): boolean {
  const campos = linha.map(campoDoCabecalho).filter((c): c is CampoPlanilha => c !== null);
  return new Set(campos).size >= 2 && (campos.includes("data") || campos.includes("valor"));
}

/** Cabeçalho → índice da coluna de cada campo reconhecido (a primeira, se repetir). */
export function mapearColunas(cabecalho: string[]): Partial<Record<CampoPlanilha, number>> {
  const mapa: Partial<Record<CampoPlanilha, number>> = {};
  cabecalho.forEach((texto, indice) => {
    const campo = campoDoCabecalho(texto);
    if (campo && mapa[campo] === undefined) mapa[campo] = indice;
  });
  return mapa;
}

/** Sem cabeçalho: as colunas na ordem da grade, a partir da coluna focada (`ordem` = campos da grade). */
export function mapearPorPosicao(ordem: readonly CampoPlanilha[], colunaInicial: number, largura: number): Partial<Record<CampoPlanilha, number>> {
  const mapa: Partial<Record<CampoPlanilha, number>> = {};
  for (let i = 0; i < largura && colunaInicial + i < ordem.length; i++) mapa[ordem[colunaInicial + i]] = i;
  return mapa;
}

export type CategoriaParaCasar = { id: string; tipo: TipoLancamento; nome: string; ativo: boolean };

/** Acha a categoria pelo nome (sem acento nem maiúsculas), do tipo dado; prefere as ativas. */
export function casarCategoria<C extends CategoriaParaCasar>(nome: string, tipo: TipoLancamento, categorias: readonly C[]): C | null {
  const alvo = normalizarTexto(nome);
  if (!alvo) return null;
  const doTipo = categorias.filter((c) => c.tipo === tipo && normalizarTexto(c.nome) === alvo);
  return doTipo.find((c) => c.ativo) ?? doTipo[0] ?? null;
}

export type LinhaInterpretada = {
  tipo: TipoLancamento | null;
  data: string | null;
  categoriaId: string | null;
  /** Nome digitado quando não casou com nenhuma categoria ("criar 'Gás'"). */
  categoriaNova: string | null;
  descricao: string;
  valorCentavos: number | null;
  observacao: string | null;
  formaPagamento: FormaPagamento | null;
  erros: Partial<Record<CampoPlanilha, string>>;
};

/**
 * Uma linha colada ou importada → lançamento candidato com os erros por campo. Sem coluna Tipo, o sinal do
 * valor decide (negativo = saída); com Tipo, o valor vira positivo. Valor zero é erro.
 */
export function interpretarLinha(
  celulas: readonly (string | number | null | undefined)[],
  mapa: Partial<Record<CampoPlanilha, number>>,
  opcoes: { hoje: string; categorias: readonly CategoriaParaCasar[]; tipoPadrao?: TipoLancamento },
): LinhaInterpretada {
  const pegar = (campo: CampoPlanilha) => {
    const i = mapa[campo];
    const v = i === undefined ? undefined : celulas[i];
    return v === null || v === undefined ? "" : v;
  };
  const erros: LinhaInterpretada["erros"] = {};

  const textoTipo = String(pegar("tipo")).trim();
  let tipo: TipoLancamento | null = textoTipo ? lerTipo(textoTipo) : null;
  if (textoTipo && !tipo) erros.tipo = "Use Entrada ou Saída.";

  let valorCentavos: number | null = null;
  const brutoValor = pegar("valor");
  const valor = lerValorPlanilha(typeof brutoValor === "number" ? brutoValor : String(brutoValor));
  if (!valor.ok) erros.valor = valor.erro;
  else if (valor.valor === 0) erros.valor = "O valor não pode ser zero.";
  else {
    if (!tipo && !textoTipo) tipo = valor.valor < 0 ? "SAIDA" : (opcoes.tipoPadrao ?? null);
    valorCentavos = Math.abs(valor.valor);
  }
  if (!tipo && !erros.tipo) erros.tipo = "Informe se é Entrada ou Saída.";

  let data: string | null = null;
  const brutoData = pegar("data");
  if (typeof brutoData === "number") {
    const dia = serieExcelParaDia(brutoData);
    if (!dia) erros.data = "Data inválida.";
    else if (dia > opcoes.hoje) erros.data = "A data não pode ser depois de hoje.";
    else if (dia < PRIMEIRO_DIA) erros.data = "Use uma data de 2020 em diante.";
    else data = dia;
  } else {
    const lida = lerDataPlanilha(String(brutoData), opcoes.hoje);
    if (lida.ok) data = lida.valor;
    else erros.data = lida.erro;
  }

  const descricao = String(pegar("descricao")).replace(/\s+/g, " ").trim();
  if (!descricao) erros.descricao = "Informe a descrição.";
  else if (descricao.length > 120) erros.descricao = "A descrição pode ter até 120 caracteres.";

  let categoriaId: string | null = null;
  let categoriaNova: string | null = null;
  const nomeCategoria = String(pegar("categoria")).replace(/\s+/g, " ").trim();
  if (!nomeCategoria) erros.categoria = "Informe a categoria.";
  else if (tipo) {
    const achada = casarCategoria(nomeCategoria, tipo, opcoes.categorias);
    if (achada) categoriaId = achada.id;
    else categoriaNova = nomeCategoria.slice(0, 40);
  }

  const observacao = String(pegar("observacao")).trim() || null;
  if (observacao && observacao.length > 300) erros.observacao = "A observação pode ter até 300 caracteres.";
  const textoForma = String(pegar("forma")).trim();
  const formaPagamento = textoForma ? lerFormaPagamento(textoForma) : null;
  if (textoForma && !formaPagamento) erros.forma = "Forma de pagamento desconhecida.";

  return { tipo, data, categoriaId, categoriaNova, descricao, valorCentavos, observacao, formaPagamento, erros };
}

// --- agregações de tela ------------------------------------------------------------------------------------

export type Fatia = { chave: string; nome: string; valor: number };

/**
 * As `n` maiores fatias e o resto somado em "Outros" (só se sobrar mais de uma; uma só aparece com o próprio
 * nome). Valores <= 0 ficam de fora. Ordem: maior primeiro; empate pelo nome.
 */
export function topNComOutros(itens: readonly Fatia[], n = 6): (Fatia & { percentual: number | null })[] {
  const positivos = itens.filter((i) => i.valor > 0).sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome, "pt-BR"));
  const total = positivos.reduce((s, i) => s + i.valor, 0);
  let fatias: Fatia[] = positivos;
  if (positivos.length > n + 1) {
    const resto = positivos.slice(n);
    fatias = [...positivos.slice(0, n), { chave: "outros", nome: "Outros", valor: resto.reduce((s, i) => s + i.valor, 0) }];
  }
  return fatias.map((f) => ({ ...f, percentual: percentual(f.valor, total) }));
}

export type MovimentoDoDia = { data: string; tipo: TipoLancamento; valorCentavos: number };

export type LinhaDiaria = {
  data: string;
  diaDaSemana: string;
  entradasCentavos: number;
  saidasCentavos: number;
  saldoDoDiaCentavos: number;
  acumuladoCentavos: number;
};

/**
 * Resultado diário de `de` a `ate` (todo dia aparece, mesmo sem movimento), com o saldo acumulado partindo de
 * `saldoAntes`. A devolução de mimos chega como ENTRADA negativa e reduz as entradas do dia.
 */
export function resultadoDiario(movimentos: readonly MovimentoDoDia[], de: string, ate: string, saldoAntes = 0): LinhaDiaria[] {
  const porDia = new Map<string, { e: number; s: number }>();
  for (const m of movimentos) {
    if (m.data < de || m.data > ate) continue;
    const dia = porDia.get(m.data) ?? { e: 0, s: 0 };
    if (m.tipo === "ENTRADA") dia.e += m.valorCentavos;
    else dia.s += m.valorCentavos;
    porDia.set(m.data, dia);
  }
  const linhas: LinhaDiaria[] = [];
  let acumulado = saldoAntes;
  for (let dia = de; dia <= ate; dia = somarDias(dia, 1)) {
    const v = porDia.get(dia) ?? { e: 0, s: 0 };
    acumulado += v.e - v.s;
    linhas.push({
      data: dia,
      diaDaSemana: nomeDiaDaSemana(dia),
      entradasCentavos: v.e,
      saidasCentavos: v.s,
      saldoDoDiaCentavos: v.e - v.s,
      acumuladoCentavos: acumulado,
    });
  }
  return linhas;
}

/** Linhas automáticas agrupadas por dia e origem ("Vendas no site · 07/11 · 3 pedidos · R$ 95,00"). */
export function agruparPorDiaEOrigem<O extends string>(linhas: readonly { data: string; origem: O; valorCentavos: number }[]) {
  const grupos = new Map<string, { data: string; origem: O; quantidade: number; valorCentavos: number }>();
  for (const l of linhas) {
    const chave = `${l.data}|${l.origem}`;
    const g = grupos.get(chave) ?? { data: l.data, origem: l.origem, quantidade: 0, valorCentavos: 0 };
    g.quantidade++;
    g.valorCentavos += l.valorCentavos;
    grupos.set(chave, g);
  }
  return [...grupos.values()].sort((a, b) => (a.data === b.data ? a.origem.localeCompare(b.origem) : a.data < b.data ? 1 : -1));
}
