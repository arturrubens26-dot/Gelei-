"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Campo, OpcaoDeEntrega, Secao } from "@/components/checkout/PartesDoFormulario";
import { novaChave } from "@/components/checkout/novaChave";
import { FotoDoPote } from "@/components/FotoDoPote";
import { diaComSemana } from "@/components/lembrancinhas/datas";
import { calcularEntrega, mascararCep, type ResultadoEntrega } from "@/lib/carrinho/entrega";
import { formatarDia } from "@/lib/despesas";
import { formatarBRL } from "@/lib/dinheiro";
import { textosDaPolitica } from "@/lib/encomendas-politica";
import {
  ANTECEDENCIA_MIN_DIAS,
  HORAS_PARA_PAGAR_ENTRADA,
  TAMANHO_MAX_TEXTO,
  calcularValores,
  corteDaEntrega,
  diaValido,
  faixaDeDatas,
  formatarPrazo,
  meioDia,
  palavraDoModo,
  pesoDaEncomenda,
  prazosDaEncomenda,
  validarDatas,
} from "@/lib/encomendas-regras";
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
import type { LembrancinhasDTO } from "@/lib/lembrancinhas";

const NOVO = "novo";
const brl = (centavos: number) => formatarBRL(centavos / 100);
const potinhos = (n: number) => `${n} ${n === 1 ? "potinho" : "potinhos"}`;

type CamposEndereco = { cep: string; rua: string; numero: string; complemento: string; bairro: string; cidade: string; estado: string };

type Props = {
  config: LembrancinhasDTO;
  /** "Hoje" na loja, do SERVIDOR (o do navegador pode estar errado). */
  hoje: string;
  nomeUsuario: string;
  enderecos: EnderecoSalvo[];
  /** Último WhatsApp informado nos pedidos (só dígitos), para não pedir de novo. */
  telefoneInicial: string | null;
  /** Taxa de entrega em Teresina em vigor (painel); o servidor recalcula ao receber. */
  taxaEntregaCentavos: number;
};

/**
 * Solicitação de lembrancinhas (minis de 40 ml), pensada primeiro para o celular. Na ordem: data da
 * festa, sabores (15 a 50 potinhos), entrega ou retirada e o dia, WhatsApp e observação, e o resumo
 * com a política de desistência (as datas e valores desta encomenda) e o aceite.
 *
 * As contas são as de `encomendas-regras` (as mesmas do servidor, em centavos): o total que a cliente
 * vê vai no envio e o servidor recusa (409) se algo mudou. Nada é cobrado agora: a Geleiô aprova
 * antes, e então a cliente paga a entrada pela página da encomenda.
 */
