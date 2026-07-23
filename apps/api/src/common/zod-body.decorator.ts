import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

export function ZodBody(schema: ZodSchema): PipeTransform {
  return {
    transform(value: unknown) {
      const result = schema.safeParse(value);
      if (!result.success) {
        throw new BadRequestException(result.error.flatten());
      }
      return result.data;
    },
  };
}
