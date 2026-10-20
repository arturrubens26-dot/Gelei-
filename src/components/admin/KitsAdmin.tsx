"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { CampoForm } from "@/components/admin/CampoForm";
import { CaixaDoKit } from "@/components/kits/CaixaDoKit";
import { formatarBRL, lerValorEmCentavos, valorParaCampo } from "@/lib/dinheiro";
import type { KitAdminDTO } from "@/lib/kits-admin";
import { avisosDoKit, emCentavos, faixaDeEconomia } from "@/lib/kits-regras";

type Aviso = { tipo: "ok" | "erro"; texto: string };
/**
 * Sabor que a cliente pode escolher (à venda e "Pode entrar no Kit Presente"): as fotos da prévia e
 * os preços avulsos da conta de economia.
 */
export type SaborParaKit = { id: string; nome: string; imagemUrl: string; preco: number };

const brl = (centavos: number) => formatarBRL(centavos / 100);

function textoDaEconomia(economia: { minima: number; maxima: number } | null, potes: number): string {
  if (!economia) return "Nenhum sabor à venda pode entrar no kit agora.";
  if (economia.maxima <= 0) return `Não sai mais barato que ${potes} potes avulsos.`;
  if (economia.minima === economia.maxima) return `A cliente economiza ${formatarBRL(economia.maxima)} por caixa.`;
  return `A cliente economiza de ${formatarBRL(economia.minima)} a ${formatarBRL(economia.maxima)} por caixa, conforme os sabores.`;
}

/**
 * Seção "Kits" de /admin/products: preço, peso da caixa, nome, descrição e "Mostrar na loja", com a
 * prévia da caixa desenhada, a economia contra os potes avulsos (e o aviso quando o kit não sai mais
 * barato) e as caixas já vendidas. Sem criar nem excluir kit na v1.
 */
