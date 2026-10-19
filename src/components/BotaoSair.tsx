"use client";

import { useTransition } from "react";
import { acoesCarrinho } from "@/lib/carrinho/store";

export function BotaoSair({ className }: { className?: string }) {
  const [pendente, iniciar] = useTransition();

  return (
    <button
      type="button"
      className={className ?? "inline-flex min-h-11 items-center text-sm font-medium text-secundaria underline underline-offset-2"}
      disabled={pendente}
      onClick={() =>
        iniciar(async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          // Dados de localização (CEP, endereço sugerido) não ficam para a próxima pessoa do computador.
          acoesCarrinho.limpar();
          // Recarga completa de propósito: com Cache Components o Next mantém páginas visitadas
          // escondidas na memória, e elas guardariam dados (nomes, e-mails, rascunhos) do usuário que saiu.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- recarga completa de propósito (veja acima)
          window.location.assign(`${window.location.origin}/`);
        })
      }
    >
      {pendente ? "Saindo…" : "Sair"}
    </button>
  );
}
