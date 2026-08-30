import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { prisma } from "@borafest/database";
import { verifySessionToken } from "@borafest/auth";

@Injectable()
export class SessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Sessao ausente");
    }

    let claims;
    try {
      claims = await verifySessionToken(authHeader.slice("Bearer ".length));
    } catch {
      throw new UnauthorizedException("Sessao invalida ou expirada");
    }

    // Token de propósito único (link mágico / verificação de e-mail) NÃO é
    // sessão (auditoria 2026-08-29): ele viaja numa URL de e-mail — histórico do
    // navegador, referer, logs do provedor — e antes era aceito como bearer em
    // qualquer rota por 7 dias. Só serve no endpoint que o troca por sessão.
    if (typeof claims.purpose === "string" && claims.purpose.length > 0) {
      throw new UnauthorizedException("Token não é uma sessão");
    }
    if (!claims.sub) {
      throw new UnauthorizedException("Sessao invalida");
    }

    // Revogação: a troca de senha incrementa session_version. Token antigo (sem
    // sv) conta como 0 — no deploy todos são 0, ninguém é deslogado; depois de
    // um reset, os tokens anteriores deixam de conferir.
    const user = await prisma.user.findUnique({
      where: { id: claims.sub as string },
      select: { sessionVersion: true },
    });
    const versaoDoToken = typeof claims.sv === "number" ? claims.sv : 0;
    if (!user || user.sessionVersion !== versaoDoToken) {
      throw new UnauthorizedException("Sessao expirada — entre de novo");
    }

    request.userId = claims.sub;
    return true;
  }
}
