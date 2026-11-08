"use client";

import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from "react";
import { CampoForm } from "@/components/admin/CampoForm";
import { prepararFoto } from "@/components/admin/prepararFoto";
import { ImagemDoAdicional } from "@/components/lembrancinhas/ImagemDoAdicional";
import {
  AVISO_PRECO_ZERO,
  LEGENDA_IMAGEM_ILUSTRATIVA,
  MAX_ORDEM_ADICIONAL,
  TAMANHO_MAX_DESCRICAO_ADICIONAL,
  TAMANHO_MAX_NOME_ADICIONAL,
  rotuloDoPrecoAdicional,
} from "@/lib/adicionais-regras";
import { lerValorEmCentavos, valorParaCampo } from "@/lib/dinheiro";
import type { AdicionalAdminDTO } from "@/lib/mimos-adicionais-admin";

/**
 * Itens adicionais dos mimos no painel (florzinhas, paninho na tampa, caixinha, colherzinha): nome, descrição
 * curta, preço POR POTINHO (R$ 0,00 = sem custo), ordem, ativo e a imagem (a dona envia; sem ela, a loja mostra uma
 * ilustração padrão com a legenda "Imagem ilustrativa"). Cada item salva sozinho (PATCH
 * /api/admin/lembrancinhas/adicionais/[id], multipart). Mudar o preço vale só para as solicitações novas: as
 * encomendas já feitas guardam o nome e o preço do dia.
 */
