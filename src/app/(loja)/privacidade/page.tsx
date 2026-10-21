import type { Metadata } from "next";
import Link from "next/link";
import { PaginaDePolitica } from "@/components/PaginaDePolitica";
import { dadosLoja } from "@/lib/dados-loja";

export const metadata: Metadata = {
  title: "Privacidade",
  description: "Quais dados a Geleiô pede, para que servem, com quem são compartilhados e como pedir acesso ou exclusão.",
};

// Rascunho para a dona revisar (LGPD, Lei 13.709/2018): quem cuida dos dados, o que é coletado e para
// quê, com quem é compartilhado (a InfinitePay, no pagamento), por quanto tempo e os direitos do titular.
export default function PaginaPrivacidade() {
  return (
    <PaginaDePolitica titulo="Privacidade e seus dados" atualizadaEm="21 de outubro de 2026">
      <p>
        Pedimos só o necessário para vender, entregar e cuidar do seu pedido. Não vendemos seus dados e não usamos ferramentas de
        anúncio nem de rastreamento.
      </p>

      <h2>Quem cuida dos seus dados</h2>
      <p>
        A Geleiô, loja de geleias artesanais em {dadosLoja.endereco.cidade}-{dadosLoja.endereco.uf}. O contato é pelo Instagram{" "}
        <a href={dadosLoja.instagram.url} target="_blank" rel="noopener noreferrer">
          @{dadosLoja.instagram.usuario}
          <span className="sr-only"> (abre em nova aba)</span>
        </a>
        .
      </p>

      <h2>O que pedimos e para quê</h2>
      <ul>
        <li>
          <strong>Nome, e-mail e senha:</strong> para criar sua conta e você acompanhar seus pedidos. A senha fica guardada
          embaralhada (criptografada): nem a gente consegue ler.
        </li>
        <li>
          <strong>WhatsApp:</strong> para combinar a entrega ou a retirada e avisar sobre o pedido.
        </li>
        <li>
          <strong>Endereço:</strong> só quando você escolhe a entrega, para levar o pedido até você.
        </li>
        <li>
          <strong>O que você comprou e quando:</strong> para preparar o pedido, cuidar de trocas e devoluções e manter as contas da
          loja em dia.
        </li>
      </ul>

      <h2>Com quem compartilhamos</h2>
      <ul>
        <li>
          <strong>InfinitePay</strong>, que processa o pagamento: recebe seu nome, e-mail, WhatsApp, o endereço de entrega e os
          itens do pedido. Os dados do cartão você digita direto na página da InfinitePay; eles não passam pela Geleiô.
        </li>
        <li>
          <strong>Os serviços que mantêm o site no ar</strong> (a hospedagem Netlify e o banco de dados Neon), que guardam os dados
          por nós e não podem usá-los para outro fim.
        </li>
        <li>
          <strong>Serviços públicos de consulta de CEP</strong> (como ViaCEP e BrasilAPI), que recebem só o CEP digitado, para
          preencher o endereço.
        </li>
        <li>
          <strong>Google Fonts</strong>, de onde vêm as letras do site: recebe o endereço de internet (IP) do seu aparelho ao
          carregar a página.
        </li>
      </ul>

      <h2>Cookies e o que fica no seu navegador</h2>
      <p>
        Usamos um único cookie, necessário para você continuar na sua conta de uma página para outra. O carrinho fica guardado no seu próprio navegador
        até você finalizar o pedido; ele não vai para o nosso servidor antes disso.
      </p>

      <h2>Por quanto tempo guardamos</h2>
      <p>
        Os dados da conta ficam enquanto ela existir. Os pedidos ficam pelo tempo que a lei exige para os registros de venda e para
        garantir os seus direitos de consumidor.
      </p>

      <h2>Seus direitos</h2>
      <p>Pela Lei Geral de Proteção de Dados (art. 18), você pode pedir, a qualquer momento:</p>
      <ul>
        <li>para saber se temos dados seus e ver quais são;</li>
        <li>para corrigir o que estiver errado ou desatualizado;</li>
        <li>para apagar sua conta e os dados que a lei não nos obriga a guardar;</li>
        <li>para saber com quem compartilhamos seus dados;</li>
        <li>para receber uma cópia dos seus dados e levá-la a outro serviço.</li>
      </ul>
      <p>
        É só chamar no Instagram. Respondemos em até 15 dias. Se esqueceu a senha, veja{" "}
        <Link href="/esqueci-senha">como criar uma senha nova</Link>.
      </p>

      <h2>Mudanças nesta página</h2>
      <p>Se algo importante mudar, atualizamos esta página e a data lá em cima.</p>
    </PaginaDePolitica>
  );
}
