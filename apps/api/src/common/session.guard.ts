import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { resolveSessionUserId } from "./session-resolver";

@Injectable()
export class SessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = await resolveSessionUserId(request.headers.authorization);
    if (!userId) {
      throw new UnauthorizedException("Sessao ausente, invalida ou expirada");
    }
    request.userId = userId;
    return true;
  }
}
