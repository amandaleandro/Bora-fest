import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { verifySessionToken } from "@borafest/auth";

@Injectable()
export class SessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Sessao ausente");
    }

    try {
      const claims = await verifySessionToken(authHeader.slice("Bearer ".length));
      request.userId = claims.sub;
      return true;
    } catch {
      throw new UnauthorizedException("Sessao invalida ou expirada");
    }
  }
}
