"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { CampoForm } from "@/components/admin/CampoForm";
import { formatarBRL, lerValorEmCentavos, valorParaCampo } from "@/lib/dinheiro";
import type { ProdutoAdminDTO } from "@/lib/produtos-admin";
import { LADO_FOTO, MAX_BYTES_FOTO, ROTULO_PERMITIDO_EM_KIT, ehFotoEnviada, montarNome } from "@/lib/produtos-regras";

type Aviso = { tipo: "ok" | "erro"; texto: string };

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

type Form = { sabor: string; peso: string; preco: string; descricao: string; ativo: boolean; permitidoEmKit: boolean };

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
        }
      : // Produto novo nasce fora do kit: a dona marca só os potes do tamanho padrão.
        { sabor: "", peso: "", preco: "", descricao: "", ativo: true, permitidoEmKit: false },
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
        setErros(Object.fromEntries(Object.entries(detalhes).map(([k, v]) => [k, Array.isArray(v) ? String(v[0]) : String(v)])));
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
