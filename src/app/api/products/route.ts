import { comTratamento } from "@/lib/api";
import { listarProdutos } from "@/lib/produtos";

/** GET /api/products — lista todos os produtos (público e cacheável: não leva `no-store`). */
export const GET = comTratamento(
  "api/products",
  async () => {
    return Response.json({ produtos: await listarProdutos() });
  },
  { publico: true },
);
