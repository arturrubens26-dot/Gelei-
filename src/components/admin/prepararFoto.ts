import { LADO_FOTO, MAX_BYTES_FOTO } from "@/lib/produtos-regras";

/**
 * Reduz a foto no navegador: recorte quadrado no centro, até 800×800, em JPEG (~100 KB). Usada nos formulários
 * do painel que enviam imagem (produtos e itens adicionais dos mimos); o servidor confere o tipo de novo.
 */
export async function prepararFoto(arquivo: File): Promise<Blob> {
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
