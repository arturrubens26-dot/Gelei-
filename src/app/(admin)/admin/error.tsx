"use client";

import { TelaDeErro } from "@/components/TelaDeErro";

/** Erro numa tela do painel: o menu lateral continua, e o conteúdo vira o aviso com "Tentar de novo". */
export default function ErroDoPainel(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <TelaDeErro {...props} onde="painel" />;
}
