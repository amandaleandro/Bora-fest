import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

/**
 * Valida o corpo com Zod. Correção 2026-08-20: antes lançava
 * `BadRequestException(error.flatten())` — um objeto SEM campo `message`, e o
 * painel caía no texto genérico "Erro ao falar com a API", escondendo o motivo
 * real de qualquer formulário. Agora monta uma frase legível e mantém o
 * detalhe por campo em `fields` para quem quiser destacar o input.
 */
export function ZodBody(schema: ZodSchema): PipeTransform {
  return {
    transform(value: unknown) {
      const result = schema.safeParse(value);
      if (!result.success) {
        // caminho COMPLETO do campo: "pixelSettings.tiktokPixelId" diz qual dos
        // tres esta errado; so "pixelSettings" deixava o produtor adivinhando
        const message =
          result.error.issues
            .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
            .join(" · ") || "Dados invalidos";
        throw new BadRequestException({ message, fields: result.error.flatten().fieldErrors });
      }
      return result.data;
    },
  };
}
