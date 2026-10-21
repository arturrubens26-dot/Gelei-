"use client";

import { TelaDeErro } from "@/components/TelaDeErro";

/** Erro numa página da loja: o cabeçalho e o rodapé da loja continuam na tela (o layout não cai). */
export default function ErroDaLoja(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="flex flex-1 flex-col">
      <TelaDeErro {...props} />
    </main>
  );
}
