import { formatarTelefone, linkWhatsApp } from "@/lib/entrega-regras";

/**
 * Telefone da cliente que abre a conversa no WhatsApp (nova aba). Área de toque de 44 px; o nome
 * acessível diz o que acontece e de qual pedido é (vários na mesma tabela).
 */
export function LinkWhatsApp({ telefone, pedido, className = "" }: { telefone: string; pedido?: string; className?: string }) {
  return (
    <a
      href={linkWhatsApp(telefone)}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex min-h-11 items-center gap-1.5 font-semibold text-secundaria underline underline-offset-2 hover:text-primaria ${className}`}
    >
      <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4.5 19.5 5.6 16A8 8 0 1 1 8.4 18.6Z" />
        <path d="M9.2 8.6c.2-.5.6-.5.9-.5h.5l.9 2.1-.6.8a5 5 0 0 0 2.2 2.2l.8-.6 2.1.9v.5c0 .3 0 .7-.5.9-.6.3-1.8.4-3.6-.8a8 8 0 0 1-2.9-3c-.6-1.2-.2-2.1.2-2.5Z" />
      </svg>
      {formatarTelefone(telefone)}
      <span className="sr-only">
        : conversar no WhatsApp{pedido ? ` sobre o pedido ${pedido}` : ""} (abre em nova aba)
      </span>
    </a>
  );
}
