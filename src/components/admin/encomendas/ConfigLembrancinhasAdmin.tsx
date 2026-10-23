"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { CampoForm } from "@/components/admin/CampoForm";
import { formatarBRL, lerValorEmCentavos, valorParaCampo } from "@/lib/dinheiro";
import type { ConfigLembrancinhasAdminDTO } from "@/lib/encomendas-admin";
import { formatarDataHora } from "@/lib/formatacao";

type Campos = { preco: string; pesoPotinho: string; pesoEmbalagem: string; percentual: string };

const camposDe = (c: ConfigLembrancinhasAdminDTO): Campos => ({
  preco: valorParaCampo(c.precoPotinhoCentavos / 100),
  pesoPotinho: String(c.pesoPotinhoGramas),
  pesoEmbalagem: String(c.pesoEmbalagemGramas),
  percentual: String(c.percentualRetido),
});

/** Os erros do 400 vêm pelo nome do campo na API. */
const CAMPO_DA_API: Record<string, keyof Campos> = {
  precoPotinhoCentavos: "preco",
  pesoPotinhoGramas: "pesoPotinho",
  pesoEmbalagemGramas: "pesoEmbalagem",
  percentualRetido: "percentual",
};

/**
 * Configuração das lembrancinhas no painel (GET/PATCH /api/admin/lembrancinhas): abrir ou fechar as
 * encomendas (bloqueado enquanto faltar CNPJ/CPF ou e-mail da loja, D13), preço do potinho, pesos para
 * o frete e quanto da entrada fica com a loja na desistência depois do corte. As encomendas já feitas
 * não mudam: preço e percentual ficam congelados nelas.
 */
