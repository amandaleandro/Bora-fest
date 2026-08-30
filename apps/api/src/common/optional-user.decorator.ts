import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { resolveSessionUserId } from "./session-resolver";

export const OptionalUserId = createParamDecorator(
  async (_: unknown, ctx: ExecutionContext): Promise<string | undefined> => {
    const request = ctx.switchToHttp().getRequest();
    // MESMAS regras do SessionGuard (auditoria 2026-08-30): rejeita token de
    // propósito e sessão revogada, em vez de só verificar a assinatura.
    const userId = await resolveSessionUserId(request.headers.authorization);
    return userId ?? undefined;
  },
);
