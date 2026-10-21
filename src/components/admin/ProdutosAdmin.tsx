"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { CampoForm } from "@/components/admin/CampoForm";
import { FotoComVerso } from "@/components/FotoComVerso";
import { formatarBRL, lerValorEmCentavos, valorParaCampo } from "@/lib/dinheiro";
import type { ProdutoAdminDTO } from "@/lib/produtos-admin";
import {
  AVISO_ALEGACAO,
  LADO_FOTO,
  MAX_BYTES_FOTO,
  MAX_CARACTERES_DESTAQUE,
  MAX_CARACTERES_HARMONIZACAO,
  MAX_DESTAQUES,
  MAX_HARMONIZACOES,
  ROTULO_PERMITIDO_EM_KIT,
  TITULO_DESTAQUES,
  TITULO_HARMONIZACOES,
  avisosDeAlegacao,
  ehFotoEnviada,
  linhasDaLista,
  montarNome,
  produtoSchema,
} from "@/lib/produtos-regras";

type Aviso = { tipo: "ok" | "erro"; texto: string };

type CampoVerso = "harmonizacoes" | "destaques";

/** Limites e títulos de cada lista do verso (os mesmos do servidor, em produtos-regras.ts). */
const VERSO: Record<CampoVerso, { titulo: string; maxItens: number; maxCaracteres: number; exemplo: string }> = {
  harmonizacoes: {
    titulo: TITULO_HARMONIZACOES,
    maxItens: MAX_HARMONIZACOES,
    maxCaracteres: MAX_CARACTERES_HARMONIZACAO,
    exemplo: "Queijo coalho na chapa",
  },
  destaques: {
    titulo: TITULO_DESTAQUES,
    maxItens: MAX_DESTAQUES,
    maxCaracteres: MAX_CARACTERES_DESTAQUE,
    exemplo: "Doce e picante na mesma colherada",
  },
};

/** As linhas que valem (aparadas, sem as vazias), como o servidor lê o textarea. */
const itensDoTexto = (texto: string) => linhasDaLista(texto) as string[];

/** A mesma validação do servidor, para avisar antes de enviar ("Item 2: ..."). */
function erroDaLista(campo: CampoVerso, texto: string): string | undefined {
  const lido = produtoSchema.shape[campo].safeParse(texto);
  if (lido.success) return undefined;
  const problema = lido.error.issues[0];
  const item = typeof problema.path[0] === "number" ? `Item ${problema.path[0] + 1}: ` : "";
  return `${item}${problema.message}`;
}