export function AdicionaisAdmin({ inicial }: { inicial: AdicionalAdminDTO[] }) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-titulo`} className="cartao flex flex-col gap-4 p-5">
      <div>
        <h2 id={`${id}-titulo`} className="text-2xl font-bold">
          Itens adicionais dos mimos
        </h2>
        <p className="mt-1 text-sm text-primaria/80">
          A cliente marca os itens que quiser na solicitação, e cada item vale para <strong className="font-semibold">todos os potinhos</strong> da encomenda
          (valor = preço por potinho × potinhos, somado ao total e dividido entre a entrada e o restante). {AVISO_PRECO_ZERO} Mudar o preço não altera as encomendas já feitas.
        </p>
      </div>
      <ul className="flex flex-col gap-4">
        {inicial.map((a) => (
          <li key={a.id}>
            <ItemAdicional inicial={a} />
          </li>
        ))}
      </ul>
      {inicial.length === 0 && <p className="text-sm">Nenhum item cadastrado.</p>}
    </section>
  );
}

type Campos = { nome: string; descricao: string; preco: string; ordem: string; ativo: boolean };

const camposDe = (a: AdicionalAdminDTO): Campos => ({
  nome: a.nome,
  descricao: a.descricao,
  preco: valorParaCampo(a.precoCentavos / 100),
  ordem: String(a.ordem),
  ativo: a.ativo,
});

/** Os erros do 400 vêm pelo nome do campo na API. */
const CAMPO_DA_API: Record<string, keyof Campos | "foto"> = { nome: "nome", descricao: "descricao", precoCentavos: "preco", ordem: "ordem", ativo: "ativo", foto: "foto" };

function ItemAdicional({ inicial }: { inicial: AdicionalAdminDTO }) {
  const uid = useId();
  const [item, setItem] = useState(inicial);
  const [campos, setCampos] = useState(() => camposDe(inicial));
  const [foto, setFoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [removerFoto, setRemoverFoto] = useState(false);
  const [erros, setErros] = useState<Partial<Record<keyof Campos | "foto", string>>>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [lendoFoto, setLendoFoto] = useState(false);

  useEffect(() => () => (foto ? URL.revokeObjectURL(foto.url) : undefined), [foto]);

  const campo = (k: string) => `${uid}-${k}`;
  const aria = (k: keyof Campos | "foto", comDica = true) => ({
    id: campo(k),
    "aria-invalid": erros[k] ? true : undefined,
    "aria-describedby": erros[k] ? `${campo(k)}-erro` : comDica ? `${campo(k)}-dica` : undefined,
  });
  const mudar = (k: Exclude<keyof Campos, "ativo">) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setCampos((c) => ({ ...c, [k]: e.target.value }));

  async function escolherFoto(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    setLendoFoto(true);
    setErros((atuais) => ({ ...atuais, foto: undefined }));
    try {
      const blob = await prepararFoto(arquivo);
      setFoto({ blob, url: URL.createObjectURL(blob) });
      setRemoverFoto(false);
    } catch {
      setErros((atuais) => ({ ...atuais, foto: "Não consegui ler essa imagem. Use uma imagem JPG ou PNG." }));
    } finally {
      setLendoFoto(false);
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (salvando) return;
    const novos: Partial<Record<keyof Campos, string>> = {};
    const preco = lerValorEmCentavos(campos.preco);
    if (campos.nome.trim().length < 2) novos.nome = "Informe o nome.";
    if (campos.descricao.trim().length < 2) novos.descricao = "Escreva uma descrição curta.";
    if (preco === null || preco < 0) novos.preco = "Informe o preço por potinho (0,00 = sem custo).";
    const ordem = /^\d+$/.test(campos.ordem.trim()) ? Number(campos.ordem.trim()) : NaN;
    if (!(ordem >= 0 && ordem <= MAX_ORDEM_ADICIONAL)) novos.ordem = `De 0 a ${MAX_ORDEM_ADICIONAL}.`;
    setErros(novos);
    setMensagem(null);
    setErroGeral(null);
    if (Object.keys(novos).length > 0) {
      setErroGeral("Confira os campos destacados.");
      return;
    }

    const dados = new FormData();
    dados.set("nome", campos.nome.trim());
    dados.set("descricao", campos.descricao.trim());
    dados.set("precoCentavos", String(preco));
    dados.set("ordem", String(ordem));
    dados.set("ativo", String(campos.ativo));
    if (foto) dados.set("foto", foto.blob, "imagem.jpg");
    else if (removerFoto) dados.set("removerFoto", "true");

    setSalvando(true);
    try {
      const resposta = await fetch(`/api/admin/lembrancinhas/adicionais/${encodeURIComponent(item.id)}`, { method: "PATCH", body: dados });
      const json = await resposta.json().catch(() => null);
      if (!resposta.ok) {
        if (resposta.status === 400 && json?.detalhes) {
          const daApi: Partial<Record<keyof Campos | "foto", string>> = {};
          for (const [k, v] of Object.entries(json.detalhes as Record<string, string[]>)) if (CAMPO_DA_API[k]) daApi[CAMPO_DA_API[k]] = v[0];
          setErros(daApi);
        }
        setErroGeral(json?.erro ?? "Não foi possível salvar.");
        return;
      }
      const salvo = json.adicional as AdicionalAdminDTO;
      setItem(salvo);
      setCampos(camposDe(salvo));
      setFoto(null);
      setRemoverFoto(false);
      setMensagem(`Pronto: "${salvo.nome}" salvo. Vale para as solicitações novas; as encomendas já feitas não mudam.`);
    } catch {
      setErroGeral("Sem conexão. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  // A imagem em exibição: a nova (ainda não salva), a enviada, ou a ilustração padrão.
  const imagemUrl = foto ? foto.url : removerFoto ? null : item.imagemUrl;
  const precoAtual = lerValorEmCentavos(campos.preco);

  return (
    <form onSubmit={salvar} noValidate className={`rounded-lg border p-4 ${item.ativo ? "border-accent2/60 bg-white/60" : "border-accent1/70 bg-white/40"}`}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex flex-col items-center gap-2">
          <ImagemDoAdicional adicional={{ id: item.id, nome: item.nome, imagemUrl }} className="size-28" lado={224} sizes="112px" />
          <input id={campo("foto")} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={escolherFoto} aria-describedby={`${campo("foto")}-dica`} />
          <label htmlFor={campo("foto")} className="btn-secundario cursor-pointer px-3 text-sm">
            {lendoFoto ? "Lendo…" : imagemUrl ? "Trocar imagem" : "Enviar imagem"}
          </label>
          {imagemUrl && (
            <button
              type="button"
              className="text-xs font-semibold text-secundaria underline underline-offset-2"
              onClick={() => {
                setFoto(null);
                setRemoverFoto(true);
              }}
            >
              Voltar à ilustração padrão
            </button>
          )}
          <p id={`${campo("foto")}-dica`} className={`max-w-32 text-center text-xs ${erros.foto ? "font-semibold text-secundaria" : "text-primaria/75"}`}>
            {erros.foto ?? `Aparece com a legenda "${LEGENDA_IMAGEM_ILUSTRATIVA}".`}
          </p>
        </div>

        <div className="grid min-w-0 flex-1 basis-72 gap-4 sm:grid-cols-2">
          <CampoForm id={campo("nome")} rotulo="Nome do item" erro={erros.nome}>
            <input className="campo" maxLength={TAMANHO_MAX_NOME_ADICIONAL} value={campos.nome} onChange={mudar("nome")} {...aria("nome", false)} />
          </CampoForm>
          <CampoForm
            id={campo("preco")}
            rotulo="Preço por potinho (R$)"
            erro={erros.preco}
            dica={
              precoAtual === 0
                ? "R$ 0,00 = sem custo para a cliente."
                : precoAtual !== null
                  ? `A cliente vê: ${rotuloDoPrecoAdicional(precoAtual)}.`
                  : "Ex.: 0,50. Use 0,00 para sem custo."
            }
          >
            <input className="campo" inputMode="decimal" maxLength={10} value={campos.preco} onChange={mudar("preco")} {...aria("preco")} />
          </CampoForm>
          <div className="sm:col-span-2">
            <CampoForm id={campo("descricao")} rotulo="Descrição curta" erro={erros.descricao}>
              <input
                className="campo"
                maxLength={TAMANHO_MAX_DESCRICAO_ADICIONAL}
                value={campos.descricao}
                onChange={mudar("descricao")}
                {...aria("descricao", false)}
              />
            </CampoForm>
          </div>
          <CampoForm id={campo("ordem")} rotulo="Ordem na lista" erro={erros.ordem} dica="Menor número aparece primeiro.">
            <input className="campo" inputMode="numeric" maxLength={4} value={campos.ordem} onChange={mudar("ordem")} {...aria("ordem")} />
          </CampoForm>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 self-end text-sm font-semibold">
            <input
              type="checkbox"
              className="size-5 shrink-0 accent-secundaria"
              checked={campos.ativo}
              onChange={(e) => setCampos((c) => ({ ...c, ativo: e.target.checked }))}
            />
            Aparece no formulário da cliente
          </label>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primario" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar este item"}
        </button>
        <span className="text-xs text-primaria/75">
          {item.encomendas > 0 ? `${item.encomendas} ${item.encomendas === 1 ? "encomenda já usa" : "encomendas já usam"} este item.` : "Nenhuma encomenda usa este item ainda."}
          {!item.ativo ? " Hoje ele está oculto." : ""}
        </span>
      </div>
      <p role="status" className="mt-2 min-h-5 text-sm font-medium">
        {mensagem}
      </p>
      <p role="alert" className="text-sm font-medium text-secundaria empty:hidden">
        {erroGeral}
      </p>
    </form>
  );
}
