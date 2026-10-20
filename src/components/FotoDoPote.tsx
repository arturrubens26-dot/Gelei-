import Image from "next/image";
import { ehFotoEnviada } from "@/lib/produtos-regras";

/**
 * Foto quadrada de um pote do catálogo (a mesma no cartão do produto, nas vagas da caixa do kit, no
 * carrinho e no painel). Centraliza a regra das fotos: a enviada pelo painel (`/fotos/<id>`) já chega
 * reduzida e vem de uma rota da própria loja, então não passa pelo otimizador; as de `public/`
 * (inclusive a ilustração .svg do Morango) passam.
 *
 * `lado` é o tamanho pedido ao otimizador (a foto é quadrada); `sizes` diz quanto ela ocupa na tela.
 * `alt` vazio quando o texto ao lado já diz o sabor (a foto é só ilustração).
 */
export function FotoDoPote({
  src,
  alt,
  lado,
  sizes,
  prioritario = false,
  className = "",
}: {
  src: string;
  alt: string;
  lado: number;
  sizes?: string;
  prioritario?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      width={lado}
      height={lado}
      sizes={sizes}
      priority={prioritario}
      unoptimized={ehFotoEnviada(src)}
      className={className}
    />
  );
}
