"use client";

import Link from "next/link";
import { useEffect } from "react";
import { TelaDeAviso } from "@/components/TelaDeAviso";
import { dadosLoja } from "@/lib/dados-loja";

type Props = {
  error: Error & { digest?: string };
  /** Busca e desenha o trecho de novo (o `retry` do error.tsx do Next 16). */
  retry: () => void;
  /** "loja" para a cliente; "painel" para a dona, com o caminho de volta ao Dashboard. */
  onde?: "loja" | "painel";
};

/**
 * Conteúdo das telas de erro (error.tsx). Em produção o Next troca a mensagem do erro do servidor
 * por um texto genérico: mostramos só o `digest`, o código que acha o erro nos registros da Netlify.
 */
export function TelaDeErro({ error, retry, onde = "loja" }: Props) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const codigo = error.digest ? (
    <p>
      Código do erro: <span className="font-semibold tabular-nums">{error.digest}</span>
    </p>
  ) : null;

  if (onde === "painel") {
    return (
      <TelaDeAviso
        titulo="Esta tela do painel não abriu"
        pote="destampado"
        acoes={
          <>
            <button type="button" className="btn-primario px-8" onClick={() => retry()}>
              Tentar de novo
            </button>
            <Link href="/admin/dashboard" className="btn-secundario px-8">
              Ir para o Dashboard
            </Link>
          </>
        }
        rodape={codigo}
      >
        <p>Costuma ser uma falha passageira na conexão com o banco de dados. Tente de novo em alguns segundos.</p>
        <p>Se continuar, procure o código abaixo nos registros (logs) da Netlify.</p>
      </TelaDeAviso>
    );
  }

  return (
    <TelaDeAviso
      titulo="Algo deu errado por aqui"
      pote="destampado"
      acoes={
        <>
          <button type="button" className="btn-primario px-8" onClick={() => retry()}>
            Tentar de novo
          </button>
          <Link href="/" className="btn-secundario px-8">
            Voltar ao início
          </Link>
        </>
      }
      rodape={
        <>
          <p>
            Se continuar, fale com a gente no Instagram{" "}
            <a
              href={dadosLoja.instagram.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center font-semibold text-secundaria underline underline-offset-2 hover:text-primaria"
            >
              @{dadosLoja.instagram.usuario}
              <span className="sr-only"> (abre em nova aba)</span>
            </a>
            .
          </p>
          {codigo}
        </>
      }
    >
      <p>Não conseguimos abrir esta página agora. Costuma ser passageiro: tente de novo em instantes.</p>
      <p>Seu carrinho continua guardado neste navegador.</p>
    </TelaDeAviso>
  );
}
