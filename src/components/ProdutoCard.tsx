import { BotaoAdicionar } from "@/components/carrinho/BotaoAdicionar";
import { FotoComVerso } from "@/components/FotoComVerso";
import { FotoDoPote } from "@/components/FotoDoPote";
import { formatarBRL } from "@/lib/dinheiro";
import type { ProdutoDTO } from "@/lib/produtos";
import { separarNome } from "@/lib/produtos-regras";

/**
 * Cartão de produto no formato do rótulo Geleiô: papel claro com duplo filete dourado,
 * texto centralizado, o sabor em Playfair e o peso logo abaixo, como no pote.
 * `prioritario`: a primeira fileira visível carrega a imagem com prioridade (melhora o LCP).
 */
export function ProdutoCard({ produto, prioritario = false }: { produto: ProdutoDTO; prioritario?: boolean }) {
  const { sabor, peso } = separarNome(produto.nome);
  const foto = (
    <FotoDoPote
      src={produto.imagemUrl}
      alt={`Pote de geleia ${produto.nome}`}
      lado={480}
      // Grade de 1, 2 e 3 colunas (até 1152px de largura): o navegador baixa só o tamanho necessário.
      sizes="(min-width: 1024px) 368px, (min-width: 640px) 50vw, 100vw"
      prioritario={prioritario}
      className="aspect-square w-full object-cover"
    />
  );

  return (
    <article className="cartao flex flex-col p-2.5">
      {/* A foto sempre vira e o verso traz a descrição, as harmonizações e os destaques (só ela: o preço e o botão ficam no lugar). */}
      <FotoComVerso sabor={sabor} descricao={produto.descricao} harmonizacoes={produto.harmonizacoes} destaques={produto.destaques}>
        {foto}
      </FotoComVerso>
      <div className="flex flex-1 flex-col items-center px-4 pb-4 pt-5 text-center">
        <h3 className="font-titulos text-xl font-semibold leading-snug text-primaria">{sabor}</h3>
        {peso && <p className="mt-1 text-sm text-primaria/80">{peso}</p>}
        <p className="mt-4 flex-1 text-2xl font-semibold text-primaria">{formatarBRL(produto.preco)}</p>
        <div className="mt-4 w-full">
          <BotaoAdicionar produto={produto} />
        </div>
      </div>
    </article>
  );
}