export function ConfigLembrancinhasAdmin({ inicial }: { inicial: ConfigLembrancinhasAdminDTO }) {
  const id = useId();
  const [config, setConfig] = useState(inicial);
  const [campos, setCampos] = useState(() => camposDe(inicial));
  const [erros, setErros] = useState<Partial<Record<keyof Campos, string>>>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<"ativo" | "valores" | null>(null);

  const pendente = config.pendenciasLegais.length > 0;
  const saboresMini = config.sabores.filter((s) => s.ativo && s.disponivelEmMini);

  async function enviar(corpo: object, tipo: "ativo" | "valores"): Promise<ConfigLembrancinhasAdminDTO | null> {
    setSalvando(tipo);
    setMensagem(null);
    setErroGeral(null);
    try {
      const resposta = await fetch("/api/admin/lembrancinhas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const json = await resposta.json().catch(() => null);
      if (!resposta.ok) {
        if (resposta.status === 409 && Array.isArray(json?.detalhes?.pendenciasLegais)) {
          setConfig((c) => ({ ...c, pendenciasLegais: json.detalhes.pendenciasLegais }));
        }
        if (resposta.status === 400 && json?.detalhes) {
          const novos: Partial<Record<keyof Campos, string>> = {};
          for (const [k, v] of Object.entries(json.detalhes as Record<string, string[]>)) if (CAMPO_DA_API[k]) novos[CAMPO_DA_API[k]] = v[0];
          setErros(novos);
        }
        setErroGeral(json?.erro ?? "Não foi possível salvar.");
        return null;
      }
      setConfig(json.config);
      return json.config;
    } catch {
      setErroGeral("Sem conexão. Tente de novo.");
      return null;
    } finally {
      setSalvando(null);
    }
  }

  async function alternar() {
    if (salvando) return;
    if (!config.ativo && pendente) {
      setErroGeral(`Para abrir, falta preencher ${config.pendenciasLegais.join(" e ")} da loja.`);
      return;
    }
    const nova = await enviar({ ativo: !config.ativo }, "ativo");
    if (nova) setMensagem(nova.ativo ? "Pronto: as encomendas de lembrancinhas estão abertas." : "Pronto: as encomendas estão fechadas. As que já existem continuam.");
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const novos: Partial<Record<keyof Campos, string>> = {};
    const preco = lerValorEmCentavos(campos.preco);
    if (preco === null || preco < 1) novos.preco = "Informe o preço (ex.: 6,00).";
    const inteiro = (t: string) => (/^\d+$/.test(t.trim()) ? Number(t.trim()) : NaN);
    const pesoPotinho = inteiro(campos.pesoPotinho);
    const pesoEmbalagem = inteiro(campos.pesoEmbalagem);
    const percentual = inteiro(campos.percentual);
    if (!(pesoPotinho >= 1 && pesoPotinho <= 1000)) novos.pesoPotinho = "De 1 a 1000 g.";
    if (!(pesoEmbalagem >= 0 && pesoEmbalagem <= 5000)) novos.pesoEmbalagem = "De 0 a 5000 g.";
    if (!(percentual >= 0 && percentual <= 100)) novos.percentual = "De 0 a 100.";
    setErros(novos);
    if (Object.keys(novos).length > 0) return;
    const nova = await enviar(
      { ativo: config.ativo, precoPotinhoCentavos: preco, pesoPotinhoGramas: pesoPotinho, pesoEmbalagemGramas: pesoEmbalagem, percentualRetido: percentual },
      "valores",
    );
    if (nova) {
      setCampos(camposDe(nova));
      setMensagem("Pronto: valores salvos. Valem para as solicitações novas; as encomendas já feitas não mudam.");
    }
  }

  const campo = (k: keyof Campos) => `${id}-${k}`;
  const aria = (k: keyof Campos, comDica = true) => ({
    id: campo(k),
    "aria-invalid": erros[k] ? true : undefined,
    "aria-describedby": erros[k] ? `${campo(k)}-erro` : comDica ? `${campo(k)}-dica` : undefined,
  });
  const mudar = (k: keyof Campos) => (e: { target: { value: string } }) => setCampos((c) => ({ ...c, [k]: e.target.value }));

  return (
    <section aria-labelledby={`${id}-titulo`} className="cartao flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`${id}-titulo`} className="text-2xl font-bold">
            Lembrancinhas na loja:{" "}
            <span className={config.ativo ? "text-primaria" : "text-secundaria"}>{config.ativo ? "abertas" : "fechadas"}</span>
          </h2>
          <p className="mt-1 text-sm text-primaria/80">
            {config.ativo
              ? "A página /lembrancinhas aceita solicitações novas."
              : "A página mostra “encomendas fechadas”. As encomendas que já existem continuam (pagamentos e ações)."}
            {config.atualizadoEm ? ` Última mudança: ${formatarDataHora(config.atualizadoEm)}.` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={alternar}
          aria-disabled={salvando !== null || (!config.ativo && pendente) || undefined}
          aria-describedby={!config.ativo && pendente ? `${id}-pendencias` : undefined}
          className={`${config.ativo ? "btn-secundario" : "btn-primario"} aria-disabled:cursor-not-allowed aria-disabled:opacity-60`}
        >
          {salvando === "ativo" ? "Salvando…" : config.ativo ? "Fechar as encomendas" : "Abrir as encomendas"}
        </button>
      </div>

      {pendente && (
        <div id={`${id}-pendencias`} className="rounded-lg border-2 border-secundaria bg-white p-3 text-sm">
          <p className="font-bold text-secundaria">Ainda não dá para abrir</p>
          <p className="mt-1">
            Falta colocar no site {config.pendenciasLegais.join(" e ")} da loja (a lei do comércio eletrônico, Decreto 7.962/2013,
            exige). Mande esses dados para quem cuida do site; depois disso o botão “Abrir” passa a funcionar.
          </p>
        </div>
      )}
      {config.avisos.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-accent2 bg-accent2/10 p-3 text-sm">
          {config.avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}

      <p className="text-sm">
        <strong className="font-semibold">Sabores em mini:</strong>{" "}
        {saboresMini.length > 0 ? saboresMini.map((s) => s.sabor).join(", ") : "nenhum"}.{" "}
        <Link href="/admin/products" className="font-semibold text-secundaria underline underline-offset-2 hover:text-primaria">
          Mudar em Produtos
        </Link>
      </p>

      <details className="rounded-lg border border-accent2/60 bg-white/60 p-3 open:pb-4">
        <summary className="min-h-11 cursor-pointer content-center font-semibold">
          Preço, pesos e política ({formatarBRL(config.precoPotinhoCentavos / 100)} o potinho · {config.percentualRetido}% da entrada retido)
        </summary>
        <form onSubmit={salvar} noValidate className="mt-3 grid gap-4 sm:grid-cols-2">
          <CampoForm id={campo("preco")} rotulo="Preço do potinho (R$)" erro={erros.preco} dica="Preço único, para todos os sabores.">
            <input className="campo" inputMode="decimal" maxLength={10} value={campos.preco} onChange={mudar("preco")} {...aria("preco")} />
          </CampoForm>
          <CampoForm id={campo("percentual")} rotulo="Entrada retida na desistência (%)" erro={erros.percentual} dica="Depois do corte (3 dias antes). 100 = a entrada toda.">
            <input className="campo" inputMode="numeric" maxLength={3} value={campos.percentual} onChange={mudar("percentual")} {...aria("percentual")} />
          </CampoForm>
          <CampoForm id={campo("pesoPotinho")} rotulo="Peso do potinho cheio (g)" erro={erros.pesoPotinho} dica="Para o cálculo da entrega.">
            <input className="campo" inputMode="numeric" maxLength={4} value={campos.pesoPotinho} onChange={mudar("pesoPotinho")} {...aria("pesoPotinho")} />
          </CampoForm>
          <CampoForm id={campo("pesoEmbalagem")} rotulo="Peso da embalagem (g)" erro={erros.pesoEmbalagem} dica="Uma vez por encomenda.">
            <input className="campo" inputMode="numeric" maxLength={4} value={campos.pesoEmbalagem} onChange={mudar("pesoEmbalagem")} {...aria("pesoEmbalagem")} />
          </CampoForm>
          <p className="rounded-lg border border-accent2 bg-accent2/10 p-3 text-sm sm:col-span-2">{config.avisoJuridico}</p>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primario" disabled={salvando !== null}>
              {salvando === "valores" ? "Salvando…" : "Salvar valores"}
            </button>
          </div>
        </form>
      </details>

      <p role="status" className="min-h-5 text-sm font-medium">
        {mensagem}
      </p>
      <p role="alert" className="text-sm font-medium text-secundaria empty:hidden">
        {erroGeral}
      </p>
    </section>
  );
}
