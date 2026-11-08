/**
 * Teclado da grade (padrão ARIA "grid" com foco itinerante), sem React: recebe a tecla, a posição e
 * se a célula está sendo editada, e diz o que fazer. Testado em testes/planilha-grade.test.ts.
 *
 * Como no Excel: setas andam; Enter edita e, editando, confirma e desce; Tab confirma e vai para a
 * direita; Esc desiste; F2 edita sem apagar; digitar uma letra começa a editar trocando o conteúdo;
 * Delete limpa; Ctrl+Z e Ctrl+Y desfazem e refazem. Fora da edição, Tab na última coluna (ou
 * Shift+Tab na primeira) deixa o navegador agir: é assim que o foco sai da planilha.
 */

export type Posicao = { linha: number; coluna: number };
export type Tamanho = { linhas: number; colunas: number };
export type Direcao = "baixo" | "cima" | "direita" | "esquerda";

export type AcaoTeclado =
  | { tipo: "mover"; para: Posicao }
  | { tipo: "editar"; modo: "manter" | "substituir"; texto: string }
  | { tipo: "confirmar"; depois: Direcao }
  | { tipo: "cancelar" }
  | { tipo: "limpar" }
  | { tipo: "desfazer" }
  | { tipo: "refazer" }
  | { tipo: "excluirLinha" }
  /** Tecla que a grade não trata: o navegador (ou o editor da célula) segue o padrão. */
  | { tipo: "nada" };

export type Tecla = { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };

const PAGINA = 10;

const limitar = (n: number, max: number) => Math.min(Math.max(n, 0), Math.max(max, 0));

/** Uma posição andando `delta` linhas e `dc` colunas, sem sair da grade. */
export function andar(pos: Posicao, tamanho: Tamanho, dl: number, dc: number): Posicao {
  return { linha: limitar(pos.linha + dl, tamanho.linhas - 1), coluna: limitar(pos.coluna + dc, tamanho.colunas - 1) };
}

/** Próxima célula na ordem de leitura (Tab). null = passou do fim (ou do começo, para trás). */
export function proximaNaLeitura(pos: Posicao, tamanho: Tamanho, paraTras: boolean): Posicao | null {
  const indice = pos.linha * tamanho.colunas + pos.coluna + (paraTras ? -1 : 1);
  if (indice < 0 || indice >= tamanho.linhas * tamanho.colunas) return null;
  return { linha: Math.floor(indice / tamanho.colunas), coluna: indice % tamanho.colunas };
}

/** Caractere que começa uma edição: uma letra, número, sinal ou espaço (AltGr conta: Ctrl+Alt no Windows). */
export function ehCaractereDigitavel(t: Tecla): boolean {
  if ([...t.key].length !== 1) return false;
  const altGr = !!t.ctrlKey && !!t.altKey;
  return altGr || (!t.ctrlKey && !t.metaKey && !t.altKey);
}

export function acaoDaTecla(t: Tecla, editando: boolean, pos: Posicao, tamanho: Tamanho): AcaoTeclado {
  const ctrl = !!t.ctrlKey || !!t.metaKey;

  if (editando) {
    switch (t.key) {
      case "Enter":
        return { tipo: "confirmar", depois: t.shiftKey ? "cima" : "baixo" };
      case "Tab":
        return { tipo: "confirmar", depois: t.shiftKey ? "esquerda" : "direita" };
      case "Escape":
        return { tipo: "cancelar" };
      default:
        // Setas, Home, End, Backspace, Ctrl+Z… ficam com o campo (mexer no texto digitado).
        return { tipo: "nada" };
    }
  }

  if (ctrl && !t.altKey) {
    const k = t.key.toLowerCase();
    if (k === "z") return t.shiftKey ? { tipo: "refazer" } : { tipo: "desfazer" };
    if (k === "y") return { tipo: "refazer" };
    if (t.key === "Delete" || t.key === "-") return { tipo: "excluirLinha" };
    if (t.key === "Home") return { tipo: "mover", para: { linha: 0, coluna: 0 } };
    if (t.key === "End") return { tipo: "mover", para: { linha: tamanho.linhas - 1, coluna: tamanho.colunas - 1 } };
    if (t.key === "ArrowUp") return { tipo: "mover", para: { linha: 0, coluna: pos.coluna } };
    if (t.key === "ArrowDown") return { tipo: "mover", para: { linha: tamanho.linhas - 1, coluna: pos.coluna } };
    if (t.key === "ArrowLeft") return { tipo: "mover", para: { linha: pos.linha, coluna: 0 } };
    if (t.key === "ArrowRight") return { tipo: "mover", para: { linha: pos.linha, coluna: tamanho.colunas - 1 } };
    // Ctrl+C, Ctrl+V, Ctrl+A…: o navegador dispara copy/paste, que a grade escuta à parte.
    return { tipo: "nada" };
  }

  switch (t.key) {
    case "ArrowUp":
      return { tipo: "mover", para: andar(pos, tamanho, -1, 0) };
    case "ArrowDown":
      return { tipo: "mover", para: andar(pos, tamanho, 1, 0) };
    case "ArrowLeft":
      return { tipo: "mover", para: andar(pos, tamanho, 0, -1) };
    case "ArrowRight":
      return { tipo: "mover", para: andar(pos, tamanho, 0, 1) };
    case "PageUp":
      return { tipo: "mover", para: andar(pos, tamanho, -PAGINA, 0) };
    case "PageDown":
      return { tipo: "mover", para: andar(pos, tamanho, PAGINA, 0) };
    case "Home":
      return { tipo: "mover", para: { linha: pos.linha, coluna: 0 } };
    case "End":
      return { tipo: "mover", para: { linha: pos.linha, coluna: tamanho.colunas - 1 } };
    case "Tab": {
      // Anda na linha; na última coluna (ou na primeira, com Shift) o foco sai da planilha, para
      // quem usa só o teclado não ter de atravessar centenas de células até os botões de baixo.
      const coluna = pos.coluna + (t.shiftKey ? -1 : 1);
      return coluna < 0 || coluna >= tamanho.colunas ? { tipo: "nada" } : { tipo: "mover", para: { linha: pos.linha, coluna } };
    }
    case "Enter":
      return t.shiftKey ? { tipo: "mover", para: andar(pos, tamanho, -1, 0) } : { tipo: "editar", modo: "manter", texto: "" };
    case "F2":
      return { tipo: "editar", modo: "manter", texto: "" };
    case "Delete":
    case "Backspace":
      return { tipo: "limpar" };
    default:
      return ehCaractereDigitavel(t) ? { tipo: "editar", modo: "substituir", texto: t.key } : { tipo: "nada" };
  }
}

/** Para onde vai o foco depois de confirmar uma edição (Enter desce, Tab vai à direita e passa de linha). */
export function destinoDepoisDeConfirmar(pos: Posicao, tamanho: Tamanho, depois: Direcao): Posicao {
  switch (depois) {
    case "baixo":
      return andar(pos, tamanho, 1, 0);
    case "cima":
      return andar(pos, tamanho, -1, 0);
    case "direita":
      return proximaNaLeitura(pos, tamanho, false) ?? pos;
    case "esquerda":
      return proximaNaLeitura(pos, tamanho, true) ?? pos;
  }
}
