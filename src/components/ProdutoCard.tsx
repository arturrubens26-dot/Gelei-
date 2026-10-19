import Image from "next/image";
import { BotaoAdicionar } from "@/components/carrinho/BotaoAdicionar";
import { formatarBRL } from "@/lib/dinheiro";
import type { ProdutoDTO } from "@/lib/produtos";

/** "Morango com Pedaços, 250g" → sabor "Morango com Pedaços" e peso "250g" (como no rótulo). */
function separarNome(nome: string): { sabor: string; peso: string | null } {
  const i = nome.lastIndexOf(",");
  return i > 0 ? { sabor: nome.slice(0, i).trim(), peso: nome.slice(i + 1).trim() } : { sabor: nome, peso: null };
}

/**
 * Cartão de produto no formato do rótulo Geleiô: papel claro com duplo filete dourado,
 * texto centralizado, o sabor em Playfair e o peso logo abaixo, como no pote.
 * `prioritario`: a primeira fileira visível carrega a imagem com prioridade (melhora o LCP).
 */
export function ProdutoCard({ produto, prioritario = false }: { produto: ProdutoDTO; prioritario?: boolean }) {
  const { sabor, peso } = separarNome(produto.nome);

  return (
    <article className="cartao flex flex-col p-2.5">
      <div className="overflow-hidden rounded-sm bg-[#f3ece3]">
        <Image
          src={produto.imagemUrl}
          alt={`Pote de geleia ${produto.nome}`}
          width={480}
          height={480}
          // Grade de 1, 2 e 3 colunas (até 1152px de largura): o navegador baixa só o tamanho necessário.
          sizes="(min-width: 1024px) 368px, (min-width: 640px) 50vw, 100vw"
          priority={prioritario}
          className="aspect-square w-full object-cover"
        />
      </div>
      <div className="flex flex-1 flex-col items-center px-4 pb-4 pt-5 text-center">
        <h3 className="font-titulos text-xl font-semibold leading-snug text-primaria">{sabor}</h3>
        {peso && <p className="mt-1 text-sm text-primaria/80">{peso}</p>}
        <p className="mt-3 max-w-[32ch] flex-1 text-sm leading-relaxed text-primaria/85">{produto.descricao}</p>
        <p className="mt-4 text-2xl font-semibold text-primaria">{formatarBRL(produto.preco)}</p>
        <div className="mt-4 w-full">
          <BotaoAdicionar produto={produto} />
        </div>
      </div>
    </article>
  );
}