/** Cadastro de produtos: lista com Editar / Ocultar / Excluir e o formulário de criar e editar. */
export function ProdutosAdmin({ produtos }: { produtos: ProdutoAdminDTO[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<ProdutoAdminDTO | "novo" | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const naLoja = produtos.filter((p) => p.ativo).length;
  const ocultos = produtos.length - naLoja;

  async function chamar(p: ProdutoAdminDTO, metodo: "PATCH" | "DELETE", sucesso: string, corpo?: unknown) {
    setOcupado(p.id);
    setAviso(null);
    try {
      const resposta = await fetch(`/api/admin/products/${encodeURIComponent(p.id)}`, {
        method: metodo,
        ...(corpo === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }),
      });
      const json = await resposta.json().catch(() => null);
      setAviso(resposta.ok ? { tipo: "ok", texto: sucesso } : { tipo: "erro", texto: json?.erro ?? "Não foi possível concluir. Tente de novo." });
      router.refresh();
    } catch {
      setAviso({ tipo: "erro", texto: "Sem conexão. Tente de novo." });
    } finally {
      setOcupado(null);
    }
  }

  function excluir(p: ProdutoAdminDTO) {
    if (!window.confirm(`Excluir "${p.nome}" de vez? Isso não pode ser desfeito.`)) return;
    void chamar(p, "DELETE", `"${p.nome}" foi excluído.`);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-titulos text-3xl font-bold">Produtos</h1>
          <p className="mt-1 text-sm text-primaria/80">
            {naLoja} {naLoja === 1 ? "produto na loja" : "produtos na loja"}
            {ocultos > 0 ? ` · ${ocultos} ${ocultos === 1 ? "oculto" : "ocultos"}` : ""}. O que você salvar aqui aparece na vitrine na hora.
          </p>
        </div>
        {!editando && (
          <button type="button" className="btn-primario" onClick={() => setEditando("novo")}>
            Novo produto
          </button>
        )}
      </header>

      <p
        role="status"
        className={`min-h-5 text-sm font-medium ${aviso?.tipo === "erro" ? "text-secundaria" : "text-primaria"}`}
      >
        {aviso?.texto}
      </p>

      {editando && (
        <FormularioProduto
          key={editando === "novo" ? "novo" : editando.id}
          produto={editando === "novo" ? null : editando}
          aoTerminar={(texto) => {
            setEditando(null);
            setAviso({ tipo: "ok", texto });
            router.refresh();
          }}
          aoCancelar={() => setEditando(null)}
        />
      )}

      {produtos.length === 0 ? (
        <p className="cartao p-8 text-center text-sm text-primaria/80">Nenhum produto cadastrado. Use “Novo produto”.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {produtos.map((p) => {
            const historico = [
              p.vendas > 0 ? `${p.vendas} ${p.vendas === 1 ? "venda" : "vendas"}` : null,
              p.producoes > 0 ? `${p.producoes} ${p.producoes === 1 ? "produção" : "produções"}` : null,
            ].filter(Boolean);
            const travado = ocupado === p.id;
            return (
              <li key={p.id} className={`cartao flex flex-col gap-4 p-4 ${p.ativo ? "" : "border-dashed"}`}>
                <div className="flex gap-4">
                  <Image
                    src={p.imagemUrl}
                    alt=""
                    width={96}
                    height={96}
                    unoptimized={ehFotoEnviada(p.imagemUrl)}
                    className={`size-24 shrink-0 rounded-lg border border-accent2/50 object-cover ${p.ativo ? "" : "grayscale"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-titulos text-lg font-semibold leading-snug">{p.sabor}</p>
                    <p className="text-sm text-primaria/80">{p.pesoGramas} g</p>
                    <p className="mt-1 text-xl font-bold tabular-nums">{formatarBRL(p.preco)}</p>
                    <p className="mt-1">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                          p.ativo ? "bg-accent1/70 text-primaria" : "border border-dashed border-primaria/50 text-primaria/80"
                        }`}
                      >
                        {p.ativo ? "Na loja" : "Oculto da loja"}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-primaria/80">{p.permitidoEmKit ? "Entra no Kit Presente" : "Fora do Kit Presente"}</p>
                    <p className="text-xs text-primaria/80">
                      {p.harmonizacoes.length + p.destaques.length > 0 ? "Foto com verso" : "Foto sem verso"}
                    </p>
                  </div>
                </div>
                <p className="line-clamp-2 text-sm text-primaria/85">{p.descricao}</p>
                <p className="text-xs text-primaria/75">{historico.length ? `Histórico: ${historico.join(" · ")}` : "Ainda sem vendas nem produções"}</p>
                <div className="mt-auto flex flex-wrap gap-2">
                  <button type="button" className="btn-secundario" onClick={() => setEditando(p)} disabled={travado}>
                    Editar
                  </button>
                  <button
                    type="button"
                    className="btn-secundario"
                    disabled={travado}
                    onClick={() =>
                      void chamar(p, "PATCH", p.ativo ? `"${p.nome}" saiu da loja.` : `"${p.nome}" voltou para a loja.`, { ativo: !p.ativo })
                    }
                  >
                    {p.ativo ? "Ocultar da loja" : "Mostrar na loja"}
                  </button>
                  {historico.length === 0 && (
                    <button type="button" className="btn-secundario text-secundaria" disabled={travado} onClick={() => excluir(p)}>
                      Excluir
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-primaria/75">
        Produto com vendas ou produções não pode ser excluído (os pedidos e as fichas apontam para ele): oculte-o da loja. Pedidos
        antigos mantêm o preço da época.
      </p>
    </div>
  );
}

type Form = {
  sabor: string;
  peso: string;
  preco: string;
  descricao: string;
  ativo: boolean;
  permitidoEmKit: boolean;
  /** Um item por linha, como o textarea (o servidor apara e descarta as linhas vazias). */
  harmonizacoes: string;
  destaques: string;
};

/** Reduz a foto no navegador: recorte quadrado no centro, até 800×800, em JPEG (~100 KB). */
async function prepararFoto(arquivo: File): Promise<Blob> {
  const imagem = await createImageBitmap(arquivo);
  const lado = Math.min(imagem.width, imagem.height);
  const saida = Math.min(LADO_FOTO, lado);
  const canvas = document.createElement("canvas");
  canvas.width = saida;
  canvas.height = saida;
  const contexto = canvas.getContext("2d");
  if (!contexto) throw new Error("sem canvas");
  contexto.drawImage(imagem, (imagem.width - lado) / 2, (imagem.height - lado) / 2, lado, lado, 0, 0, saida, saida);
  imagem.close();
  const blob = await new Promise<Blob | null>((pronto) => canvas.toBlob(pronto, "image/jpeg", 0.85));
  if (!blob || blob.size > MAX_BYTES_FOTO) throw new Error("foto inválida");
  return blob;
}

function FormularioProduto({
  produto,
  aoTerminar,
  aoCancelar,
}: {
  produto: ProdutoAdminDTO | null;
  aoTerminar: (mensagem: string) => void;
  aoCancelar: () => void;
}) {
  const id = useId();
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const [form, setForm] = useState<Form>(() =>
    produto
      ? {
          sabor: produto.sabor,
          peso: String(produto.pesoGramas),
          preco: valorParaCampo(produto.preco),
          descricao: produto.descricao,
          ativo: produto.ativo,
          permitidoEmKit: produto.permitidoEmKit,
          harmonizacoes: produto.harmonizacoes.join("\n"),
          destaques: produto.destaques.join("\n"),
        }
      : // Produto novo nasce fora do kit: a dona marca só os potes do tamanho padrão.
        { sabor: "", peso: "", preco: "", descricao: "", ativo: true, permitidoEmKit: false, harmonizacoes: "", destaques: "" },
  );
  const [foto, setFoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [lendoFoto, setLendoFoto] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Ao abrir, o foco vai para o título do formulário (o leitor de tela anuncia "Novo produto").
  useEffect(() => tituloRef.current?.focus(), []);
  useEffect(() => () => (foto ? URL.revokeObjectURL(foto.url) : undefined), [foto]);

  const mudar = (campo: keyof Form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const valor = campo === "ativo" || campo === "permitidoEmKit" ? (e.target as HTMLInputElement).checked : e.target.value;
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

  async function escolherFoto(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setLendoFoto(true);
    setErros((atuais) => {
      const resto = { ...atuais };
      delete resto.foto;
      return resto;
    });
    try {
      const blob = await prepararFoto(arquivo);
      setFoto({ blob, url: URL.createObjectURL(blob) });
    } catch {
      setErros((atuais) => ({ ...atuais, foto: "Não consegui ler essa foto. Use uma foto JPG ou PNG." }));
    } finally {
      setLendoFoto(false);
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const centavos = lerValorEmCentavos(form.preco);
    const locais: Record<string, string> = {};
    if (form.sabor.trim().length < 2) locais.sabor = "Informe o sabor.";
    if (!/^\d{1,4}$/.test(form.peso.trim()) || Number(form.peso) < 1) locais.pesoGramas = "Informe o peso em gramas (ex.: 112).";
    if (centavos === null || centavos < 1) locais.precoCentavos = "Informe o preço (ex.: 15,00).";
    if (form.descricao.trim().length < 2) locais.descricao = "Escreva uma descrição curta.";
    if (!produto && !foto) locais.foto = "Escolha uma foto do produto.";
    for (const campo of ["harmonizacoes", "destaques"] as const) {
      const erro = erroDaLista(campo, form[campo]);
      if (erro) locais[campo] = erro;
    }
    if (Object.keys(locais).length > 0) {
      setErros(locais);
      setErroGeral("Confira os campos destacados.");
      return;
    }

    const dados = new FormData();
    dados.set("sabor", form.sabor.trim());
    dados.set("pesoGramas", form.peso.trim());
    dados.set("precoCentavos", String(centavos));
    dados.set("descricao", form.descricao.trim());
    dados.set("ativo", String(form.ativo));
    dados.set("permitidoEmKit", String(form.permitidoEmKit));
    // Sempre enviados: o campo vazio esvazia a lista (a foto do produto deixa de virar).
    dados.set("harmonizacoes", form.harmonizacoes);
    dados.set("destaques", form.destaques);
    if (foto) dados.set("foto", foto.blob, "foto.jpg");

    setSalvando(true);
    setErroGeral(null);
    setErros({});
    try {
      const resposta = await fetch(produto ? `/api/admin/products/${encodeURIComponent(produto.id)}` : "/api/admin/products", {
        method: produto ? "PATCH" : "POST",
        body: dados,
      });
      const json = await resposta.json().catch(() => null);
      if (!resposta.ok) {
        const detalhes: Record<string, unknown> = json?.detalhes && typeof json.detalhes === "object" ? json.detalhes : {};
        const porCampo: Record<string, string> = {};
        for (const [k, v] of Object.entries(detalhes)) {
          const texto = Array.isArray(v) ? String(v[0]) : String(v);
          // Erro de um item do verso ("harmonizacoes.2") vai para o campo da lista, dizendo qual item.
          const item = /^(harmonizacoes|destaques)\.(\d+)$/.exec(k);
          if (item) porCampo[item[1]] ??= `Item ${Number(item[2]) + 1}: ${texto}`;
          else porCampo[k] ??= texto;
        }
        setErros(porCampo);
        setErroGeral(json?.erro ?? "Não foi possível salvar o produto.");
        return;
      }
      const nome = json.produto.nome as string;
      aoTerminar(
        produto
          ? `"${nome}" foi atualizado.`
          : `"${nome}" foi criado${json.produto.ativo ? " e já aparece na loja" : " (oculto da loja)"}.`,
      );
    } catch {
      setErroGeral("Sem conexão. Verifique a internet e tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  const fotoNaTela = foto?.url ?? produto?.imagemUrl ?? null;
  const pesoNumero = Number(form.peso);

  return (
    <section aria-labelledby={`${id}-titulo`} className="cartao p-5">
      <h2 id={`${id}-titulo`} ref={tituloRef} tabIndex={-1} className="text-2xl font-bold outline-none">
        {produto ? `Editar ${produto.nome}` : "Novo produto"}
      </h2>
      {erroGeral && (
        <p role="alert" className="mt-2 text-sm font-semibold text-secundaria">
          {erroGeral}
        </p>
      )}

      <form onSubmit={salvar} noValidate className="mt-4 grid gap-6 md:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <div className="flex aspect-square w-full max-w-48 items-center justify-center overflow-hidden rounded-lg border border-accent2/60 bg-[#f3ece3]">
            {fotoNaTela ? (
              // eslint-disable-next-line @next/next/no-img-element -- prévia local (blob:) ou a foto atual
              <img src={fotoNaTela} alt="Prévia da foto do produto" className="size-full object-cover" />
            ) : (
              <span className="px-3 text-center text-xs text-primaria/70">Sem foto ainda</span>
            )}
          </div>
          <CampoForm
            id={`${id}-foto`}
            rotulo={produto ? "Trocar a foto" : "Foto"}
            erro={erros.foto}
            dica={lendoFoto ? "Preparando a foto…" : "Ela é recortada em quadrado, pelo centro."}
          >
            {/* O texto nativo ("Nenhum arquivo escolhido") não cabe na coluna: o campo fica oculto e
                este rótulo vira o botão; o contorno de foco do campo aparece nele (peer). */}
            <input
              {...aria("foto", true)}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/*"
              onChange={escolherFoto}
              className="peer sr-only"
            />
            <label
              htmlFor={`${id}-foto`}
              className="btn-secundario inline-flex cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-secundaria"
            >
              {fotoNaTela ? "Escolher outra foto" : "Escolher foto"}
            </label>
          </CampoForm>
        </div>

        <div className="flex flex-col gap-4">
          <CampoForm
            id={`${id}-sabor`}
            rotulo="Sabor"
            erro={erros.sabor}
            dica={form.sabor.trim() && pesoNumero > 0 ? `Na loja: "${montarNome(form.sabor, pesoNumero)}"` : "Ex.: Morango"}
          >
            <input {...aria("sabor", true)} className="campo" value={form.sabor} onChange={mudar("sabor")} maxLength={60} autoComplete="off" />
          </CampoForm>

          <div className="grid gap-4 sm:grid-cols-2">
            <CampoForm id={`${id}-pesoGramas`} rotulo="Peso (gramas)" erro={erros.pesoGramas}>
              <input
                {...aria("pesoGramas")}
                className="campo"
                inputMode="numeric"
                value={form.peso}
                onChange={mudar("peso")}
                maxLength={4}
                placeholder="112"
              />
            </CampoForm>
            <CampoForm id={`${id}-precoCentavos`} rotulo="Preço (R$)" erro={erros.precoCentavos}>
              <input
                {...aria("precoCentavos")}
                className="campo"
                inputMode="decimal"
                value={form.preco}
                onChange={mudar("preco")}
                maxLength={10}
                placeholder="15,00"
              />
            </CampoForm>
          </div>

          <CampoForm
            id={`${id}-descricao`}
            rotulo="Descrição"
            erro={erros.descricao}
            dica={`${form.descricao.length}/300 caracteres. Aparece no cartão do produto.`}
          >
            <textarea
              {...aria("descricao", true)}
              className="campo min-h-24"
              value={form.descricao}
              onChange={mudar("descricao")}
              maxLength={300}
              rows={3}
            />
          </CampoForm>

          <fieldset className="flex flex-col gap-4 rounded-lg border border-accent2/60 p-4">
            <legend className="px-1 text-sm font-semibold">Verso da foto</legend>
            <p className="-mt-1 text-xs text-primaria/80">
              Na loja, a foto vira e mostra estas listas. Fale de sabor, textura, cor e uso. Deixe as duas vazias para a foto não virar.
            </p>
            {(["harmonizacoes", "destaques"] as const).map((campo) => (
              <CampoDoVerso
                key={campo}
                id={`${id}-${campo}`}
                campo={campo}
                valor={form[campo]}
                erro={erros[campo]}
                aoMudar={(valor) => setForm((f) => ({ ...f, [campo]: valor }))}
              />
            ))}
            <PreviaDoVerso sabor={form.sabor.trim()} foto={fotoNaTela} harmonizacoes={form.harmonizacoes} destaques={form.destaques} />
          </fieldset>

          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={form.ativo} onChange={mudar("ativo")} className="size-4" />
            Mostrar na loja
          </label>

          <div>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={form.permitidoEmKit}
                onChange={mudar("permitidoEmKit")}
                aria-describedby={`${id}-permitidoEmKit-dica`}
                className="size-4"
              />
              {ROTULO_PERMITIDO_EM_KIT}
            </label>
            <p id={`${id}-permitidoEmKit-dica`} className="mt-1 pl-6 text-xs text-primaria/75">
              Potes do tamanho padrão; um pote maior ou mais caro sairia com desconto grande demais.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn-primario" disabled={salvando || lendoFoto}>
              {salvando ? "Salvando…" : produto ? "Salvar alterações" : "Criar produto"}
            </button>
            <button type="button" className="btn-secundario" onClick={aoCancelar} disabled={salvando}>
              Cancelar
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

/** Textarea de uma lista do verso, com a contagem de linhas e caracteres e o aviso de alegação de saúde. */
function CampoDoVerso({
  id,
  campo,
  valor,
  erro,
  aoMudar,
}: {
  id: string;
  campo: CampoVerso;
  valor: string;
  erro?: string;
  aoMudar: (valor: string) => void;
}) {
  const cfg = VERSO[campo];
  const itens = itensDoTexto(valor);
  const maior = itens.reduce((m, item) => Math.max(m, item.length), 0);
  const passou = itens.length > cfg.maxItens || maior > cfg.maxCaracteres;
  // Não bloqueia o salvar: só lembra de evitar promessa de saúde (ANVISA) e composição não confirmada.
  const termos = avisosDeAlegacao(valor);
  const descritores = [erro ? `${id}-erro` : `${id}-dica`, termos.length > 0 ? `${id}-aviso` : null].filter(Boolean).join(" ");

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {cfg.titulo} (uma por linha)
      </label>
      <textarea
        id={id}
        className="campo min-h-24"
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        rows={cfg.maxItens}
        placeholder={`Ex.: ${cfg.exemplo}`}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descritores}
      />
      {erro ? (
        <p id={`${id}-erro`} className="mt-1 text-xs font-semibold text-secundaria">
          {erro}
        </p>
      ) : (
        <p id={`${id}-dica`} className={`mt-1 text-xs ${passou ? "font-semibold text-secundaria" : "text-primaria/75"}`}>
          {itens.length}/{cfg.maxItens} {cfg.maxItens === 1 ? "linha" : "linhas"} · a maior tem {maior}/{cfg.maxCaracteres} caracteres
        </p>
      )}
      {termos.length > 0 && (
        <p id={`${id}-aviso`} className="mt-2 rounded-md border border-accent2 bg-accent2/15 px-3 py-2 text-xs font-medium text-primaria">
          {AVISO_ALEGACAO} Repare em: {termos.map((t) => `“${t}”`).join(", ")}.
        </p>
      )}
    </div>
  );
}

/** Como o cartão vai ficar na loja: a mesma foto que vira (clique para ver o verso). */
function PreviaDoVerso({ sabor, foto, harmonizacoes, destaques }: { sabor: string; foto: string | null; harmonizacoes: string; destaques: string }) {
  // Sem repetidos (o servidor recusa) e no máximo o limite de cada lista: é só uma prévia.
  const lista = (texto: string, max: number) => [...new Set(itensDoTexto(texto))].slice(0, max);
  const h = lista(harmonizacoes, MAX_HARMONIZACOES);
  const d = lista(destaques, MAX_DESTAQUES);
  if (h.length === 0 && d.length === 0) return null;
  return (
    <div>
      <p className="text-sm font-semibold">Prévia na loja</p>
      <p className="mb-2 text-xs text-primaria/75">Clique na foto para ver o verso, como a cliente verá.</p>
      <div className="cartao w-full max-w-80 p-2.5">
        <FotoComVerso sabor={sabor || "produto novo"} harmonizacoes={h} destaques={d}>
          {foto ? (
            // eslint-disable-next-line @next/next/no-img-element -- prévia local (blob:) ou a foto atual
            <img src={foto} alt="" className="aspect-square w-full object-cover" />
          ) : (
            <div className="aspect-square w-full" />
          )}
        </FotoComVerso>
      </div>
    </div>
  );
}