export function KitsAdmin({ kits, sabores }: { kits: KitAdminDTO[]; sabores: SaborParaKit[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function alternarVisibilidade(k: KitAdminDTO) {
    setOcupado(k.id);
    setAviso(null);
    try {
      const resposta = await fetch(`/api/admin/kits/${encodeURIComponent(k.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: !k.ativo }),
      });
      const json = await resposta.json().catch(() => null);
      setAviso(
        resposta.ok
          ? { tipo: "ok", texto: k.ativo ? `"${k.nome}" saiu da loja.` : `"${k.nome}" voltou para a loja.` }
          : { tipo: "erro", texto: json?.erro ?? "Não foi possível concluir. Tente de novo." },
      );
      router.refresh();
    } catch {
      setAviso({ tipo: "erro", texto: "Sem conexão. Tente de novo." });
    } finally {
      setOcupado(null);
    }
  }

  return (
    <section aria-labelledby="titulo-kits" className="flex flex-col gap-4">
      <div>
        <h2 id="titulo-kits" className="font-titulos text-2xl font-bold">
          Kits de presente
        </h2>
        <p className="mt-1 text-sm text-primaria/80">
          A cliente monta a caixa em “Monte seu kit” escolhendo os sabores. Preço e peso novos valem para os próximos pedidos.
        </p>
      </div>

      <p role="status" className={`min-h-5 text-sm font-medium ${aviso?.tipo === "erro" ? "text-secundaria" : "text-primaria"}`}>
        {aviso?.texto}
      </p>

      {kits.length === 0 ? (
        <p className="cartao p-8 text-center text-sm text-primaria/80">Nenhum kit cadastrado.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {kits.map((k) => (
            <li key={k.id} className={`cartao grid gap-5 p-4 sm:p-5 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] ${k.ativo ? "" : "border-dashed"}`}>
              <Previa kit={k} sabores={sabores} />
              {editando === k.id ? (
                <FormularioKit
                  kit={k}
                  sabores={sabores}
                  aoTerminar={(texto) => {
                    setEditando(null);
                    setAviso({ tipo: "ok", texto });
                    router.refresh();
                  }}
                  aoCancelar={() => setEditando(null)}
                />
              ) : (
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-titulos text-xl font-semibold">{k.nome}</h3>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                        k.ativo ? "bg-accent1/70 text-primaria" : "border border-dashed border-primaria/50 text-primaria/80"
                      }`}
                    >
                      {k.ativo ? "Na loja" : "Oculto da loja"}
                    </span>
                  </div>
                  <p className="text-sm text-primaria/85">{k.descricao}</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    <dt className="text-primaria/80">Preço da caixa</dt>
                    <dd className="font-bold tabular-nums">{formatarBRL(k.preco)}</dd>
                    <dt className="text-primaria/80">Potes na caixa</dt>
                    <dd className="tabular-nums">{k.potes}</dd>
                    <dt className="text-primaria/80">Peso da caixa vazia</dt>
                    <dd className="tabular-nums">{k.pesoCaixaGramas} g (entra no frete)</dd>
                    <dt className="text-primaria/80">Caixas vendidas</dt>
                    <dd className="tabular-nums">
                      {k.caixasVendidas} <span className="text-xs text-primaria/75">(pedidos pagos)</span>
                    </dd>
                  </dl>
                  <p className="text-sm">{textoDaEconomia(k.economia, k.potes)}</p>
                  {k.aviso && (
                    <p className="rounded-md border-2 border-accent2 bg-accent2/15 p-3 text-sm font-medium text-primaria">
                      <strong className="font-bold">Atenção: </strong>
                      {k.aviso}
                    </p>
                  )}
                  <div className="mt-auto flex flex-wrap gap-2">
                    <button type="button" className="btn-secundario" disabled={ocupado === k.id} onClick={() => setEditando(k.id)}>
                      Editar<span className="sr-only"> {k.nome}</span>
                    </button>
                    <button type="button" className="btn-secundario" disabled={ocupado === k.id} onClick={() => void alternarVisibilidade(k)}>
                      {k.ativo ? "Ocultar da loja" : "Mostrar na loja"}
                      <span className="sr-only"> {k.nome}</span>
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A caixa como a cliente vê, com sabores de exemplo (os primeiros à venda). */
function Previa({ kit, sabores }: { kit: KitAdminDTO; sabores: SaborParaKit[] }) {
  const vagas = Array.from({ length: kit.potes }, (_, i) => {
    const s = sabores[i];
    return s ? { productId: s.id, nome: s.nome, imagemUrl: s.imagemUrl, chave: s.id } : null;
  });
  return (
    <figure className="flex flex-col gap-2">
      <CaixaDoKit vagas={vagas} completa tamanho="pequena" className={kit.ativo ? "" : "opacity-70 grayscale"} />
      <figcaption className="text-xs text-primaria/75">Prévia da caixa na loja, com sabores de exemplo.</figcaption>
    </figure>
  );
}

type Form = { nome: string; descricao: string; preco: string; peso: string; ativo: boolean };

function FormularioKit({
  kit,
  sabores,
  aoTerminar,
  aoCancelar,
}: {
  kit: KitAdminDTO;
  sabores: SaborParaKit[];
  aoTerminar: (mensagem: string) => void;
  aoCancelar: () => void;
}) {
  const id = useId();
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const [form, setForm] = useState<Form>({
    nome: kit.nome,
    descricao: kit.descricao,
    preco: valorParaCampo(kit.preco),
    peso: String(kit.pesoCaixaGramas),
    ativo: kit.ativo,
  });
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Ao abrir, o foco vai para o título do formulário (o leitor de tela anuncia "Editar Kit Presente").
  useEffect(() => tituloRef.current?.focus(), []);

  const mudar = (campo: keyof Form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const valor = campo === "ativo" ? (e.target as HTMLInputElement).checked : e.target.value;
    setForm((f) => ({ ...f, [campo]: valor }));
  };

  function aria(campo: string, comDica = false) {
    const erro = erros[campo];
    const descritores = erro ? [`${id}-${campo}-erro`] : comDica ? [`${id}-${campo}-dica`] : [];
    return {
      id: `${id}-${campo}`,
      "aria-invalid": erro ? true : undefined,
      "aria-describedby": descritores.length ? descritores.join(" ") : undefined,
    };
  }

  // A conta da economia com o preço digitado (as mesmas regras do servidor), antes de salvar.
  const centavos = lerValorEmCentavos(form.preco);
  const precosAvulsos = sabores.map((s) => emCentavos(s.preco));
  const faixa = centavos && centavos > 0 ? faixaDeEconomia(centavos, kit.potes, precosAvulsos) : null;
  const avisoAoVivo = centavos && centavos > 0 ? avisosDoKit(centavos, kit.potes, precosAvulsos) : null;
  const dicaPreco =
    centavos === null || centavos < 1
      ? "Ex.: 40,00"
      : !faixa || faixa.maxima <= 0
        ? `Com ${brl(centavos)}, a caixa não sai mais barata que ${kit.potes} potes avulsos.`
        : faixa.minima === faixa.maxima
          ? `Com ${brl(centavos)}, a cliente economiza ${brl(faixa.maxima)}.`
          : `Com ${brl(centavos)}, a cliente economiza de ${brl(faixa.minima)} a ${brl(faixa.maxima)}.`;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const locais: Record<string, string> = {};
    if (form.nome.trim().length < 2) locais.nome = "Informe o nome do kit.";
    if (form.descricao.trim().length < 2) locais.descricao = "Escreva uma descrição curta.";
    if (centavos === null || centavos < 1) locais.precoCentavos = "Informe o preço (ex.: 40,00).";
    if (!/^\d{1,4}$/.test(form.peso.trim())) locais.pesoCaixaGramas = "Informe o peso em gramas inteiros (ex.: 150).";
    if (Object.keys(locais).length > 0) {
      setErros(locais);
      setErroGeral("Confira os campos destacados.");
      return;
    }

    setSalvando(true);
    setErroGeral(null);
    setErros({});
    try {
      const resposta = await fetch(`/api/admin/kits/${encodeURIComponent(kit.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: form.nome.trim(),
          descricao: form.descricao.trim(),
          precoCentavos: centavos,
          pesoCaixaGramas: Number(form.peso.trim()),
          ativo: form.ativo,
        }),
      });
      const json = await resposta.json().catch(() => null);
      if (!resposta.ok) {
        const detalhes: Record<string, unknown> = json?.detalhes && typeof json.detalhes === "object" ? json.detalhes : {};
        setErros(Object.fromEntries(Object.entries(detalhes).map(([k, v]) => [k, Array.isArray(v) ? String(v[0]) : String(v)])));
        setErroGeral(json?.erro ?? "Não foi possível salvar o kit.");
        return;
      }
      aoTerminar(`"${json.kit.nome}" foi atualizado${json.kit.ativo ? " e aparece na loja" : " (oculto da loja)"}.`);
    } catch {
      setErroGeral("Sem conexão. Verifique a internet e tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-titulo`} className="min-w-0">
      <h3 id={`${id}-titulo`} ref={tituloRef} tabIndex={-1} className="font-titulos text-xl font-semibold outline-none">
        Editar {kit.nome}
      </h3>
      {erroGeral && (
        <p role="alert" className="mt-2 text-sm font-semibold text-secundaria">
          {erroGeral}
        </p>
      )}
      <form onSubmit={salvar} noValidate className="mt-4 flex flex-col gap-4">
        <CampoForm id={`${id}-nome`} rotulo="Nome do kit" erro={erros.nome}>
          <input {...aria("nome")} className="campo" value={form.nome} onChange={mudar("nome")} maxLength={80} autoComplete="off" />
        </CampoForm>
        <CampoForm
          id={`${id}-descricao`}
          rotulo="Descrição"
          erro={erros.descricao}
          dica={`${form.descricao.length}/300 caracteres. Aparece em “Monte seu kit”.`}
        >
          <textarea {...aria("descricao", true)} className="campo min-h-20" value={form.descricao} onChange={mudar("descricao")} maxLength={300} rows={2} />
        </CampoForm>
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoForm id={`${id}-precoCentavos`} rotulo="Preço da caixa (R$)" erro={erros.precoCentavos} dica={dicaPreco}>
            <input
              {...aria("precoCentavos", true)}
              className="campo"
              inputMode="decimal"
              value={form.preco}
              onChange={mudar("preco")}
              maxLength={10}
              placeholder="40,00"
            />
          </CampoForm>
          <CampoForm
            id={`${id}-pesoCaixaGramas`}
            rotulo="Peso da caixa vazia (g)"
            erro={erros.pesoCaixaGramas}
            dica="Somado ao peso dos potes no frete."
          >
            <input
              {...aria("pesoCaixaGramas", true)}
              className="campo"
              inputMode="numeric"
              value={form.peso}
              onChange={mudar("peso")}
              maxLength={4}
              placeholder="150"
            />
          </CampoForm>
        </div>
        {avisoAoVivo && (
          <p className="rounded-md border-2 border-accent2 bg-accent2/15 p-3 text-sm font-medium text-primaria">
            <strong className="font-bold">Atenção: </strong>
            {avisoAoVivo} Dá para salvar assim mesmo.
          </p>
        )}
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={form.ativo} onChange={mudar("ativo")} className="size-4" />
          Mostrar na loja
        </label>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn-primario" disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar alterações"}
          </button>
          <button type="button" className="btn-secundario" onClick={aoCancelar} disabled={salvando}>
            Cancelar
          </button>
        </div>
      </form>
    </section>
  );
}
