/**
 * Menu do painel fixado ou recolhido: a escolha da dona fica no navegador (localStorage) e vale na
 * próxima visita. Sem escolha ainda, o padrão é fixado em telas de 1280 px ou mais (o menu completo,
 * com os títulos dos grupos, à vista) e recolhido em trilho de ícones abaixo disso (a tabela do
 * Financeiro e a de Pedidos precisam do espaço).
 *
 * O servidor não sabe a escolha. Para a barra não "pular" na hidratação, este script roda no <head>,
 * antes da primeira pintura, e põe `data-painel-fixado="true|false"` no <html>; o CSS (variante
 * `fixado:` em globals.css) lê esse atributo. O React só confere o mesmo valor depois.
 */
export const CHAVE_MENU_FIXADO = "painel-menu-fixado";
export const LARGURA_MENU_FIXADO_PADRAO = 1280;

export const SCRIPT_MENU_FIXADO =
  `(function(){try{var v=null;try{v=localStorage.getItem("${CHAVE_MENU_FIXADO}")}catch(e){}` +
  `var f=v==="1"||(v!=="0"&&matchMedia("(min-width:${LARGURA_MENU_FIXADO_PADRAO}px)").matches);` +
  `document.documentElement.dataset.painelFixado=f?"true":"false"}catch(e){}})();`;
