"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { MiniaturaKit } from "@/components/kits/MiniaturaKit";
import { calcularEntrega, mascararCep, type ResultadoEntrega } from "@/lib/carrinho/entrega";
import { acoesCarrinho, totaisDoCarrinho, useCarrinho, useHidratado, type KitCarrinho } from "@/lib/carrinho/store";
import { formatarBRL } from "@/lib/dinheiro";
import type { EnderecoSalvo } from "@/lib/enderecos";
import {
  CIDADE_ATENDIDA,
  MENSAGEM_FORA_DA_AREA,
  MENSAGEM_TELEFONE_INVALIDO,
  cepAtendido,
  enderecoDeRetirada,
  formatarTelefone,
  mascararTelefone,
  normalizarTelefone,
  telefoneValido,
  type ModoEntrega,
} from "@/lib/entrega-regras";
import { conferirComposicao, emCentavos, textoDaComposicao } from "@/lib/kits-regras";

/** "Kit Presente (Pimenta ×2 · Morango)": como a caixa aparece nas mensagens. */
const nomeDaCaixa = (k: Pick<KitCarrinho, "nome" | "sabores">) => `${k.nome} (${textoDaComposicao(k.sabores)})`;

const NOVO = "novo";

type CamposEndereco = {
  cep: string;
  rua: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
};

/** Chave única por tentativa de compra (Idempotency-Key). `randomUUID` só existe em contexto seguro (HTTPS/localhost). */
function novaChave(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  );
}

/**
 * Só seguimos para um link de pagamento em https na InfinitePay. O servidor já confere o host; aqui é
 * a segunda trava. No desenvolvimento local, aceita também o servidor falso em 127.0.0.1/localhost.
 */
function urlDePagamentoSegura(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    if (u.protocol === "https:" && (u.hostname === "infinitepay.io" || u.hostname.endsWith(".infinitepay.io"))) return true;
    const local = (h: string) => h === "localhost" || h === "127.0.0.1";
    return local(window.location.hostname) && local(u.hostname) && u.protocol === "http:";
  } catch {
    return false;
  }
}

