import { comTratamento } from "@/lib/api";
import { lerFotoDoAdicional } from "@/lib/mimos-adicionais";
import { lerFoto } from "@/lib/produtos-admin";

const PARA_SEMPRE = "public, max-age=31536000, immutable";

/**
 * GET /fotos/[id] — foto de produto ou de item adicional dos mimos, enviada pelo painel. Cada foto nova tem outro id, então a
 * resposta pode ficar em cache (navegador e CDN) para sempre.
 */
export const GET = comTratamento(
  "fotos GET",
  async (_request: Request, ctx: RouteContext<"/fotos/[id]">) => {
    const { id } = await ctx.params;
    // Primeiro as fotos de produto (o caminho de sempre); se não for uma, a de um item adicional dos mimos. Os ids
    // são UUIDs sorteados, então uma foto nunca existe nas duas tabelas.
    const foto = /^[a-f0-9]{32}$/.test(id) ? ((await lerFoto(id)) ?? (await lerFotoDoAdicional(id))) : null;
    if (!foto) {
      return new Response("Foto não encontrada.", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
    }
    return new Response(foto.dados, {
      headers: {
        "Content-Type": foto.tipo,
        "Content-Length": String(foto.dados.byteLength),
        "Cache-Control": PARA_SEMPRE,
        "CDN-Cache-Control": PARA_SEMPRE,
        // Só imagem: mesmo que alguém consiga gravar outra coisa, o navegador não a executa.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'",
      },
    });
  },
  { publico: true },
);
