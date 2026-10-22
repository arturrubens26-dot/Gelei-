import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CLASSE_CARTAO_DE_VIDRO, CartaoCarregando, PainelDeAcesso } from "@/components/login/PainelDeAcesso";
import { FormEsqueciSenha } from "@/components/senha/FormEsqueciSenha";
import { modoRedefinicaoSenha } from "@/lib/auth/redefinicao";
import { destinoSeguro } from "@/lib/auth/destino";
import { dadosLoja } from "@/lib/dados-loja";

export const metadata: Metadata = { title: "Esqueci minha senha" };

type Props = PageProps<"/esqueci-senha">;

/**
 * "Esqueci minha senha", sempre com um caminho: com e-mail configurado, o formulário que manda o link;
 * sem ele (produção, hoje), a orientação de pedir o link à loja pelo Instagram.
 */
export default function PaginaEsqueciSenha({ searchParams }: Props) {
  return (
    <PainelDeAcesso>
      {/* searchParams é dado da requisição; o modo (com ou sem e-mail) é lido na hora, não no build. */}
      <Suspense fallback={<CartaoCarregando altura="h-[30rem]" />}>
        <Conteudo searchParams={searchParams} />
      </Suspense>
    </PainelDeAcesso>
  );
}

async function Conteudo({ searchParams }: Pick<Props, "searchParams">) {
  const { next } = await searchParams;
  const destino = destinoSeguro(next);
  const voltar = destino === "/" ? "/login" : `/login?next=${encodeURIComponent(destino)}`;
  if (modoRedefinicaoSenha() === "email") return <FormEsqueciSenha linkDoLogin={voltar} />;
  return <PeloInstagram linkDoLogin={voltar} />;
}

function PeloInstagram({ linkDoLogin }: { linkDoLogin: string }) {
  const usuario = dadosLoja.instagram.usuario;
  return (
    <div className={CLASSE_CARTAO_DE_VIDRO}>
      <h1 className="font-titulos text-3xl leading-tight font-bold text-balance text-primaria sm:text-[2.15rem]">Esqueci minha senha</h1>
      <div className="mt-3 flex flex-col gap-3 text-primaria/90">
        <p>
          Chame a Geleiô no Instagram <strong className="font-semibold">@{usuario}</strong> e diga o e-mail da sua conta.
        </p>
        <p>
          Para sua segurança, vamos confirmar seu nome e algo do seu último pedido e mandar um link para você criar uma senha nova. O
          link vale por 1 hora e funciona uma vez só.
        </p>
        <p className="font-semibold">Nunca pedimos sua senha.</p>
      </div>
      <a
        href={`https://ig.me/m/${usuario}`}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-primario mt-6 min-h-12 w-full rounded-xl bg-primaria text-base hover:bg-secundaria"
      >
        Chamar no Instagram
        <span className="sr-only"> (abre em nova aba)</span>
      </a>
      <Link
        href={linkDoLogin}
        className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-primaria/45 bg-white/70 px-5 text-sm font-semibold text-primaria transition-colors hover:border-primaria/70 hover:bg-white"
      >
        Voltar para o login
      </Link>
    </div>
  );
}