export function FormEncomenda({ config, hoje, nomeUsuario, enderecos, telefoneInicial, taxaEntregaCentavos }: Props) {
  const router = useRouter();
  const uid = useId();
  const { minPotinhos, maxPotinhos } = config;

  // Valores que o servidor pode atualizar (409) sem recarregar a página.
  const [precoCentavos, setPrecoCentavos] = useState(config.precoPotinhoCentavos);
  const [taxaCentavos, setTaxaCentavos] = useState(taxaEntregaCentavos);
  const [politica, setPolitica] = useState({ versao: config.politicaVersao, percentualRetido: config.percentualRetido });

  const [quantidades, setQuantidades] = useState<Record<string, number>>({});
  const [dataFesta, setDataFesta] = useState("");
  const [dataEntrega, setDataEntrega] = useState("");
  const [modo, setModo] = useState<ModoEntrega>("ENTREGA");
  const [selecionado, setSelecionado] = useState<string>(enderecos.find((e) => cepAtendido(e.cep))?.id ?? NOVO);
  const [editado, setEditado] = useState<Partial<CamposEndereco>>({});
  const [consulta, setConsulta] = useState<{ cep: string; resultado: ResultadoEntrega } | null>(null);
  const [telefone, setTelefone] = useState(() => (telefoneInicial ? formatarTelefone(telefoneInicial) : ""));
  const [telefoneTocado, setTelefoneTocado] = useState(false);
  const [observacao, setObservacao] = useState("");
  const [aceite, setAceite] = useState(false);

  const [enviando, setEnviando] = useState(false);
  const [navegando, iniciarNavegacao] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  // O aviso é a lista do que falta preencher: ele acompanha o formulário (some o que já foi resolvido).
  const [erroDeFalta, setErroDeFalta] = useState(false);
  const [errosCampo, setErrosCampo] = useState<Record<string, string[]>>({});
  const [ofertaRetirada, setOfertaRetirada] = useState(false);
  const [tentouEnviar, setTentouEnviar] = useState(false);
  const alertaRef = useRef<HTMLParagraphElement>(null);
  // Idempotency-Key atrelada ao CONTEÚDO (mesma solicitação reenviada depois de falha de rede = a
  // mesma encomenda; qualquer mudança gera chave nova).
  const tentativa = useRef<{ chave: string; assinatura: string } | null>(null);

  useEffect(() => {
    if (erro) alertaRef.current?.focus();
  }, [erro]);

  // --- sabores -------------------------------------------------------------------------------------
  const sabores = config.sabores;
  const porId = new Map(sabores.map((s) => [s.productId, s]));
  const escolhidos = sabores.filter((s) => (quantidades[s.productId] ?? 0) > 0);
  const total = escolhidos.reduce((soma, s) => soma + quantidades[s.productId], 0);
  const potinhosOk = total >= minPotinhos && total <= maxPotinhos;
  const cheio = total >= maxPotinhos;

  function definirQuantidade(productId: string, valor: number) {
    const outros = total - (quantidades[productId] ?? 0);
    const limitado = Math.max(0, Math.min(valor, maxPotinhos - outros));
    setQuantidades((q) => ({ ...q, [productId]: limitado }));
    limparErro("itens");
  }

  // --- datas ---------------------------------------------------------------------------------------
  const faixa = faixaDeDatas(hoje, diaValido(dataFesta) ? dataFesta : undefined);
  const retirada = modo === "RETIRADA";
  const palavra = palavraDoModo(modo);
  const Palavra = palavra[0].toUpperCase() + palavra.slice(1);
  const conferencia = validarDatas({ hoje, dataFesta, dataEntrega, modo });
  const errosDeData = conferencia.ok ? {} : conferencia.erros;
  // Erro de data aparece quando a data foi escolhida (ou ao tentar enviar), nunca no campo vazio antes.
  const erroFesta = errosCampo.dataFesta?.[0] ?? (dataFesta || tentouEnviar ? (dataFesta ? errosDeData.dataFesta?.[0] : "Escolha a data da festa.") : undefined);
  const erroEntrega =
    errosCampo.dataEntrega?.[0] ??
    (dataEntrega || tentouEnviar ? (dataEntrega ? errosDeData.dataEntrega?.[0] : `Escolha o dia da ${palavra}.`) : undefined);
  const datasOk = conferencia.ok;

  // --- entrega -------------------------------------------------------------------------------------
  const salvo = enderecos.find((e) => e.id === selecionado) ?? null;
  const novo = salvo === null;
  const cep = salvo ? salvo.cep : (editado.cep ?? "").replace(/\D/g, "").slice(0, 8);
  const cepCompleto = cep.length === 8;
  const foraDaArea = !retirada && cepCompleto && !cepAtendido(cep);
  // A consulta do CEP só preenche rua e bairro (em Teresina a taxa é a do painel, não depende do peso).
  const pesoGramas = pesoDaEncomenda(Math.max(total, minPotinhos), config.pesoPotinhoGramas, config.pesoEmbalagemGramas);
  const precisaConsultar = !retirada && novo && cepCompleto && !foraDaArea && consulta?.cep !== cep;
  useEffect(() => {
    if (!precisaConsultar) return;
    let cancelado = false;
    calcularEntrega(cep, pesoGramas).then((resultado) => {
      if (!cancelado) setConsulta({ cep, resultado });
    });
    return () => {
      cancelado = true;
    };
    // O peso só vai junto: mudar a quantidade não precisa consultar o CEP de novo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [precisaConsultar, cep]);
  const resultadoCep = consulta?.cep === cep ? consulta.resultado : null;
  const consultandoCep = precisaConsultar && resultadoCep === null;
  const sugestao = resultadoCep?.ok ? resultadoCep.cotacao.endereco : undefined;
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
  const entregaPronta = retirada || (enderecoCompleto && !foraDaArea);
  const erroForaDaArea = foraDaArea || (resultadoCep !== null && !resultadoCep.ok && resultadoCep.foraDaArea === true);
  const erroCep = !foraDaArea && resultadoCep && !resultadoCep.ok && !resultadoCep.foraDaArea ? resultadoCep.mensagem : null;

  function escolherModo(novoModo: ModoEntrega) {
    setModo(novoModo);
    setOfertaRetirada(false);
    setErrosCampo((atuais) => {
      const resto = { ...atuais };
      for (const k of Object.keys(resto)) if (k === "endereco" || k.startsWith("endereco.") || k === "dataEntrega") delete resto[k];
      return resto;
    });
  }

  // --- telefone ------------------------------------------------------------------------------------
  const telefoneDigitos = normalizarTelefone(telefone);
  const telefoneOk = telefoneValido(telefoneDigitos);
  const erroTelefone = errosCampo.telefone?.[0] ?? ((telefoneTocado || tentouEnviar) && !telefoneOk ? MENSAGEM_TELEFONE_INVALIDO : undefined);

  // --- valores e prazos (centavos, a conta do servidor) ---------------------------------------------
  const freteCentavos = retirada ? 0 : entregaPronta ? taxaCentavos : null;
  const contas = total > 0 && precoCentavos > 0 ? calcularValores({ subtotalCentavos: total * precoCentavos, freteCentavos: freteCentavos ?? 0 }) : null;
  const totalCentavos = contas && freteCentavos !== null ? contas.total : null;
  const corteEm = datasOk ? corteDaEntrega(dataEntrega) : null;
  const responderAte = datasOk ? prazosDaEncomenda(meioDia(hoje), dataEntrega).responderAte : null;
  const textos = corteEm && contas && freteCentavos !== null ? politicaDaTela(politica, { corteEm, ...contas, modo }) : null;

  function limparErro(campo: string) {
    if (!errosCampo[campo]) return;
    setErrosCampo((atuais) => {
      const resto = { ...atuais };
      delete resto[campo];
      return resto;
    });
  }

  /** O que falta, na ordem da página (o primeiro vira o aviso e recebe o foco). */
  function pendencias(): string[] {
    const faltas: string[] = [];
    if (!datasOk) faltas.push(dataFesta ? "Confira as datas." : "Escolha a data da festa.");
    if (!potinhosOk) {
      faltas.push(total < minPotinhos ? `Escolha pelo menos ${minPotinhos} potinhos (agora: ${total}).` : `No máximo ${maxPotinhos} potinhos.`);
    }
    if (!retirada && foraDaArea) faltas.push("Entregamos só em Teresina: escolha a retirada na loja ou um endereço de Teresina.");
    else if (!entregaPronta) faltas.push("Complete o endereço de entrega.");
    if (!telefoneOk) faltas.push("Informe seu WhatsApp com DDD.");
    if (!aceite) faltas.push("Leia e aceite a política de desistência.");
    return faltas;
  }

  async function enviar() {
    if (enviando) return;
    setTentouEnviar(true);
    setTelefoneTocado(true);
    setOfertaRetirada(false);
    const faltas = pendencias();
    if (faltas.length > 0 || totalCentavos === null) {
      setErrosCampo({});
      setErroDeFalta(true);
      // Texto novo a cada tentativa (o efeito leva o foco ao aviso de novo).
      setErro(`Falta pouco: ${faltas.join(" ")}${erro?.endsWith(" ") ? "" : " "}`);
      return;
    }
    setErroDeFalta(false);
    setErro(null);
    setErrosCampo({});
    setEnviando(true);

    const itens = escolhidos.map((s) => ({ productId: s.productId, quantidade: quantidades[s.productId] }));
    const conteudo = {
      itens,
      dataFesta,
      dataEntrega,
      modoEntrega: modo,
      ...(retirada
        ? {}
        : salvo
          ? { addressId: salvo.id }
          : {
              endereco: {
                cep,
                rua: valores.rua,
                numero: valores.numero,
                complemento: valores.complemento,
                bairro: valores.bairro,
                cidade: valores.cidade,
                estado: valores.estado,
              },
            }),
      telefone: telefoneDigitos,
      observacao: observacao.trim() || null,
    };
    const assinatura = JSON.stringify([conteudo, totalCentavos]);
    if (tentativa.current?.assinatura !== assinatura) tentativa.current = { chave: novaChave(), assinatura };

    try {
      const resposta = await fetch("/api/encomendas", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": tentativa.current.chave },
        body: JSON.stringify({
          ...conteudo,
          aceitePolitica: true,
          politicaVersao: politica.versao,
          percentualRetido: politica.percentualRetido,
          totalEsperadoCentavos: totalCentavos,
        }),
      });
      const json = await resposta.json().catch(() => null);
      const detalhes = json?.detalhes && typeof json.detalhes === "object" ? json.detalhes : null;

      if (resposta.ok && typeof json?.encomenda?.id === "string") {
        tentativa.current = null;
        const id: string = json.encomenda.id;
        iniciarNavegacao(() => router.push(`/minhas-encomendas/${encodeURIComponent(id)}`));
        return;
      }
      if (resposta.status === 401) {
        setErro("Sua sessão expirou. Entre de novo para enviar a solicitação.");
        router.refresh();
        return;
      }
      if (resposta.status === 503) {
        // Encomendas fechadas no meio do caminho: a página passa a mostrar o aviso.
        setErro(json?.erro ?? "As encomendas não estão abertas no momento.");
        router.refresh();
        return;
      }
      if (resposta.status === 422 && detalhes?.foraDaArea === true) {
        setOfertaRetirada(true);
        setErro(json?.erro ?? MENSAGEM_FORA_DA_AREA);
        return;
      }
      if (resposta.status === 422 && Array.isArray(detalhes?.indisponiveis)) {
        const ids: string[] = detalhes.indisponiveis;
        const nomes = ids.map((id) => porId.get(id)?.sabor ?? "um sabor");
        setQuantidades((q) => Object.fromEntries(Object.entries(q).filter(([id]) => !ids.includes(id))));
        setErro(
          `${nomes.join(" e ")} ${ids.length === 1 ? "não está mais disponível em mini e saiu" : "não estão mais disponíveis em mini e saíram"} da sua escolha. Confira os potinhos e envie de novo.`,
        );
        router.refresh();
        return;
      }
      if (resposta.status === 409 && detalhes && typeof detalhes.politicaVersao === "string") {
        setPolitica({ versao: detalhes.politicaVersao, percentualRetido: Number(detalhes.percentualRetido) || 0 });
        setAceite(false);
        setErro("A política de desistência mudou. Leia de novo no resumo, marque o aceite e envie.");
        return;
      }
      if (resposta.status === 409 && detalhes && typeof detalhes.total === "number") {
        if (typeof detalhes.precoPotinho === "number") setPrecoCentavos(Math.round(detalhes.precoPotinho * 100));
        if (!retirada && typeof detalhes.frete === "number") setTaxaCentavos(Math.round(detalhes.frete * 100));
        setErro(`Os valores mudaram desde que você abriu a página. O novo total é ${formatarBRL(detalhes.total)}: confira o resumo e envie de novo.`);
        return;
      }
      if (resposta.status === 422 && Array.isArray(detalhes?.["endereco.cep"])) {
        setErrosCampo({ "endereco.cep": detalhes["endereco.cep"] });
        setErro(json?.erro ?? "Confira o CEP.");
        return;
      }
      // 400 traz os erros por campo; nos demais, só a mensagem.
      const porCampo: Record<string, string[]> = resposta.status === 400 && detalhes ? detalhes : {};
      setErrosCampo(porCampo);
      const primeiro = Object.values(porCampo).flat()[0];
      setErro(`${json?.erro ?? "Não foi possível enviar a solicitação."}${primeiro && primeiro !== json?.erro ? ` ${primeiro}` : ""}`);
    } catch {
      // A chave fica: reenviar a mesma solicitação devolve a mesma encomenda, sem duplicar.
      setErro("Sem conexão. Verifique sua internet e tente de novo (não vai duplicar a solicitação).");
    } finally {
      setEnviando(false);
    }
  }

  const faltasAgora = erroDeFalta ? pendencias() : [];

  if (navegando) {
    return (
      <p role="status" className="py-16 text-center font-titulos text-2xl">
        Solicitação enviada! Abrindo a sua encomenda…
      </p>
    );
  }

  const erroDoEndereco = (campo: keyof CamposEndereco) => errosCampo[`endereco.${campo}`]?.[0];
  const editar = (campo: keyof CamposEndereco) => (valor: string) => {
    setEditado((e) => ({ ...e, [campo]: valor }));
    limparErro(`endereco.${campo}`);
  };
  const idFesta = `${uid}-festa`;
  const idEntrega = `${uid}-entrega`;
  const idTelefone = `${uid}-telefone`;
  const idObs = `${uid}-obs`;
  const idAceite = `${uid}-aceite`;
  const erroItens = errosCampo.itens?.[0] ?? (tentouEnviar && !potinhosOk ? `Escolha de ${minPotinhos} a ${maxPotinhos} potinhos; você escolheu ${total}.` : undefined);
  const erroAceite = errosCampo.aceitePolitica?.[0] ?? (tentouEnviar && !aceite ? "Marque o aceite para enviar." : undefined);
  const taxa = taxaCentavos > 0 ? brl(taxaCentavos) : "Grátis";
  const progresso = Math.min(100, (total / maxPotinhos) * 100);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-primaria/85">
        Olá, <strong>{nomeUsuario.split(" ")[0]}</strong>! Monte sua encomenda: a Geleiô confere a agenda e responde antes de qualquer
        cobrança.
      </p>

      {/* 1. Festa */}
      <Secao numero={1} titulo="Quando é a festa?">
        <div className="max-w-xs">
          <label htmlFor={idFesta} className="mb-1 block text-sm font-semibold">
            Data da festa
          </label>
          <input
            id={idFesta}
            type="date"
            className="campo"
            min={faixa.festaMin}
            max={faixa.festaMax}
            value={dataFesta}
            required
            onChange={(e) => {
              setDataFesta(e.target.value);
              limparErro("dataFesta");
            }}
            aria-invalid={erroFesta ? true : undefined}
            aria-describedby={`${idFesta}-dica`}
          />
          <p id={`${idFesta}-dica`} className={`mt-1 text-xs ${erroFesta ? "font-medium text-secundaria" : "text-primaria/80"}`}>
            {erroFesta ?? `A partir de ${formatarDia(faixa.festaMin)} (${ANTECEDENCIA_MIN_DIAS} dias de antecedência).`}
          </p>
        </div>
      </Secao>

      {/* 2. Sabores */}
      <Secao numero={2} titulo="Sabores e quantidades">
        <p className="mb-4 text-sm text-primaria/85">
          Potinhos de 40 ml a <strong className="font-semibold">{brl(precoCentavos)}</strong> cada. Misture os sabores como quiser: de{" "}
          {minPotinhos} a {maxPotinhos} potinhos no total.
        </p>
        <ul className="@container flex flex-col gap-3" aria-describedby={`${uid}-contagem`}>
          {sabores.map((s) => {
            const qtd = quantidades[s.productId] ?? 0;
            return (
              // Estreito: o nome em cima (largura toda) e o contador embaixo. Largo (≥ 26rem): numa linha só.
              <li
                key={s.productId}
                className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-md border p-2.5 motion-safe:transition-colors @[26rem]:grid-cols-[auto_minmax(0,1fr)_auto] ${
                  qtd > 0 ? "border-secundaria/70 bg-accent1/25" : "border-accent2/60 bg-white/70"
                }`}
              >
                <span className="row-span-2 size-14 overflow-hidden rounded-sm bg-[#f3ece3] @[26rem]:row-span-1">
                  <FotoDoPote src={s.imagemUrl} alt="" lado={128} sizes="56px" className="size-full scale-[1.3] object-cover object-[50%_58%]" />
                </span>
                <span className="font-titulos text-lg font-semibold leading-snug">{s.sabor}</span>
                <Contador
                  sabor={s.sabor}
                  valor={qtd}
                  cheio={cheio}
                  aoMudar={(v) => definirQuantidade(s.productId, v)}
                />
              </li>
            );
          })}
        </ul>
        <div className="mt-4">
          <div className="relative h-2.5 overflow-hidden rounded-full bg-accent1/40" aria-hidden="true">
            <div
              className={`h-full rounded-full motion-safe:transition-[width] ${potinhosOk ? "bg-accent3" : "bg-secundaria"}`}
              style={{ width: `${progresso}%` }}
            />
            {/* Marca do mínimo. */}
            <span className="absolute inset-y-0 w-0.5 bg-primaria/70" style={{ left: `${(minPotinhos / maxPotinhos) * 100}%` }} />
          </div>
          <p id={`${uid}-contagem`} className="mt-2 text-sm font-semibold" role="status" aria-live="polite">
            {potinhos(total)}; mínimo {minPotinhos}, máximo {maxPotinhos}
          </p>
          {erroItens && <p className="mt-1 text-xs font-medium text-secundaria">{erroItens}</p>}
        </div>
      </Secao>

      {/* 3. Entrega ou retirada */}
      <Secao numero={3} titulo="Entrega ou retirada">
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

        <div className="mb-5 max-w-xs">
          <label htmlFor={idEntrega} className="mb-1 block text-sm font-semibold">
            Dia da {palavra}
          </label>
          <input
            id={idEntrega}
            type="date"
            className="campo"
            min={faixa.entregaMin}
            max={faixa.entregaMax}
            value={dataEntrega}
            required
            onChange={(e) => {
              setDataEntrega(e.target.value);
              limparErro("dataEntrega");
            }}
            aria-invalid={erroEntrega ? true : undefined}
            aria-describedby={`${idEntrega}-dica`}
          />
          <p id={`${idEntrega}-dica`} className={`mt-1 text-xs ${erroEntrega ? "font-medium text-secundaria" : "text-primaria/80"}`}>
            {erroEntrega ??
              (diaValido(dataFesta)
                ? `De ${formatarDia(faixa.entregaMin)} até a véspera da festa (${formatarDia(faixa.entregaMax)}). O horário a gente combina no WhatsApp.`
                : `A partir de ${formatarDia(faixa.entregaMin)}, até a véspera da festa. O horário a gente combina no WhatsApp.`)}
          </p>
        </div>

        {retirada ? (
          <p className="rounded-lg border border-accent3 bg-accent3/10 p-3 text-sm leading-relaxed">
            {Palavra} sem custo em <strong className="font-semibold">{enderecoDeRetirada()}</strong>.
          </p>
        ) : (
          <>
            {enderecos.length > 0 && (
              <fieldset className="mb-5 flex flex-col gap-2">
                <legend className="mb-2 text-sm font-semibold">Endereço de entrega</legend>
                {enderecos.map((e) => {
                  const atendido = cepAtendido(e.cep);
                  return (
                    <label
                      key={e.id}
                      className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-accent2/70 p-3 has-checked:border-2 has-checked:border-secundaria has-checked:bg-accent1/20"
                    >
                      <input
                        type="radio"
                        name={`${uid}-endereco`}
                        className="mt-1 size-4 accent-secundaria"
                        checked={selecionado === e.id}
                        onChange={() => setSelecionado(e.id)}
                      />
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
                  <label htmlFor={`${uid}-cep`} className="mb-1 block text-sm font-semibold">
                    CEP
                  </label>
                  <input
                    id={`${uid}-cep`}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    placeholder="64000-000"
                    value={valores.cep}
                    onChange={(e) => {
                      const digitado = e.target.value;
                      // Mudou o CEP: o endereço sugerido do anterior não vale mais.
                      setEditado((x) => ({ ...x, cep: digitado, rua: undefined, bairro: undefined, cidade: undefined, estado: undefined }));
                      limparErro("endereco.cep");
                    }}
                    className="campo"
                    aria-invalid={erroCep || erroDoEndereco("cep") ? true : undefined}
                    aria-describedby={`${uid}-cep-status`}
                  />
                  <p id={`${uid}-cep-status`} className="mt-1 text-xs" role="status" aria-live="polite">
                    {consultandoCep ? "Consultando CEP…" : (erroDoEndereco("cep") ?? erroCep ?? null)}
                  </p>
                </div>
                <Campo id={`${uid}-rua`} rotulo="Rua" valor={valores.rua} aoMudar={editar("rua")} autoComplete="address-line1" className="col-span-6 sm:col-span-4" erro={erroDoEndereco("rua")} />
                <Campo id={`${uid}-numero`} rotulo="Número" valor={valores.numero} aoMudar={editar("numero")} autoComplete="off" className="col-span-3 sm:col-span-2" erro={erroDoEndereco("numero")} />
                <Campo id={`${uid}-complemento`} rotulo="Complemento (opcional)" valor={valores.complemento} aoMudar={editar("complemento")} autoComplete="address-line2" className="col-span-6 sm:col-span-4" erro={erroDoEndereco("complemento")} />
                <Campo id={`${uid}-bairro`} rotulo="Bairro" valor={valores.bairro} aoMudar={editar("bairro")} autoComplete="off" className="col-span-6 sm:col-span-3" erro={erroDoEndereco("bairro")} />
                <Campo id={`${uid}-cidade`} rotulo="Cidade" valor={valores.cidade} aoMudar={editar("cidade")} autoComplete="address-level2" className="col-span-4 sm:col-span-2" erro={erroDoEndereco("cidade")} />
                <Campo id={`${uid}-estado`} rotulo="UF" valor={valores.estado} aoMudar={(v) => editar("estado")(v.slice(0, 2))} autoComplete="address-level1" maxLength={2} className="col-span-2 sm:col-span-1" erro={erroDoEndereco("estado")} />
              </div>
            )}

            {erroForaDaArea && (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border-2 border-secundaria bg-white/70 p-3" role="status">
                <p className="min-w-0 flex-1 basis-56 text-sm font-medium text-secundaria">{MENSAGEM_FORA_DA_AREA}</p>
                <button type="button" className="btn-secundario" onClick={() => escolherModo("RETIRADA")}>
                  Retirar na loja
                </button>
              </div>
            )}
            {errosCampo.endereco?.[0] && <p className="mt-3 text-sm font-medium text-secundaria">{errosCampo.endereco[0]}</p>}
          </>
        )}
      </Secao>

      {/* 4. Contato */}
      <Secao numero={4} titulo="Seu WhatsApp">
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
            value={telefone}
            onChange={(e) => {
              setTelefone(mascararTelefone(normalizarTelefone(e.target.value)));
              limparErro("telefone");
            }}
            onBlur={() => setTelefoneTocado(true)}
            className="campo"
            aria-invalid={erroTelefone ? true : undefined}
            aria-describedby={`${idTelefone}-dica`}
          />
          <p id={`${idTelefone}-dica`} className={`mt-1 text-xs ${erroTelefone ? "font-medium text-secundaria" : "text-primaria/80"}`}>
            {erroTelefone ?? "Usamos só para combinar esta encomenda (confirmação, pagamento e entrega). Nada de propaganda."}
          </p>
        </div>
        <div className="mt-5">
          <label htmlFor={idObs} className="mb-1 block text-sm font-semibold">
            Observação (opcional)
          </label>
          <textarea
            id={idObs}
            rows={3}
            maxLength={TAMANHO_MAX_TEXTO}
            value={observacao}
            onChange={(e) => {
              setObservacao(e.target.value);
              limparErro("observacao");
            }}
            placeholder="Tema da festa, cores, alguma dúvida…"
            className="campo resize-y"
            aria-invalid={errosCampo.observacao ? true : undefined}
            aria-describedby={`${idObs}-dica`}
          />
          <p id={`${idObs}-dica`} className={`mt-1 text-xs ${errosCampo.observacao ? "font-medium text-secundaria" : "text-primaria/80"}`}>
            {errosCampo.observacao?.[0] ?? `${observacao.length} de ${TAMANHO_MAX_TEXTO} caracteres.`}
          </p>
        </div>
      </Secao>

      {/* 5. Resumo, política e envio */}
      <Secao numero={5} titulo="Resumo e envio" id="resumo">
        {escolhidos.length > 0 && (
          <p className="mb-3 text-sm text-primaria/85">{escolhidos.map((s) => `${s.sabor} × ${quantidades[s.productId]}`).join(" · ")}</p>
        )}
        <dl className="flex flex-col gap-1.5 text-sm">
          <Linha rotulo={`${potinhos(total)} × ${brl(precoCentavos)}`} valor={brl(total * precoCentavos)} />
          <Linha
            rotulo={retirada ? "Retirada na loja" : "Taxa de entrega"}
            valor={retirada ? "Grátis" : freteCentavos !== null ? brl(freteCentavos) : foraDaArea ? "fora da área" : "informe o endereço"}
          />
          <div className="flex justify-between gap-4 border-t-2 border-accent2/60 pt-2 text-xl font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">{totalCentavos !== null ? brl(totalCentavos) : "—"}</dd>
          </div>
        </dl>

        <h3 className="mt-5 text-lg font-bold">Como você paga</h3>
        <ol className="mt-2 flex flex-col gap-2 text-sm">
          <li className="flex items-baseline justify-between gap-4 rounded-md border border-accent2/60 bg-white/70 p-3">
            <span>
              <strong className="font-semibold">Entrada (50% dos potinhos)</strong>
              <span className="block text-primaria/80">Depois que a Geleiô aprovar, em até {HORAS_PARA_PAGAR_ENTRADA} horas (nunca depois do prazo de desistência), pelo site (PIX ou cartão).</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums">{contas ? brl(contas.entrada) : "—"}</span>
          </li>
          <li className="flex items-baseline justify-between gap-4 rounded-md border border-accent2/60 bg-white/70 p-3">
            <span>
              <strong className="font-semibold">Restante{!retirada ? " (com a entrega)" : ""}</strong>
              <span className="block text-primaria/80">
                Até o dia da {palavra}
                {datasOk ? ` (${formatarDia(dataEntrega)})` : ""}, pelo site ou combinado com a Geleiô.
              </span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums">{contas && freteCentavos !== null ? brl(contas.restante) : "—"}</span>
          </li>
        </ol>

        {datasOk && responderAte && (
          <ul className="mt-4 flex flex-col gap-1 text-sm">
            <li>
              Festa: <strong className="font-semibold">{diaComSemana(dataFesta)}</strong>
            </li>
            <li>
              {Palavra}: <strong className="font-semibold">{diaComSemana(dataEntrega)}</strong>
            </li>
            <li>
              A Geleiô responde até <strong className="font-semibold">{formatarPrazo(responderAte)}</strong>.
            </li>
          </ul>
        )}

        <h3 className="mt-5 text-lg font-bold">Política de desistência</h3>
        {textos ? (
          <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed">
            {textos.map((t, i) => (
              // O 2º e o 3º itens limitam direitos (prazo e retenção da entrada): em destaque (Decreto 7.962, art. 4º, I).
              <li key={i} className={i === 1 || i === 2 ? "font-semibold" : undefined}>
                {t}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-primaria/85">
            Escolha as datas, os sabores{!retirada ? " e o endereço" : ""} para ver a política com as datas e os valores da sua encomenda.
          </p>
        )}

        <label htmlFor={idAceite} className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-accent2/70 bg-white/70 p-3">
          <input
            id={idAceite}
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 accent-secundaria"
            checked={aceite}
            disabled={!textos}
            onChange={(e) => {
              setAceite(e.target.checked);
              limparErro("aceitePolitica");
            }}
            aria-invalid={erroAceite ? true : undefined}
            aria-describedby={erroAceite ? `${idAceite}-erro` : undefined}
          />
          <span className="text-sm font-semibold">Li e aceito a política de desistência desta encomenda.</span>
        </label>
        {erroAceite && (
          <p id={`${idAceite}-erro`} className="mt-1 text-xs font-medium text-secundaria">
            {erroAceite}
          </p>
        )}

        <p ref={alertaRef} tabIndex={-1} role="alert" className="mt-4 min-h-5 text-sm font-medium text-secundaria outline-offset-4">
          {erroDeFalta ? (faltasAgora.length > 0 ? `Falta pouco: ${faltasAgora.join(" ")}` : null) : erro}
        </p>
        {ofertaRetirada && (
          <p className="mt-2">
            <button type="button" className="btn-secundario" onClick={() => escolherModo("RETIRADA")}>
              Retirar na loja
            </button>
          </p>
        )}
        <button
          type="button"
          className="btn-primario mt-3 w-full py-3 text-base aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          aria-disabled={enviando || undefined}
          onClick={enviar}
        >
          {enviando ? "Enviando…" : "Enviar solicitação"}
        </button>
        <p className="mt-2 text-center text-xs text-primaria/80">Nada é cobrado agora. Você paga a entrada só depois da aprovação.</p>
      </Secao>

      {/* Celular: total e entrada sempre à vista (sticky: some antes do rodapé, sem cobri-lo). */}
      <div className="sticky bottom-0 z-30 -mx-4 flex items-center justify-between gap-3 border-t-2 border-accent2/60 bg-destaque/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-10px_24px_-18px_rgb(107_29_42/0.6)] backdrop-blur-sm sm:-mx-6 sm:px-6 md:hidden">
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight tabular-nums">
            {totalCentavos !== null ? brl(totalCentavos) : contas ? brl(contas.subtotal) : brl(0)}
            <span className="ml-1.5 text-xs font-semibold text-primaria/85">{potinhos(total)}</span>
          </p>
          <p className="text-xs text-primaria/85">Entrada {contas ? brl(contas.entrada) : brl(0)}, depois da aprovação</p>
        </div>
        <a href="#resumo" className="btn-primario shrink-0 px-4">
          Revisar e enviar
        </a>
      </div>
    </div>
  );
}

/** Textos da política com os valores desta encomenda; `null` se a versão não for conhecida aqui. */
function politicaDaTela(
  politica: { versao: string; percentualRetido: number },
  d: { corteEm: Date; entrada: number; restante: number; frete: number; modo: ModoEntrega },
): string[] | null {
  try {
    return textosDaPolitica(politica.versao, {
      corteEm: d.corteEm,
      entradaCentavos: d.entrada,
      restanteCentavos: d.restante,
      freteCentavos: d.frete,
      modo: d.modo,
      percentualRetido: politica.percentualRetido,
    });
  } catch {
    // Versão nova que esta página ainda não conhece: recarregar traz o texto certo.
    return null;
  }
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt>{rotulo}</dt>
      <dd className="text-right tabular-nums">{valor}</dd>
    </div>
  );
}

/**
 * [−] [número] [+] de um sabor. O número aceita digitação (de 0 até o que cabe nos 50); os botões são
 * nativos, com nome acessível e alvo de 44 px. aria-disabled (não disabled): o botão não perde o foco.
 */
function Contador({ sabor, valor, cheio, aoMudar }: { sabor: string; valor: number; cheio: boolean; aoMudar: (v: number) => void }) {
  const [texto, setTexto] = useState<string | null>(null);
  const botao =
    "inline-flex size-11 items-center justify-center rounded-full text-xl leading-none hover:bg-accent1/40 aria-disabled:cursor-not-allowed aria-disabled:opacity-35 aria-disabled:hover:bg-transparent";
  return (
    <div className="inline-flex items-center justify-self-start rounded-full border border-accent2 bg-white @[26rem]:justify-self-end">
      <button type="button" className={botao} aria-label={`Tirar um potinho de ${sabor}`} aria-disabled={valor === 0 || undefined} onClick={() => valor > 0 && aoMudar(valor - 1)}>
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={`Potinhos de ${sabor}`}
        className="h-11 w-9 bg-transparent text-center text-base font-semibold tabular-nums focus-visible:outline-2 focus-visible:outline-secundaria"
        // Digitou mais do que cabe: o campo mostra o que ficou valendo.
        value={texto !== null && (texto === "" || Number(texto) === valor) ? texto : String(valor)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const digitos = e.target.value.replace(/\D/g, "").slice(0, 2);
          setTexto(digitos);
          if (digitos !== "") aoMudar(Number(digitos));
        }}
        onBlur={() => setTexto(null)}
      />
      <button type="button" className={botao} aria-label={`Pôr um potinho de ${sabor}`} aria-disabled={cheio || undefined} onClick={() => !cheio && aoMudar(valor + 1)}>
        +
      </button>
    </div>
  );
}
