import type { Metadata } from "next";
import Link from "next/link";
import { PaginaDePolitica } from "@/components/PaginaDePolitica";
import { formatarBRL } from "@/lib/dinheiro";
import { enderecoDeRetirada, TAXA_ENTREGA_PADRAO_CENTAVOS } from "@/lib/entrega-regras";

export const metadata: Metadata = {
  title: "Entrega, trocas e devoluções",
  description: "Onde a Geleiô entrega, a retirada na loja, o pagamento, o direito de desistir em 7 dias e o que fazer se o pote chegar com problema.",
};

// Rascunho para a dona revisar: área e taxa de entrega, retirada, pagamento, arrependimento (CDC art. 49),
// produto com problema (CDC art. 26) e cancelamento.
export default function PaginaEntregaETrocas() {
  const taxa = formatarBRL(TAXA_ENTREGA_PADRAO_CENTAVOS / 100);

  return (
    <PaginaDePolitica titulo="Entrega, trocas e devoluções" atualizadaEm="21 de outubro de 2026">
      <p>
        Entregamos em Teresina por <strong>{taxa}</strong> ou você retira na loja, sem custo. Pode desistir da compra em até 7 dias
        depois de receber.
      </p>

      <h2>Onde entregamos</h2>
      <p>
        Por enquanto, só em <strong>Teresina</strong> (CEPs de 64000-000 a 64099-999), com taxa fixa de {taxa}. O valor aparece no
        resumo do pedido antes de você pagar. Fora de Teresina ainda não entregamos, mas você pode escolher a retirada na loja.
      </p>

      <h2>Retirada na loja</h2>
      <p>
        Grátis. O endereço é <strong>{enderecoDeRetirada()}</strong>.
      </p>

      <h2>Quando chega</h2>
      <p>
        Depois que o pagamento é confirmado, chamamos você no WhatsApp informado no pedido para combinar o dia e o horário da entrega
        ou da retirada.
      </p>

      <h2>Pagamento</h2>
      <p>
        Você paga com PIX ou cartão de crédito (até 12x) na página segura da InfinitePay. No parcelado, os juros são cobrados pela
        operadora e aparecem antes de você confirmar. Um pedido pode ser pago em até 48 horas; depois disso, é só fazer um novo
        pedido. Você acompanha tudo em <Link href="/meus-pedidos">Meus pedidos</Link>.
      </p>

      <h2>Desistir da compra</h2>
      <p>
        Comprou pelo site e mudou de ideia? Você pode desistir em até <strong>7 dias</strong> depois de receber o pedido (art. 49 do
        Código de Defesa do Consumidor). Avise a gente: devolvemos todo o valor pago, inclusive a taxa de entrega, pelo mesmo meio de
        pagamento. No cartão, o estorno aparece na fatura no prazo do seu banco.
      </p>

      <h2>Pote com problema</h2>
      <p>
        Pote quebrado, tampa amassada, lacre aberto ou qualquer problema com a geleia? Avise em até <strong>30 dias</strong> (art. 26
        do Código de Defesa do Consumidor), de preferência com uma foto. Trocamos o pote ou devolvemos o valor, como você preferir.
      </p>

      <h2>Cancelar um pedido</h2>
      <ul>
        <li>
          <strong>Antes de pagar:</strong> é só não pagar. O pedido deixa de valer depois de 48 horas, sem nenhuma cobrança.
        </li>
        <li>
          <strong>Já pago, antes da entrega:</strong> fale com a gente e devolvemos o valor total.
        </li>
      </ul>
    </PaginaDePolitica>
  );
}
