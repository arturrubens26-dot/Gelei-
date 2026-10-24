/**
 * Os itens do menu do painel, agrupados por função. Cada item é uma página ou uma parte de uma página
 * (`?secao=` rola até ela; `?aba=` escolhe a aba): quem está em Encomendas não fica procurando onde
 * abrir ou fechar as lembrancinhas, nem em Produtos onde está a taxa de entrega.
 */

export type NomeDoIcone =
  | "dashboard"
  | "pedidos"
  | "balcao"
  | "encomendas"
  | "clientes"
  | "produtos"
  | "kits"
  | "producoes"
  | "estoque"
  | "financeiro"
  | "despesas"
  | "entrega"
  | "ajustes";

export type ItemDoMenu = { rotulo: string; href: string; icone: NomeDoIcone };
export type GrupoDoMenu = { titulo: string; itens: readonly ItemDoMenu[] };

export const GRUPOS_DO_MENU: readonly GrupoDoMenu[] = [
  { titulo: "Visão geral", itens: [{ rotulo: "Dashboard", href: "/admin/dashboard", icone: "dashboard" }] },
  {
    titulo: "Vendas",
    itens: [
      { rotulo: "Pedidos", href: "/admin/orders", icone: "pedidos" },
      { rotulo: "Venda presencial", href: "/admin/orders/nova", icone: "balcao" },
      { rotulo: "Encomendas", href: "/admin/encomendas", icone: "encomendas" },
      { rotulo: "Clientes", href: "/admin/clientes", icone: "clientes" },
    ],
  },
  {
    titulo: "Catálogo",
    itens: [
      { rotulo: "Produtos", href: "/admin/products", icone: "produtos" },
      { rotulo: "Kits", href: "/admin/products?secao=kits", icone: "kits" },
    ],
  },
  {
    titulo: "Produção",
    itens: [
      { rotulo: "Produções", href: "/admin/production", icone: "producoes" },
      { rotulo: "Estoque de insumos", href: "/admin/production?aba=estoque", icone: "estoque" },
    ],
  },
  {
    titulo: "Financeiro",
    itens: [
      { rotulo: "Financeiro", href: "/admin/financial", icone: "financeiro" },
      { rotulo: "Despesas", href: "/admin/expenses", icone: "despesas" },
    ],
  },
  {
    titulo: "Ajustes da loja",
    itens: [
      { rotulo: "Taxa de entrega", href: "/admin/products?secao=entrega", icone: "entrega" },
      { rotulo: "Lembrancinhas", href: "/admin/encomendas?secao=configuracao", icone: "ajustes" },
    ],
  },
];

export type ItemAtivo = { item: ItemDoMenu; grupo: GrupoDoMenu };
type Parametros = { get(nome: string): string | null };

function separar(href: string): { caminho: string; consulta: [string, string][] } {
  const [caminho, resto = ""] = href.split("?");
  return { caminho, consulta: [...new URLSearchParams(resto).entries()] };
}

/**
 * Qual item está marcado. Vence o que casa com o caminho mais longo (`/admin/orders/nova` é "Venda
 * presencial", não "Pedidos"); no mesmo caminho, vence o que tem mais parâmetros iguais aos da
 * página (`?secao=kits` é "Kits"), e o item sem parâmetros é o padrão. Sem caminho, nenhum.
 */
export function itemAtivo(caminho: string | null | undefined, parametros: Parametros): ItemAtivo | null {
  if (!caminho) return null;
  let melhor: (ItemAtivo & { tamanho: number; pontos: number }) | null = null;
  for (const grupo of GRUPOS_DO_MENU) {
    for (const item of grupo.itens) {
      const alvo = separar(item.href);
      if (caminho !== alvo.caminho && !caminho.startsWith(`${alvo.caminho}/`)) continue;
      if (!alvo.consulta.every(([nome, valor]) => parametros.get(nome) === valor)) continue;
      const tamanho = alvo.caminho.length;
      const pontos = alvo.consulta.length;
      if (!melhor || tamanho > melhor.tamanho || (tamanho === melhor.tamanho && pontos > melhor.pontos)) {
        melhor = { item, grupo, tamanho, pontos };
      }
    }
  }
  return melhor ? { item: melhor.item, grupo: melhor.grupo } : null;
}
