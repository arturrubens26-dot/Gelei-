/** Baixa um texto CSV como arquivo (abre no Excel). Só no navegador, em resposta a um clique. */
export function baixarCsv(nomeDoArquivo: string, conteudo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeDoArquivo;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
