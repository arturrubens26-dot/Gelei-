"use client";

import { useId, useState, type FormEvent } from "react";
import { CampoForm } from "@/components/admin/CampoForm";
import { formatarBRL, lerValorEmCentavos, valorParaCampo } from "@/lib/dinheiro";
import { CIDADE_ATENDIDA, MAX_TAXA_ENTREGA_CENTAVOS, taxaDeEntregaValida } from "@/lib/entrega-regras";
import { formatarDataHora } from "@/lib/formatacao";

type Config = { taxaEntregaCentavos: number; atualizadoEm: string | null };

/**
 * Taxa fixa da entrega em Teresina (PATCH /api/admin/entrega). Vale para os pedidos novos: o checkout
 * passa a mostrar o valor novo na hora, e os pedidos já feitos guardam o frete da época.
 */
export function TaxaDeEntregaAdmin({ inicial }: { inicial: Config }) {
  const id = useId();
  const [config, setConfig] = useState(inicial);
  const [valor, setValor] = useState(() => valorParaCampo(inicial.taxaEntregaCentavos / 100));
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setAviso(null);
    const centavos = lerValorEmCentavos(valor);
    if (centavos === null || !taxaDeEntregaValida(centavos)) {
      setErro(`Informe um valor de R$ 0,00 a ${formatarBRL(MAX_TAXA_ENTREGA_CENTAVOS / 100)} (ex.: 15,00).`);
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const resposta = await fetch("/api/admin/entrega", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxaEntregaCentavos: centavos }),
      });
      const json = await resposta.json().catch(() => null);
      if (!resposta.ok) {
        setErro(json?.detalhes?.taxaEntregaCentavos?.[0] ?? json?.erro ?? "Não foi possível salvar a taxa.");
        return;
      }
      setConfig(json);
      setValor(valorParaCampo(json.taxaEntregaCentavos / 100));
      setAviso(
        json.taxaEntregaCentavos === 0
          ? "Pronto: a entrega em Teresina agora é grátis para os pedidos novos."
          : `Pronto: a entrega em Teresina agora custa ${formatarBRL(json.taxaEntregaCentavos / 100)} nos pedidos novos.`,
      );
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  const campo = `${id}-taxa`;
  return (
    <section aria-labelledby={`${id}-titulo`} className="cartao p-5">
      <h2 id={`${id}-titulo`} className="text-2xl font-bold">
        Entrega
      </h2>
      <p className="mt-1 text-sm text-primaria/80">
        Só em {CIDADE_ATENDIDA} (CEP que começa com 640), com taxa fixa; a retirada na loja é sempre grátis.
        {config.atualizadoEm ? ` Última mudança: ${formatarDataHora(config.atualizadoEm)}.` : ""}
      </p>
      <form onSubmit={salvar} noValidate className="mt-4 flex flex-wrap items-start gap-3">
        <div className="w-44">
          <CampoForm id={campo} rotulo="Taxa em Teresina (R$)" erro={erro ?? undefined} dica="0,00 = entrega grátis.">
            <input
              id={campo}
              className="campo"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              maxLength={10}
              aria-invalid={erro ? true : undefined}
              aria-describedby={erro ? `${campo}-erro` : `${campo}-dica`}
            />
          </CampoForm>
        </div>
        <button type="submit" className="btn-primario mt-6" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar taxa"}
        </button>
      </form>
      <p role="status" className="mt-2 min-h-5 text-sm font-medium">
        {aviso}
      </p>
    </section>
  );
}
