"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cores, coresGrafico, hexParaRgb } from "@/design-system";
import { formatarBRL } from "@/lib/dinheiro";

export type PontoReceita = { mes: string; receita: number; pedidos: number; despesas: number };

const NOMES_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-10" → "out/26" */
export function rotuloMes(mes: string): string {
  const [ano, numero] = mes.split("-");
  return `${NOMES_MES[Number(numero) - 1]}/${ano.slice(2)}`;
}

// Marcas na cor da série (entradas = carmim, despesas = dourado escuro; par validado para
// daltonismo); textos, grade e eixos em tons discretos do texto da marca.
const COR_GRADE = hexParaRgb(cores.primaria, 0.14);
const COR_EIXO = hexParaRgb(cores.primaria, 0.8);

const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

/** Legenda das duas séries (sempre visível: cor nunca é a única pista). */
export function LegendaEntradasDespesas() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs font-medium">
      <li className="flex items-center gap-2">
        <Amostra cor={coresGrafico.entradas} /> Entradas (vendas pagas)
      </li>
      <li className="flex items-center gap-2">
        <Amostra cor={coresGrafico.despesas} /> Despesas
      </li>
    </ul>
  );
}

function Amostra({ cor }: { cor: string }) {
  return <span aria-hidden="true" className="inline-block size-3 rounded-sm" style={{ backgroundColor: cor }} />;
}

type PropsTooltip = { active?: boolean; payload?: { payload: PontoReceita }[] };

function TooltipReceita({ active, payload }: PropsTooltip) {
  const ponto = payload?.[0]?.payload;
  if (!active || !ponto) return null;
  return (
    <div className="rounded-lg border border-accent2 bg-destaque px-3 py-2 text-primaria shadow-md">
      <p className="text-xs font-semibold">
        {rotuloMes(ponto.mes)} · {ponto.pedidos} {ponto.pedidos === 1 ? "pedido" : "pedidos"}
      </p>
      <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-4 text-sm">
        <dt className="flex items-center gap-2"><Amostra cor={coresGrafico.entradas} /> Entradas</dt>
        <dd className="text-right font-bold tabular-nums">{formatarBRL(ponto.receita)}</dd>
        <dt className="flex items-center gap-2"><Amostra cor={coresGrafico.despesas} /> Despesas</dt>
        <dd className="text-right font-bold tabular-nums">{formatarBRL(ponto.despesas)}</dd>
        <dt className="pl-5">Saldo</dt>
        <dd className="text-right font-bold tabular-nums">{formatarBRL(ponto.receita - ponto.despesas)}</dd>
      </dl>
    </div>
  );
}

/** Colunas agrupadas por mês (entradas e despesas, um só eixo em R$); só o maior mês de vendas rotulado. */
export function GraficoReceita({ dados }: { dados: PontoReceita[] }) {
  const pontos = dados.map((d) => ({ ...d, rotulo: rotuloMes(d.mes) }));
  const maior = Math.max(0, ...pontos.map((p) => p.receita));
  const pico = maior > 0 ? pontos.find((p) => p.receita === maior) : undefined;
  const maiorDespesa = Math.max(0, ...pontos.map((p) => p.despesas));
  const picoDespesa = maiorDespesa > 0 ? pontos.find((p) => p.despesas === maiorDespesa) : undefined;
  const descricao =
    `Gráfico de colunas das entradas (vendas pagas) e das despesas por mês, nos últimos ${dados.length} meses.` +
    (pico ? ` Mês de maior entrada: ${pico.rotulo}, ${formatarBRL(pico.receita)}.` : "") +
    (picoDespesa ? ` Mês de maior despesa: ${picoDespesa.rotulo}, ${formatarBRL(picoDespesa.despesas)}.` : "") +
    " Use a visão em tabela para ver todos os valores.";

  return (
    <div className="flex flex-col gap-3">
      <LegendaEntradasDespesas />
      <div role="img" aria-label={descricao}>
        {/* accessibilityLayer desligado: ele cria um <svg> focável dentro do role="img" (conteúdo
            apresentacional), o que confunde leitores de tela. A tabela é a alternativa acessível. */}
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={pontos} margin={{ top: 28, right: 8, bottom: 0, left: 0 }} barGap={2} accessibilityLayer={false}>
            <CartesianGrid vertical={false} stroke={COR_GRADE} strokeWidth={1} />
            <XAxis
              dataKey="rotulo"
              tickLine={false}
              axisLine={{ stroke: COR_GRADE }}
              tick={{ fill: COR_EIXO, fontSize: 12 }}
              // Mostra todos os meses quando cabem; em telas estreitas esconde só os que se sobreporiam.
              interval="preserveStartEnd"
              minTickGap={6}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={52}
              tick={{ fill: COR_EIXO, fontSize: 12 }}
              tickFormatter={(v: number) => (v === 0 ? "0" : compacto.format(v))}
            />
            <Tooltip content={<TooltipReceita />} cursor={{ fill: hexParaRgb(cores.primaria, 0.06) }} />
            <Bar dataKey="receita" name="Entradas" fill={coresGrafico.entradas} radius={[4, 4, 0, 0]} maxBarSize={16} isAnimationActive={false}>
              <LabelList
                dataKey="receita"
                content={(props) => {
                  // Só o maior mês de vendas leva rótulo, e só se a coluna de despesas ao lado for mais
                  // baixa (senão o texto, mais largo que a coluna, cairia por cima dela). A checagem usa
                  // o mês de pico pelos dados: o `index` do Recharts pula as colunas de altura zero.
                  const { x, y, width, value } = props as {
                    x: number | string;
                    y: number | string;
                    width: number | string;
                    value?: number | string;
                  };
                  const valor = Number(value);
                  if (!pico || maior <= 0 || valor !== maior || pico.despesas > maior) return null;
                  // Pico no primeiro ou no último mês: alinha o texto para dentro, senão a borda o corta.
                  const primeiro = pico === pontos[0];
                  const ultimo = pico === pontos[pontos.length - 1];
                  const ancora = primeiro ? "start" : ultimo ? "end" : "middle";
                  const xTexto = primeiro ? Number(x) : ultimo ? Number(x) + Number(width) : Number(x) + Number(width) / 2;
                  return (
                    <text x={xTexto} y={Number(y) - 8} textAnchor={ancora} fontSize={12} fontWeight={700} fill={COR_EIXO}>
                      {formatarBRL(valor)}
                    </text>
                  );
                }}
              />
            </Bar>
            <Bar dataKey="despesas" name="Despesas" fill={coresGrafico.despesas} radius={[4, 4, 0, 0]} maxBarSize={16} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
