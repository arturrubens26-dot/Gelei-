import type { Metadata } from "next";
import { io } from "next/cache";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { AuthForm } from "@/components/AuthForm";
import { FotoDoPote } from "@/components/FotoDoPote";
import { FormEncomenda } from "@/components/lembrancinhas/FormEncomenda";
import { Ornamento } from "@/components/marca/Ornamento";
import { getUsuarioAtual } from "@/lib/auth/dal";
import { hojeNaLoja } from "@/lib/despesas";
import { formatarBRL } from "@/lib/dinheiro";
import { ANTECEDENCIA_MIN_DIAS, DIAS_CORTE_ANTES_DA_ENTREGA } from "@/lib/encomendas-regras";
import { listarEnderecos } from "@/lib/enderecos";
import { obterTaxaDeEntregaCentavos } from "@/lib/entrega";
import { obterLembrancinhas, type LembrancinhasDTO } from "@/lib/lembrancinhas";
import { telefoneDoCliente } from "@/lib/pedidos";

export const metadata: Metadata = {
  title: "Lembrancinhas",
  description: "Potinhos de geleia de 40 ml para a lembrancinha da sua festa: de 15 a 50 potinhos, nos sabores que você escolher.",
};

/**
 * Encomenda de lembrancinhas. A configuração e os sabores vêm do cache (`use cache`, tags
 * "lembrancinhas" e "produtos"): as regras são estáticas e visíveis para todo mundo. Só o formulário
 * depende da sessão e do relógio, e chega por streaming dentro do Suspense.
 */
export default async function PaginaLembrancinhas() {
  const config = await obterLembrancinhas();
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 sm:px-6 lg:pt-12">
      <Apresentacao config={config} />
      <div className="mt-10 pb-10 md:pb-16">
        {config.aceitandoSolicitacoes ? (
          <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-accent1/30" role="status" aria-label="Carregando o formulário" />}>
            <Formulario config={config} />
          </Suspense>
        ) : (
          <section aria-labelledby="titulo-fechado" className="cartao p-6 text-center">
            <h2 id="titulo-fechado" className="mb-2 font-titulos text-2xl font-bold">
              Encomendas fechadas no momento
            </h2>
            <p className="mx-auto mb-6 max-w-md text-primaria/85">{config.motivoFechado}</p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/products" className="btn-primario">
                Ver as geleias
              </Link>
              <Link href="/minhas-encomendas" className="btn-secundario">
                Minhas encomendas
              </Link>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function Apresentacao({ config }: { config: LembrancinhasDTO }) {
  const fotos = config.sabores.slice(0, 5);
  return (
    <header>
      <h1 className="text-center font-titulos text-4xl font-semibold text-primaria sm:text-5xl">Lembrancinhas para a sua festa</h1>
      <Ornamento className="mt-4" />
      <p className="mx-auto mt-4 max-w-prose text-center text-primaria/85">
        Potinhos de geleia de 40 ml para seus convidados levarem para casa. Você escolhe os sabores e a quantidade; a gente prepara tudo
        para o dia da festa.
      </p>

      {fotos.length > 0 && (
        <ul aria-label="Sabores disponíveis em mini" className="mt-6 flex flex-wrap justify-center gap-3">
          {fotos.map((s) => (
            <li key={s.productId} className="flex w-16 flex-col items-center gap-1 text-center text-xs font-semibold leading-tight sm:w-20">
              <span className="size-14 overflow-hidden rounded-full border-2 border-accent2/70 bg-[#f3ece3] sm:size-16">
                <FotoDoPote src={s.imagemUrl} alt="" lado={128} sizes="64px" className="size-full scale-[1.3] object-cover object-[50%_58%]" />
              </span>
              {s.sabor}
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-8 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
        <Fato rotulo="cada potinho" valor={config.precoPotinho > 0 ? formatarBRL(config.precoPotinho) : "—"} />
        <Fato rotulo="potinhos por encomenda" valor={`${config.minPotinhos} a ${config.maxPotinhos}`} />
        <Fato rotulo="de antecedência, no mínimo" valor={`${ANTECEDENCIA_MIN_DIAS} dias`} />
        <Fato rotulo="ou retirada na loja" valor="Entrega em Teresina" />
      </dl>

      <section aria-labelledby="titulo-como-funciona" className="mt-8 rounded-lg border border-accent2/60 bg-white/60 p-5 sm:p-6">
        <h2 id="titulo-como-funciona" className="text-2xl font-bold">
          Como funciona
        </h2>
        <ol className="mt-4 grid gap-4 text-sm leading-relaxed sm:grid-cols-2">
          <Passo numero={1} titulo="Você solicita">
            Escolha a data da festa, os sabores e como quer receber. Nada é cobrado agora.
          </Passo>
          <Passo numero={2} titulo="A Geleiô aprova">
            Conferimos a agenda e respondemos até o dia seguinte. Você acompanha tudo em Minhas encomendas.
          </Passo>
          <Passo numero={3} titulo="Você paga a entrada">
            50% do valor dos potinhos, em até 24 horas depois da aprovação, com PIX ou cartão. Aí a encomenda está confirmada.
          </Passo>
          <Passo numero={4} titulo="Preparo e entrega">
            O restante é pago até o dia da entrega ou da retirada. Dá para desistir com devolução integral até {DIAS_CORTE_ANTES_DA_ENTREGA}{" "}
            dias antes.
          </Passo>
        </ol>
      </section>
    </header>
  );
}

function Fato({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div className="flex flex-col-reverse justify-end rounded-md border border-accent2/60 bg-white/70 px-2 py-3">
      <dt className="text-xs text-primaria/80">{rotulo}</dt>
      <dd className="font-titulos text-lg font-semibold leading-tight">{valor}</dd>
    </div>
  );
}

function Passo({ numero, titulo, children }: { numero: number; titulo: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-secundaria font-bold text-secundaria" aria-hidden="true">
        {numero}
      </span>
      <span>
        <strong className="block font-semibold">{titulo}</strong>
        {children}
      </span>
    </li>
  );
}

async function Formulario({ config }: { config: LembrancinhasDTO }) {
  const usuario = await getUsuarioAtual();
  if (!usuario) {
    return (
      <section aria-labelledby="titulo-acesso">
        <h2 id="titulo-acesso" className="mb-2 text-center text-2xl font-bold">
          Entre ou crie sua conta para encomendar
        </h2>
        <p className="mx-auto mb-6 max-w-md text-center text-primaria/80">
          É com a conta que você acompanha a resposta da Geleiô, paga a entrada e vê a sua encomenda.
        </p>
        <AuthForm destino="/lembrancinhas" modoInicial="criar" />
      </section>
    );
  }

  // "Hoje" é o do servidor, no horário da loja (o `io()` antes de ler o relógio: ver o README).
  await io();
  const hoje = hojeNaLoja(new Date());
  const [enderecos, telefone, taxaEntregaCentavos] = await Promise.all([
    listarEnderecos(usuario.id),
    telefoneDoCliente(usuario.id),
    obterTaxaDeEntregaCentavos(),
  ]);

  // `key` por usuário: se outra pessoa entrar no mesmo navegador, o formulário recomeça do zero.
  return (
    <FormEncomenda
      key={usuario.id}
      config={config}
      hoje={hoje}
      nomeUsuario={usuario.nome}
      enderecos={enderecos}
      telefoneInicial={telefone}
      taxaEntregaCentavos={taxaEntregaCentavos}
    />
  );
}
