import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { PlatformAccessService } from "../common/platform-access.service";
import {
  CONFIRMACAO_2FA_HEADER,
  ERRO_2FA_CONFIRMACAO_NECESSARIA,
  ERRO_2FA_NAO_ATIVADO,
  MENSAGEM_2FA_NAO_ATIVADO,
  confirmacao2faValida,
} from "./confirmacao";

/**
 * Exige o segundo fator nas ações de dinheiro/poder do backoffice (2026-10-12).
 * Antes, aprovar saque, estornar, marcar repasse pago, mudar taxa e aprovar
 * casa pediam só a sessão: quem invadisse o e-mail de um admin liberava
 * dinheiro. Vai DEPOIS do SessionGuard (usa request.userId).
 *
 * Todas as rotas protegidas são só de ADMIN: o papel é conferido aqui primeiro
 * (403-primeiro, auditoria 2026-08-12), senão um SUPPORT ouviria "ative o 2FA"
 * e, depois de ativar, "restrito a administradores".
 */
@Injectable()
export class Exige2faGuard implements CanActivate {
  constructor(private readonly platformAccess: PlatformAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.userId;
    if (!userId) throw new UnauthorizedException("Sessao ausente, invalida ou expirada");

    const user = await this.platformAccess.assertAdmin(userId);

    if (!user.totpEnabledAt) {
      throw new ForbiddenException({
        statusCode: 403,
        code: ERRO_2FA_NAO_ATIVADO,
        message: MENSAGEM_2FA_NAO_ATIVADO,
      });
    }

    const bruto = request.headers?.[CONFIRMACAO_2FA_HEADER];
    const token = Array.isArray(bruto) ? bruto[0] : bruto;
    if (typeof token === "string" && token.length > 0) {
      if (await confirmacao2faValida(token, user.id, user.sessionVersion)) return true;
      throw new ForbiddenException({
        statusCode: 403,
        code: ERRO_2FA_CONFIRMACAO_NECESSARIA,
        message: "Sua confirmação expirou. Digite um novo código do aplicativo autenticador.",
      });
    }

    throw new ForbiddenException({
      statusCode: 403,
      code: ERRO_2FA_CONFIRMACAO_NECESSARIA,
      message: "Confirme esta ação com o código de 6 dígitos do seu aplicativo autenticador.",
    });
  }
}
