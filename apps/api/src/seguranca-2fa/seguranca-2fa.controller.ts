import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ZodBody } from "../common/zod-body.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { RateLimit } from "../common/rate-limit.decorator";
import { Seguranca2faService } from "./seguranca-2fa.service";

/** código de 6 dígitos do app autenticador (espaços ignorados: "123 456" vale) */
const codigo2faSchema = z.object({
  code: z
    .string()
    .transform((v) => v.replace(/\s/g, ""))
    .refine((v) => /^\d{6}$/.test(v), "O código tem 6 dígitos"),
});

/**
 * Segundo fator do backoffice (2026-10-12): ativar o app autenticador e trocar
 * um código por uma confirmação de 10 minutos. O rate limit por sessão soma à
 * trava de 5 códigos errados por usuário do serviço.
 */
@Controller("v1/admin/2fa")
@UseGuards(SessionGuard)
export class Seguranca2faController {
  constructor(private readonly seguranca: Seguranca2faService) {}

  @Get()
  status(@CurrentUserId() userId: string) {
    return this.seguranca.status(userId);
  }

  @Post("ativacao")
  @RateLimit({ limit: 10, windowSeconds: 900, keyPrefix: "admin-2fa-ativacao", by: "session" })
  iniciarAtivacao(@CurrentUserId() userId: string) {
    return this.seguranca.iniciarAtivacao(userId);
  }

  @Post("ativacao/confirmar")
  @RateLimit({ limit: 10, windowSeconds: 900, keyPrefix: "admin-2fa-ativar", by: "session" })
  confirmarAtivacao(@CurrentUserId() userId: string, @Body(ZodBody(codigo2faSchema)) body: unknown) {
    return this.seguranca.confirmarAtivacao(userId, (body as { code: string }).code);
  }

  @Post("confirmar-acao")
  @RateLimit({ limit: 20, windowSeconds: 900, keyPrefix: "admin-2fa-acao", by: "session" })
  confirmarAcao(@CurrentUserId() userId: string, @Body(ZodBody(codigo2faSchema)) body: unknown) {
    return this.seguranca.confirmarAcao(userId, (body as { code: string }).code);
  }
}
