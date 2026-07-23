import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { verifySessionToken } from "@borafest/auth";

export const OptionalUserId = createParamDecorator(
  async (_: unknown, ctx: ExecutionContext): Promise<string | undefined> => {
    const request = ctx.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return undefined;

    try {
      const claims = await verifySessionToken(authHeader.slice("Bearer ".length));
      return claims.sub;
    } catch {
      return undefined;
    }
  },
);
