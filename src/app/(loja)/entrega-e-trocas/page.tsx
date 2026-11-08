import type { Metadata } from "next";
import Link from "next/link";
import { PaginaDePolitica } from "@/components/PaginaDePolitica";
import { formatarBRL } from "@/lib/dinheiro";
import { obterTaxaDeEntregaCentavos } from "@/lib/entrega";
import { enderecoDeRetirada } from "@/lib/entrega-regras";

export const metadata: Metadata = {
  title: "Entrega, trocas e devoluções",
  description: "Onde a Geleiô entrega, a retirada na loja, o pagamento, o direito de desistir em 7 dias e o que fazer se o pote chegar com problema.",
};

// Rascunho para a dona revisar: área e taxa de entrega, retirada, pagamento, arrependimento (CDC art. 49),
// produto com problema (CDC art. 26) e cancelamento.
export default async function PaginaEntregaETrocas() {
  // A taxa em vigor (painel), em cache com a tag config-loja: a página é estática e se atualiza quando a taxa muda.
  const centavos = await obterTaxaDeEntregaCentavos();
  const taxa = formatarBRL(centavos / 100);

  return (
    <PaginaDePolitica titulo="Entrega, trocas e devoluções" atualizadaEm="29 de outubro de 2026">
      <p>
        Entregamos em Teresina {centavos > 0 ? <>por <strong>{taxa}</strong></> : <strong>sem custo</strong>} ou você retira na loja, também sem custo. Pode desistir da compra em até 7 dias
        depois de receber.
      </p>

      <h2>Onde entregamos</h2>
      <p>
        <strong>Entregamos apenas em Teresina-PI</strong> (CEPs de 64000-000 a 64099-999), {centavos > 0 ? `com taxa fixa de ${taxa}` : "sem taxa de entrega"}. O valor aparece no
        resumo do pedido antes de você pagar. Para quem está fora de Teresina, a opção é a retirada na loja. Isso vale também para as encomendas de mimos.
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

      <h2>Mimos (encomendas para festas)</h2>
      <p>
        Os Mimos são encomendas de potinhos de 40 ml feitas pelo site. Como toda compra pela internet, valem as mesmas regras de
        desistência: você pode desistir <strong>a qualquer momento antes de receber e até 7 dias depois de receber</strong> (art. 49
        do Código de Defesa do Consumidor), em <Link href="/minhas-encomendas">Minhas encomendas</Link>.
      </p>
      <ul>
        <li>
          Devolvemos <strong>100% de tudo o que você pagou</strong> (entrada, restante e frete), de imediato, pelo mesmo meio de
          pagamento, sem taxa e sem desconto.
        </li>
        <li>Antes de a Geleiô aprovar e de você pagar a entrada, nada é cobrado. Se não pudermos fazer a encomenda, devolvemos tudo.</li>
        <li>
          Depois de receber, os potinhos devem estar lacrados e sem uso. A devolução deles a gente combina com você, e o custo do
          retorno é nosso.
        </li>
      </ul>

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