function Secao({ numero, titulo, children }: { numero: number; titulo: string; children: ReactNode }) {
  const id = `secao-${numero}`;
  return (
    <section aria-labelledby={id} className="cartao p-5 shadow-sm sm:p-6">
      <h2 id={id} className="mb-4 flex items-center gap-3 text-2xl font-bold">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secundaria font-textos text-base font-bold text-destaque" aria-hidden="true">
          {numero}
        </span>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

/**
 * Checkout: entregar em Teresina (taxa fixa do painel) ou retirar na loja (grátis), o WhatsApp da
 * cliente (obrigatório, para combinar a entrega), o resumo e o pagamento. Com o pedido criado, segue
 * para a página da InfinitePay; a confirmação do pedido fica no histórico no lugar do checkout, então
 * o "voltar" do navegador, vindo do pagamento, cai no pedido (e não num checkout vazio).
 */
export function CheckoutClient({
  nomeUsuario,
  enderecos,
  telefoneInicial,
  taxaEntregaCentavos,
}: {
  nomeUsuario: string;
  enderecos: EnderecoSalvo[];
  /** Último WhatsApp informado (só dígitos), para não pedir de novo. */
  telefoneInicial: string | null;
  /** Taxa de entrega em Teresina em vigor (painel). O servidor recalcula ao criar o pedido. */
  taxaEntregaCentavos: number;
}) {
  const router = useRouter();
  const uid = useId();
  const hidratado = useHidratado();
  const carrinho = useCarrinho();
  const totais = totaisDoCarrinho(carrinho);

  const [modo, setModo] = useState<ModoEntrega>("ENTREGA");
  // Começa no primeiro endereço salvo que fica em Teresina (os de fora não servem para a entrega).
  const [selecionado, setSelecionado] = useState<string>(enderecos.find((e) => cepAtendido(e.cep))?.id ?? NOVO);
  // Só guardamos o que a pessoa digitou. O resto vem do carrinho (CEP) ou da
  // consulta do CEP — assim o pré-preenchimento funciona mesmo na hidratação.
  const [editado, setEditado] = useState<Partial<CamposEndereco>>({});
  const [consulta, setConsulta] = useState<{ chave: string; resultado: ResultadoEntrega } | null>(null);
  const [telefone, setTelefone] = useState(() => (telefoneInicial ? formatarTelefone(telefoneInicial) : ""));
  const [telefoneTocado, setTelefoneTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // Vale só enquanto a navegação para a confirmação acontece (não fica "preso" se a rota
  // for preservada escondida pelo Next e a pessoa voltar ao checkout depois).
  const [navegando, iniciarNavegacao] = useTransition();
  const [indoPagar, setIndoPagar] = useState(false);
  const [ultimoPedidoId, setUltimoPedidoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Uma caixa saiu do carrinho (kit ou sabor fora da loja, kit que mudou de tamanho): oferece montar outra.
  const [ofertaMontarKit, setOfertaMontarKit] = useState(false);
  // O servidor recusou a entrega fora de Teresina: o aviso oferece trocar para a retirada.
  const [ofertaRetirada, setOfertaRetirada] = useState(false);
  const [errosCampo, setErrosCampo] = useState<Record<string, string[]>>({});
  const alertaRef = useRef<HTMLParagraphElement>(null);

  // Idempotency-Key atrelada ao CONTEÚDO da compra (itens, entrega, telefone e total): reenviar a mesma
  // compra depois de uma falha de rede não duplica o pedido, e qualquer mudança gera chave nova.
  // Depois de um pedido criado a chave é descartada: uma compra nova nunca reaproveita a antiga.
  const tentativa = useRef<{ chave: string; assinatura: string } | null>(null);

  // Leva a atenção da pessoa (e de leitores de tela) para a mensagem de erro, que fica no fim da página.
  useEffect(() => {
    if (erro) alertaRef.current?.focus();
  }, [erro]);

  const retirada = modo === "RETIRADA";

  // O endereço salvo escolhido deixou de existir (ex.: lista recarregada): volta para "novo endereço".
  const salvo = enderecos.find((e) => e.id === selecionado) ?? null;
  const novo = salvo === null;

  // --- CEP efetivo e cotação de entrega (só na entrega) ---------------------
  const cep = salvo ? salvo.cep : (editado.cep ?? carrinho.cep).replace(/\D/g, "").slice(0, 8);
  const cepCompleto = cep.length === 8;
  const foraDaArea = !retirada && cepCompleto && !cepAtendido(cep);
  const chave = `${cep}|${totais.pesoTotalGramas}`;
  const cotacaoDoCarrinho = totais.cotacaoValida?.cep === cep ? totais.cotacaoValida : null;
  // Fora de Teresina nem consulta: a resposta já se sabe (e a consulta de CEP é limitada por IP).
  const precisaConsultar =
    !retirada && cepCompleto && !foraDaArea && totais.pesoTotalGramas > 0 && !cotacaoDoCarrinho && consulta?.chave !== chave;

  useEffect(() => {
    if (!precisaConsultar) return;
    let cancelado = false;
    calcularEntrega(cep, totais.pesoTotalGramas).then((resultado) => {
      if (!cancelado) setConsulta({ chave, resultado });
    });
    return () => {
      cancelado = true;
    };
  }, [precisaConsultar, cep, chave, totais.pesoTotalGramas]);

  const resultadoEntrega: ResultadoEntrega | null = cotacaoDoCarrinho
    ? { ok: true, cotacao: cotacaoDoCarrinho }
    : consulta?.chave === chave
      ? consulta.resultado
      : null;
  const entregaReais = resultadoEntrega?.ok ? resultadoEntrega.cotacao.valor : null;
  const consultando = !retirada && cepCompleto && !foraDaArea && totais.pesoTotalGramas > 0 && resultadoEntrega === null;
  const erroEntrega = foraDaArea
    ? MENSAGEM_FORA_DA_AREA
    : resultadoEntrega && !resultadoEntrega.ok
      ? resultadoEntrega.mensagem
      : null;
  const erroForaDaArea = foraDaArea || (resultadoEntrega !== null && !resultadoEntrega.ok && resultadoEntrega.foraDaArea === true);

  // --- valores do formulário de endereço novo -------------------------------
  const sugestao = resultadoEntrega?.ok ? resultadoEntrega.cotacao.endereco : undefined;
  const valores: CamposEndereco = {
    cep: mascararCep(cep),
    rua: editado.rua ?? sugestao?.rua ?? "",
    numero: editado.numero ?? "",
    complemento: editado.complemento ?? "",
    bairro: editado.bairro ?? sugestao?.bairro ?? "",
    cidade: editado.cidade ?? sugestao?.cidade ?? "",
    estado: (editado.estado ?? sugestao?.estado ?? "").toUpperCase(),
  };

  const enderecoCompleto = salvo
    ? true
    : cepCompleto &&
      valores.rua.trim() !== "" &&
      valores.numero.trim() !== "" &&
      valores.bairro.trim() !== "" &&
      valores.cidade.trim() !== "" &&
      /^[A-Z]{2}$/.test(valores.estado);

  // --- telefone ----------------------------------------------------------------
  const telefoneDigitos = normalizarTelefone(telefone);
  const telefoneOk = telefoneValido(telefoneDigitos);
  const erroTelefone = errosCampo.telefone?.[0] ?? (telefoneTocado && !telefoneOk ? MENSAGEM_TELEFONE_INVALIDO : undefined);

  // --- valores ---------------------------------------------------------------------
  const subtotal = totais.subtotal;
  // Em centavos inteiros, a mesma conta do servidor; é o valor que o cliente "viu" e confirma.
  const freteCentavos = retirada ? 0 : entregaReais === null ? null : Math.round(entregaReais * 100);
  const totalCentavos = freteCentavos === null ? null : totais.subtotalCentavos + freteCentavos;
  const total = totalCentavos === null ? null : totalCentavos / 100;
  const entregaPronta = retirada || (enderecoCompleto && !foraDaArea && entregaReais !== null);
  const podeFinalizar = !enviando && !totais.vazio && telefoneOk && entregaPronta;

  function escolherModo(novoModo: ModoEntrega) {
    setModo(novoModo);
    setOfertaRetirada(false);
    setErro(null);
    setErrosCampo({});
  }

  async function finalizar() {
    setErro(null);
    setOfertaMontarKit(false);
    setOfertaRetirada(false);
    setErrosCampo({});
    setTelefoneTocado(true);
    setEnviando(true);

    const itens = carrinho.itens.map((i) => ({ productId: i.productId, quantidade: i.quantidade }));
    const conteudo = {
      itens,
      ...(carrinho.kits.length > 0
        ? {
            kits: carrinho.kits.map((k) => ({
              kitId: k.kitId,
              quantidade: k.quantidade,
              sabores: k.sabores.map((s) => ({ productId: s.productId, quantidade: s.quantidade })),
            })),
          }
        : {}),
      modoEntrega: modo,
      telefone: telefoneDigitos,
    };
    // Na retirada não vai endereço nenhum (o servidor recusa se vier).
    const corpo = retirada
      ? conteudo
      : salvo
        ? { ...conteudo, addressId: salvo.id }
        : {
            ...conteudo,
            endereco: {
              cep,
              rua: valores.rua,
              numero: valores.numero,
              complemento: valores.complemento,
              bairro: valores.bairro,
              cidade: valores.cidade,
              estado: valores.estado,
            },
          };

    // Mesma compra => mesma chave (retry seguro); compra diferente => chave nova.
    const assinatura = JSON.stringify([corpo, totalCentavos]);
    if (tentativa.current?.assinatura !== assinatura) {
      tentativa.current = { chave: novaChave(), assinatura };
    }

    try {
      const resposta = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": tentativa.current.chave },
        body: JSON.stringify({ ...corpo, totalEsperadoCentavos: totalCentavos }),
      });
      const json = await resposta.json().catch(() => null);

      if (resposta.status === 401) {
        // Sessão expirou no meio do caminho: recarrega e o checkout pede login de novo.
        setErro("Sua sessão expirou. Entre de novo para finalizar o pedido (seu carrinho foi mantido).");
        router.refresh();
        return;
      }

      // Entrega fora de Teresina (endereço salvo antigo, ou a área mudou): sugere a retirada.
      if (resposta.status === 422 && json?.detalhes?.foraDaArea === true) {
        setOfertaRetirada(true);
        setErro(json?.erro ?? MENSAGEM_FORA_DA_AREA);
        return;
      }

      // Produtos (ou kits) que saíram da loja: diz quais, tira do carrinho e deixa a pessoa conferir.
      // Sai a caixa cujo kit saiu OU que leva algum sabor que saiu.
      if (resposta.status === 422 && Array.isArray(json?.detalhes?.indisponiveis)) {
        const ids: string[] = json.detalhes.indisponiveis;
        const kitIds: string[] = Array.isArray(json.detalhes.kitsIndisponiveis) ? json.detalhes.kitsIndisponiveis : [];
        const avulsos = carrinho.itens.filter((i) => ids.includes(i.productId)).map((i) => i.nome);
        const caixasQueSaem = carrinho.kits.filter((k) => kitIds.includes(k.kitId) || k.sabores.some((s) => ids.includes(s.productId)));
        const caixas = caixasQueSaem.map(nomeDaCaixa);
        const nomes = [...avulsos, ...caixas];
        acoesCarrinho.removerVarios(ids, kitIds);
        // "Montar outro kit" só quando o kit continua à venda (saiu um sabor): se foi o próprio kit
        // que saiu, o link levaria a "Os kits voltam em breve".
        setOfertaMontarKit(caixasQueSaem.some((k) => !kitIds.includes(k.kitId)));
        // Só com potes avulsos, a mesma frase de antes dos kits.
        const [um, varios] = caixas.length > 0 ? ["Este item", "Estes itens"] : ["Este produto", "Estes produtos"];
        setErro(
          `${nomes.length === 1 ? `${um} não está mais disponível e saiu` : `${varios} não estão mais disponíveis e saíram`} do carrinho: ${nomes.join("; ") || "veja o resumo"}. Confira o resumo e finalize de novo.`,
        );
        return;
      }

      // Preço, peso ou entrega mudaram desde que a pessoa viu o total: diz o que mudou e pede nova confirmação.
      if (resposta.status === 409 && Array.isArray(json?.detalhes?.itens)) {
        const atuais: { productId: string; nome?: string; preco: number; pesoGramas?: number }[] = json.detalhes.itens;
        const kitsAtuais: { kitId: string; nome?: string; preco: number; pesoCaixaGramas?: number; potes?: number }[] =
          Array.isArray(json.detalhes.kits) ? json.detalhes.kits : [];
        const mudancas = [
          ...atuais.flatMap((n) => {
            const antigo = carrinho.itens.find((i) => i.productId === n.productId);
            return antigo && antigo.preco !== n.preco
              ? [`${antigo.nome}: ${formatarBRL(antigo.preco)} → ${formatarBRL(n.preco)}`]
              : [];
          }),
          ...kitsAtuais.flatMap((n) => {
            const antigo = carrinho.kits.find((k) => k.kitId === n.kitId);
            return antigo && antigo.preco !== n.preco
              ? [`${antigo.nome}: ${formatarBRL(antigo.preco)} → ${formatarBRL(n.preco)}`]
              : [];
          }),
        ];
        // O kit passou a levar outro número de potes: as caixas montadas antes não servem mais.
        const foraDoTamanho = carrinho.kits.filter((k) => {
          const atual = kitsAtuais.find((n) => n.kitId === k.kitId);
          return atual?.potes !== undefined && !conferirComposicao(k.sabores, atual.potes).ok;
        });
        acoesCarrinho.atualizarPrecos(atuais, kitsAtuais);
        foraDoTamanho.forEach((k) => acoesCarrinho.removerKit(k.chave));
        acoesCarrinho.definirCotacao(null);
        setConsulta(null);
        setOfertaMontarKit(foraDoTamanho.length > 0);
        setErro(
          `Os valores mudaram desde que você viu o total${mudancas.length ? ` (${mudancas.join("; ")})` : " (a taxa de entrega foi atualizada)"}.${
            foraDoTamanho.length > 0 ? ` A caixa mudou de tamanho e saiu do carrinho: ${foraDoTamanho.map(nomeDaCaixa).join("; ")}.` : ""
          } Atualizamos o resumo: confira o novo total e finalize de novo.`,
        );
        return;
      }

      if (!resposta.ok) {
        setErro(json?.erro ?? "Não foi possível finalizar o pedido.");
        // Só o 400 traz erros por campo; nos demais, `detalhes` tem outro formato.
        const detalhes = json?.detalhes;
        const porCampo: Record<string, string[]> = resposta.status === 400 && detalhes && typeof detalhes === "object" ? detalhes : {};
        setErrosCampo(porCampo);
        // Caixa com potes a mais ou a menos ("kits.0.sabores", na posição em que foi enviada): só
        // acontece com um carrinho de antes de o kit mudar. Ela sai do carrinho, senão a pessoa ficaria
        // presa nesse erro; o caminho é montar de novo.
        const erradas = Object.keys(porCampo).flatMap((campo) => {
          const m = /^kits\.(\d+)\.sabores$/.exec(campo);
          const caixa = m ? carrinho.kits[Number(m[1])] : undefined;
          return caixa ? [caixa] : [];
        });
        erradas.forEach((k) => acoesCarrinho.removerKit(k.chave));
        setOfertaMontarKit(erradas.length > 0);
        if (erradas.length > 0) {
          // A frase do servidor ("Kit Presente: a caixa leva 3 potes; vieram 2.") vem primeiro, e o
          // que fizemos depois; os detalhes já entraram no texto, então não se repetem embaixo.
          const motivos = [...new Set(Object.values(porCampo).flat())].join(" ");
          setErrosCampo({});
          setErro(
            `${motivos || json?.erro || "Confira os potes do kit."} ${erradas.length === 1 ? "Esta caixa saiu" : "Estas caixas saíram"} do carrinho: ${erradas.map(nomeDaCaixa).join("; ")}. Se quiser, monte a caixa de novo.`,
          );
        }
        return;
      }

      // Pedido criado. A chave é descartada: a próxima compra, ainda que idêntica, é outro pedido.
      tentativa.current = null;
      const pedidoId: string = json.pedido.id;
      setUltimoPedidoId(pedidoId);

      // Com o link da InfinitePay: troca o checkout pela confirmação no histórico e vai pagar.
      // Sem link (pagamento simulado, ou a InfinitePay falhou): a confirmação oferece "Pagar".
      const checkoutUrl = json?.pagamento?.checkoutUrl;
      if (urlDePagamentoSegura(checkoutUrl)) {
        setIndoPagar(true);
        acoesCarrinho.limpar();
        history.replaceState(null, "", `/order-confirmation/${pedidoId}`);
        window.location.assign(checkoutUrl);
        return;
      }
      // `navegando` cobre o intervalo até a nova página abrir.
      iniciarNavegacao(() => {
        router.push(`/order-confirmation/${pedidoId}`);
      });
      acoesCarrinho.limpar();
    } catch {
      // Falha de rede: o servidor pode ter criado o pedido. A chave é mantida de propósito, então
      // tentar de novo com a mesma compra devolve o mesmo pedido em vez de criar outro.
      setErro("Sem conexão. Verifique sua internet e tente de novo (não cobraremos duas vezes).");
    } finally {
      setEnviando(false);
    }
  }

  // Até hidratar o carrinho ainda não foi lido do navegador: esqueleto, e não "carrinho vazio".
  if (!hidratado) {
    return <div className="h-96 animate-pulse rounded-2xl bg-accent1/30" role="status" aria-label="Carregando seu carrinho" />;
  }

  if (indoPagar) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="font-titulos text-2xl">Pedido criado! Levando você para o pagamento…</p>
        <p className="max-w-md text-sm text-primaria/85">
          Você vai para a página segura da InfinitePay. Depois de pagar, toque em “Continuar” para voltar ao seu pedido.
        </p>
      </div>
    );
  }

  if (navegando) {
    return (
      <p role="status" className="py-16 text-center font-titulos text-2xl">
        Pedido criado! Levando você para a confirmação…
      </p>
    );
  }

  if (totais.vazio) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        {erro && (
          <p ref={alertaRef} tabIndex={-1} role="alert" className="max-w-prose rounded-lg border-2 border-secundaria bg-white/70 p-3 font-medium text-secundaria">
            {erro}
          </p>
        )}
        {ofertaMontarKit && (
          <Link href="/kits" className="btn-secundario">
            Montar outro kit
          </Link>
        )}
        {ultimoPedidoId ? (
          <>
            <p className="font-titulos text-2xl">Seu pedido foi criado!</p>
            <Link href={`/order-confirmation/${ultimoPedidoId}`} className="btn-primario">
              Ver meu pedido
            </Link>
          </>
        ) : (
          <>
            <p className="font-titulos text-2xl">Seu carrinho está vazio.</p>
            <p className="text-primaria/80">Adicione algumas geleias para finalizar o pedido.</p>
            <Link href="/products" className="btn-primario">
              Ver produtos
            </Link>
          </>
        )}
      </div>
    );
  }

  // Erros por campo vêm com o caminho completo ("endereco.numero").
  const erroDoCampo = (campo: keyof CamposEndereco) => errosCampo[`endereco.${campo}`]?.[0];
  const primeiroDetalhe = Object.values(errosCampo).flat()[0];
  const editar = (campo: keyof CamposEndereco) => (valor: string) => setEditado((e) => ({ ...e, [campo]: valor }));
  const motivoDesabilitado = !telefoneOk
    ? "Informe seu WhatsApp com DDD para continuar."
    : retirada
      ? ""
      : foraDaArea
        ? "Escolha a retirada na loja ou um endereço em Teresina."
        : !enderecoCompleto
          ? "Complete o endereço de entrega para continuar."
          : "Aguardando o cálculo da entrega.";
  const taxa = taxaEntregaCentavos > 0 ? formatarBRL(taxaEntregaCentavos / 100) : "Grátis";
  const idTelefone = `${uid}-telefone`;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-primaria/80">
        Olá, <strong>{nomeUsuario.split(" ")[0]}</strong>! Falta pouco para sua geleia chegar.
      </p>

      {/* 1. Entrega ou retirada */}
      <Secao numero={1} titulo="Entrega ou retirada">
        <fieldset className="mb-5 grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">Como você quer receber?</legend>
          <OpcaoDeEntrega
            nome={`${uid}-modo`}
            marcado={!retirada}
            aoEscolher={() => escolherModo("ENTREGA")}
            titulo={`Entregar em ${CIDADE_ATENDIDA}`}
            preco={taxa}
            descricao="Para CEPs de Teresina (começam com 640)."
          />
          <OpcaoDeEntrega
            nome={`${uid}-modo`}
            marcado={retirada}
            aoEscolher={() => escolherModo("RETIRADA")}
            titulo="Retirar na loja"
            preco="Grátis"
            descricao={enderecoDeRetirada()}
          />
        </fieldset>

        {retirada ? (
          <p className="rounded-lg border border-accent3 bg-accent3/10 p-3 text-sm leading-relaxed">
            Depois que o pagamento for confirmado, chamamos você no WhatsApp para combinar o dia e o horário da retirada em{" "}
            <strong className="font-semibold">{enderecoDeRetirada()}</strong>.
          </p>
        ) : (
          <>
            {enderecos.length > 0 && (
              <fieldset className="mb-5 flex flex-col gap-2">
                <legend className="mb-2 text-sm font-semibold">Endereço de entrega</legend>
                {enderecos.map((e) => {
                  const atendido = cepAtendido(e.cep);
                  return (
                    <label key={e.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-accent2/70 p-3 has-checked:border-2 has-checked:border-secundaria has-checked:bg-accent1/20">
                      <input type="radio" name={`${uid}-endereco`} className="mt-1 size-4 accent-secundaria" checked={selecionado === e.id} onChange={() => setSelecionado(e.id)} />
                      <span className="text-sm leading-snug">
                        {e.rua}, {e.numero}
                        {e.complemento ? ` — ${e.complemento}` : ""}
                        <br />
                        {e.bairro} · {e.cidade}/{e.estado} · CEP {mascararCep(e.cep)}
                        {!atendido && <span className="mt-1 block text-xs font-semibold text-secundaria">Fora da área de entrega</span>}
                      </span>
                    </label>
                  );
                })}
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-accent2/70 p-3 has-checked:border-2 has-checked:border-secundaria has-checked:bg-accent1/20">
                  <input type="radio" name={`${uid}-endereco`} className="size-4 accent-secundaria" checked={novo} onChange={() => setSelecionado(NOVO)} />
                  <span className="text-sm font-semibold">Usar um novo endereço</span>
                </label>
              </fieldset>
            )}

            {novo && (
              <div className="grid grid-cols-6 gap-4">
                <div className="col-span-6 sm:col-span-2">
                  <label htmlFor="end-cep" className="mb-1 block text-sm font-semibold">CEP</label>
                  <input
                    id="end-cep"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    placeholder="64000-000"
                    value={valores.cep}
                    onChange={(e) => {
                      // Mudou o CEP: o endereço sugerido do anterior não vale mais.
                      const cepDigitado = e.target.value;
                      setEditado((x) => ({ ...x, cep: cepDigitado, rua: undefined, bairro: undefined, cidade: undefined, estado: undefined }));
                    }}
                    className="campo"
                    aria-invalid={erroEntrega || erroDoCampo("cep") ? true : undefined}
                    aria-describedby="status-cep"
                  />
                  <p id="status-cep" className="mt-1 text-xs" role="status" aria-live="polite">
                    {consultando ? "Consultando CEP…" : !foraDaArea ? (erroEntrega ?? erroDoCampo("cep") ?? null) : null}
                  </p>
                </div>
                <Campo id="end-rua" rotulo="Rua" valor={valores.rua} aoMudar={editar("rua")} autoComplete="address-line1" className="col-span-6 sm:col-span-4" erro={erroDoCampo("rua")} />
                <Campo id="end-numero" rotulo="Número" valor={valores.numero} aoMudar={editar("numero")} autoComplete="off" className="col-span-3 sm:col-span-2" erro={erroDoCampo("numero")} />
                <Campo id="end-complemento" rotulo="Complemento (opcional)" valor={valores.complemento} aoMudar={editar("complemento")} autoComplete="address-line2" className="col-span-6 sm:col-span-4" erro={erroDoCampo("complemento")} />
                <Campo id="end-bairro" rotulo="Bairro" valor={valores.bairro} aoMudar={editar("bairro")} autoComplete="off" className="col-span-6 sm:col-span-3" erro={erroDoCampo("bairro")} />
                <Campo id="end-cidade" rotulo="Cidade" valor={valores.cidade} aoMudar={editar("cidade")} autoComplete="address-level2" className="col-span-4 sm:col-span-2" erro={erroDoCampo("cidade")} />
                <Campo id="end-estado" rotulo="UF" valor={valores.estado} aoMudar={(v) => editar("estado")(v.slice(0, 2))} autoComplete="address-level1" maxLength={2} className="col-span-2 sm:col-span-1" erro={erroDoCampo("estado")} />
              </div>
            )}

            {/* Fora de Teresina: o caminho é a retirada na loja (um toque troca a opção lá em cima). */}
            {erroForaDaArea ? (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border-2 border-secundaria bg-white/70 p-3" role="status">
                <p className="min-w-0 flex-1 basis-56 text-sm font-medium text-secundaria">{MENSAGEM_FORA_DA_AREA}</p>
                <button type="button" className="btn-secundario" onClick={() => escolherModo("RETIRADA")}>
                  Retirar na loja
                </button>
              </div>
            ) : (
              erroEntrega && (
                // Falha ao calcular a entrega de um endereço salvo (ou do CEP digitado): permite tentar de novo.
                <div className="mt-3 flex flex-wrap items-center gap-3" role="status">
                  {salvo && <p className="text-sm font-medium text-secundaria">{erroEntrega}</p>}
                  <button type="button" className="btn-secundario" onClick={() => setConsulta(null)}>
                    Tentar calcular a entrega de novo
                  </button>
                </div>
              )
            )}
          </>
        )}
      </Secao>

      {/* 2. WhatsApp */}
      <Secao numero={2} titulo="Seu WhatsApp">
        <div className="max-w-sm">
          <label htmlFor={idTelefone} className="mb-1 block text-sm font-semibold">
            WhatsApp com DDD
          </label>
          <input
            id={idTelefone}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="(86) 99999-9999"
            required
            aria-required="true"
            value={telefone}
            onChange={(e) => {
              setTelefone(mascararTelefone(normalizarTelefone(e.target.value)));
              // O erro do servidor some ao corrigir; o de formato volta a ser conferido no blur.
              if (errosCampo.telefone) {
                setErrosCampo((atuais) => {
                  const resto = { ...atuais };
                  delete resto.telefone;
                  return resto;
                });
              }
            }}
            onBlur={() => setTelefoneTocado(true)}
            className="campo"
            aria-invalid={erroTelefone ? true : undefined}
            aria-describedby={erroTelefone ? `${idTelefone}-erro` : `${idTelefone}-dica`}
          />
          {erroTelefone ? (
            <p id={`${idTelefone}-erro`} className="mt-1 text-xs font-medium text-secundaria">
              {erroTelefone}
            </p>
          ) : (
            <p id={`${idTelefone}-dica`} className="mt-1 text-xs text-primaria/80">
              Para combinar a {retirada ? "retirada" : "entrega"}. Só usamos para falar sobre o seu pedido.
            </p>
          )}
        </div>
      </Secao>

      {/* 3. Resumo */}
      <Secao numero={3} titulo="Resumo do pedido">
        <ul className="divide-y divide-accent1/70">
          {carrinho.kits.map((k) => (
            <li key={k.chave} className="flex items-center gap-3 py-2 text-sm">
              <MiniaturaKit sabores={k.sabores} className="size-14" />
              <span className="min-w-0 flex-1">
                {k.quantidade} × {k.nome}
                <span className="block text-primaria/80">{textoDaComposicao(k.sabores)}</span>
              </span>
              <span className="shrink-0 self-baseline font-semibold">{formatarBRL((emCentavos(k.preco) * k.quantidade) / 100)}</span>
            </li>
          ))}
          {carrinho.itens.map((i) => (
            <li key={i.productId} className="flex items-baseline justify-between gap-4 py-2 text-sm">
              <span>
                {i.quantidade} × {i.nome}
              </span>
              <span className="shrink-0 font-semibold">{formatarBRL(i.preco * i.quantidade)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 flex flex-col gap-1.5 border-t-2 border-accent2/60 pt-4 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{formatarBRL(subtotal)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>{retirada ? "Retirada na loja" : "Taxa de entrega"}</dt>
            <dd className="text-right">
              {retirada
                ? "Grátis"
                : entregaReais !== null
                  ? formatarBRL(entregaReais)
                  : consultando
                    ? "calculando…"
                    : foraDaArea
                      ? "fora da área"
                      : "informe o CEP"}
            </dd>
          </div>
          <div className="flex justify-between pt-1 text-xl font-bold">
            <dt>Total</dt>
            <dd>{total !== null ? formatarBRL(total) : formatarBRL(subtotal)}</dd>
          </div>
        </dl>
        {totais.economiaKitsCentavos > 0 && (
          <p className="mt-3 text-xs text-primaria/85">
            Com {totais.caixas === 1 ? "o kit" : "os kits"}, você economiza {formatarBRL(totais.economiaKitsCentavos / 100)} em relação aos
            potes avulsos (já descontado no subtotal).
          </p>
        )}
        <p className="mt-3 text-xs text-primaria/80">
          Os valores finais são conferidos pelo servidor ao finalizar o pedido.
        </p>
      </Secao>

      {/* 4. Pagamento */}
      <Secao numero={4} titulo="Pagamento">
        <p className="mb-3 text-sm text-primaria/85">
          Você paga com <strong className="font-semibold">PIX ou cartão (até 12x)</strong> na página segura da InfinitePay e volta para
          cá. No parcelado, os juros aparecem antes de você confirmar.
        </p>
        <p className="mb-4 text-sm text-primaria/85">
          Antes de pagar, veja como funcionam a{" "}
          <Link href="/entrega-e-trocas" target="_blank" className="font-semibold text-secundaria underline underline-offset-2 hover:text-primaria">
            entrega e as trocas<span className="sr-only"> (abre em nova aba)</span>
          </Link>{" "}
          e como cuidamos dos{" "}
          <Link href="/privacidade" target="_blank" className="font-semibold text-secundaria underline underline-offset-2 hover:text-primaria">
            seus dados<span className="sr-only"> (abre em nova aba)</span>
          </Link>
          .
        </p>
        <p ref={alertaRef} tabIndex={-1} role="alert" className="mb-3 min-h-5 text-sm font-medium text-secundaria outline-offset-4">
          {erro}
          {primeiroDetalhe ? ` ${primeiroDetalhe}` : ""}
        </p>
        {ofertaRetirada && (
          <p className="mb-3">
            <button type="button" className="btn-secundario" onClick={() => escolherModo("RETIRADA")}>
              Retirar na loja
            </button>
          </p>
        )}
        {ofertaMontarKit && (
          <p className="mb-3 text-sm">
            <Link href="/kits" className="font-semibold text-secundaria underline underline-offset-2">
              Montar outro kit
            </Link>
          </p>
        )}
        <button
          type="button"
          className="btn-primario w-full py-3 text-base"
          disabled={!podeFinalizar}
          aria-describedby={!podeFinalizar && !enviando ? "motivo-desabilitado" : undefined}
          onClick={finalizar}
        >
          {enviando ? "Finalizando pedido…" : "Finalizar e ir para o pagamento"}
        </button>
        {!podeFinalizar && !enviando && motivoDesabilitado && (
          <p id="motivo-desabilitado" className="mt-2 text-center text-xs text-primaria/80">
            {motivoDesabilitado}
          </p>
        )}
      </Secao>
    </div>
  );
}

/** Uma das duas opções (entrega ou retirada): o cartão inteiro é o rótulo do radio. */
function OpcaoDeEntrega({
  nome,
  marcado,
  aoEscolher,
  titulo,
  preco,
  descricao,
}: {
  nome: string;
  marcado: boolean;
  aoEscolher: () => void;
  titulo: string;
  preco: string;
  descricao: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-accent2/70 p-3 has-checked:border-2 has-checked:border-secundaria has-checked:bg-accent1/20">
      <input type="radio" name={nome} className="mt-1 size-4 shrink-0 accent-secundaria" checked={marcado} onChange={aoEscolher} />
      <span className="min-w-0 text-sm leading-snug">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-semibold">{titulo}</span>
          <span className="font-semibold tabular-nums">{preco}</span>
        </span>
        <span className="mt-0.5 block text-xs text-primaria/80">{descricao}</span>
      </span>
    </label>
  );
}

function Campo({
  id,
  rotulo,
  valor,
  aoMudar,
  autoComplete,
  className,
  maxLength,
  erro,
}: {
  id: string;
  rotulo: string;
  valor: string;
  aoMudar: (valor: string) => void;
  autoComplete: string;
  className?: string;
  maxLength?: number;
  erro?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {rotulo}
      </label>
      <input
        id={id}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        autoComplete={autoComplete}
        maxLength={maxLength}
        className="campo"
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${id}-erro` : undefined}
      />
      {erro && (
        <p id={`${id}-erro`} className="mt-1 text-xs font-medium text-secundaria">
          {erro}
        </p>
      )}
    </div>
  );
}
