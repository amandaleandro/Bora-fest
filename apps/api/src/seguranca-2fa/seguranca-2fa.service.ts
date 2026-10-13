import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { prisma } from "@borafest/database";
import { getRedisConnection } from "@borafest/queues";
import { PlatformAccessService } from "../common/platform-access.service";
import {
  TOTP_CHAVE_ENV,
  TOTP_CHAVE_TAMANHO_MINIMO,
  chaveMestraTotp,
  cifrarSegredoTotp,
  decifrarSegredoTotp,
} from "./cofre-totp";
import {
  ERRO_2FA_NAO_ATIVADO,
  MENSAGEM_2FA_NAO_ATIVADO,
  emitirConfirmacao2fa,
} from "./confirmacao";
import { TOTP_JANELA, TOTP_PASSO_SEGUNDOS, base32Encode, gerarSegredoTotp, linkOtpauth, verificarTotp } from "./totp";

/** nome que aparece no app autenticador ao lado do e-mail */
const EMISSOR_TOTP = "BoraFest";
/** códigos errados seguidos antes de travar as tentativas por um tempo */
export const MAX_CODIGOS_ERRADOS = 5;
export const TRAVA_CODIGOS_ERRADOS_SEGUNDOS = 15 * 60;

const MENSAGEM_SEM_CHAVE =
  `A verificação em duas etapas ainda não pode ser ativada: falta configurar a variável ${TOTP_CHAVE_ENV} ` +
  `no servidor da API (gere com: openssl rand -base64 32; mínimo de ${TOTP_CHAVE_TAMANHO_MINIMO} caracteres).`;

type Redis = ReturnType<typeof getRedisConnection>;

/**
 * Redis fora do ar: segue sem o controle de tentativas e de reuso, como o
 * rate limit global (decisão de 2026-09-01). O código TOTP continua exigido.
 * A conexão compartilhada tem fila offline sem limite: sem conexão pronta, ou
 * sem resposta em 1 s, segue — antes a confirmação ficava esperando para
 * sempre (revisão 2026-10-13, mesmo conserto do rate-limit.guard).
 */
async function noRedis<T>(operacao: (redis: Redis) => Promise<T>): Promise<T | undefined> {
  try {
    const redis = getRedisConnection();
    if (redis.status !== "ready") {
      // eslint-disable-next-line no-console
      console.error(`[2fa] Redis ${redis.status} — seguindo sem o controle de tentativas`);
      return undefined;
    }
    return await Promise.race([
      operacao(redis),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1000).unref()),
    ]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[2fa] Redis indisponível — seguindo sem o controle de tentativas", err);
    return undefined;
  }
}

/**
 * Segundo fator (TOTP) do staff do backoffice (2026-10-12). Ativação em dois
 * passos: gera o segredo (guardado cifrado) e só liga depois que o staff
 * digita o 1º código do app. Depois, cada ação de dinheiro pede uma
 * confirmação de 10 minutos obtida com um código novo.
 */
@Injectable()
export class Seguranca2faService {
  constructor(private readonly platformAccess: PlatformAccessService) {}

  async status(userId: string) {
    const user = await this.platformAccess.assertStaff(userId);
    return {
      ativo: Boolean(user.totpEnabledAt),
      ativoDesde: user.totpEnabledAt,
      // ativação começada e não confirmada: a tela retoma em vez de gerar outra chave sem avisar
      ativacaoPendente: !user.totpEnabledAt && Boolean(user.totpSecret),
      // sem a chave mestra ninguém consegue ativar: a tela avisa antes do clique
      servidorPronto: chaveMestraTotp() !== null,
    };
  }

  /** Passo 1: gera o segredo, guarda cifrado e devolve a chave e o link para o app. */
  async iniciarAtivacao(userId: string) {
    const user = await this.platformAccess.assertStaff(userId);
    if (user.totpEnabledAt) {
      // trocar a chave de quem já tem 2FA abriria a porta para quem só tem o e-mail
      throw new BadRequestException(
        "A verificação em duas etapas já está ativa nesta conta. Para trocar de celular, peça a redefinição ao responsável técnico.",
      );
    }
    const chave = chaveMestraTotp();
    if (!chave) throw new ServiceUnavailableException(MENSAGEM_SEM_CHAVE);

    const segredo = gerarSegredoTotp();
    // só grava se continua sem 2FA ativo (duas abas ao mesmo tempo não trocam um segredo já ligado)
    const gravou = await prisma.user.updateMany({
      where: { id: user.id, totpEnabledAt: null },
      data: { totpSecret: cifrarSegredoTotp(segredo, user.id, chave) },
    });
    if (gravou.count === 0) {
      throw new BadRequestException("A verificação em duas etapas já está ativa nesta conta.");
    }

    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "admin.2fa.setup_started",
        entityType: "user",
        entityId: user.id,
      },
    });

    const segredoBase32 = base32Encode(segredo);
    return {
      segredo: segredoBase32,
      otpauthUrl: linkOtpauth({ emissor: EMISSOR_TOTP, conta: user.email ?? user.id, segredoBase32 }),
      digitos: 6,
      periodoSegundos: TOTP_PASSO_SEGUNDOS,
    };
  }

  /** Passo 2: confere o 1º código do app e liga o 2FA. Já devolve uma confirmação de 10 min. */
  async confirmarAtivacao(userId: string, codigo: string) {
    const user = await this.platformAccess.assertStaff(userId);
    if (user.totpEnabledAt) {
      throw new BadRequestException("A verificação em duas etapas já está ativa nesta conta.");
    }
    if (!user.totpSecret) {
      throw new BadRequestException("Comece pela chave: clique em “Ativar” na tela Segurança.");
    }
    const segredo = this.lerSegredo(user.id, user.totpSecret);
    await this.conferirCodigo(user.id, segredo, codigo);

    const ativadoEm = new Date();
    // liga só com o MESMO segredo conferido (outra aba pode ter gerado outra chave no meio)
    const ativou = await prisma.user.updateMany({
      where: { id: user.id, totpEnabledAt: null, totpSecret: user.totpSecret },
      data: { totpEnabledAt: ativadoEm },
    });
    if (ativou.count === 0) {
      throw new BadRequestException(
        "A chave mudou durante a confirmação (outra aba gerou uma nova?). Gere a chave de novo e tente outra vez.",
      );
    }

    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "admin.2fa.enabled",
        entityType: "user",
        entityId: user.id,
      },
    });

    const confirmacao = await emitirConfirmacao2fa(user.id, user.sessionVersion);
    return { ativo: true, ativoDesde: ativadoEm, ...confirmacao };
  }

  /** Código do app → confirmação de 10 minutos para as ações de dinheiro. */
  async confirmarAcao(userId: string, codigo: string) {
    const user = await this.platformAccess.assertStaff(userId);
    if (!user.totpEnabledAt || !user.totpSecret) {
      throw new ForbiddenException({ statusCode: 403, code: ERRO_2FA_NAO_ATIVADO, message: MENSAGEM_2FA_NAO_ATIVADO });
    }
    const segredo = this.lerSegredo(user.id, user.totpSecret);
    await this.conferirCodigo(user.id, segredo, codigo);

    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "admin.2fa.confirmed",
        entityType: "user",
        entityId: user.id,
      },
    });

    return emitirConfirmacao2fa(user.id, user.sessionVersion);
  }

  private lerSegredo(userId: string, guardado: string): Buffer {
    const chave = chaveMestraTotp();
    if (!chave) {
      throw new ServiceUnavailableException(
        `A verificação em duas etapas está indisponível: falta a variável ${TOTP_CHAVE_ENV} no servidor da API.`,
      );
    }
    try {
      return decifrarSegredoTotp(guardado, userId, chave);
    } catch {
      throw new ServiceUnavailableException(
        `Não foi possível ler o segredo do autenticador desta conta (a ${TOTP_CHAVE_ENV} do servidor mudou?). ` +
          "Peça ao responsável técnico para redefinir o 2FA desta conta.",
      );
    }
  }

  /**
   * Confere o código com trava de força bruta (5 erros → 15 min) e sem reuso:
   * o mesmo código não vale duas vezes, então quem espiou a tela não o
   * reaproveita na janela de 30 s.
   */
  private async conferirCodigo(userId: string, segredo: Buffer, codigo: string): Promise<void> {
    const chaveErros = `2fa:erros:${userId}`;
    // a tentativa é RESERVADA antes de conferir, num INCR atômico (revisão
    // 2026-10-13): antes lia o contador e só incrementava depois do erro, e N
    // requisições ao mesmo tempo passavam todas pela checagem — a trava de 5
    // não segurava força bruta em paralelo. Acertou: o contador zera abaixo.
    const reserva = await noRedis((r) =>
      r.multi().incr(chaveErros).expire(chaveErros, TRAVA_CODIGOS_ERRADOS_SEGUNDOS, "NX").exec(),
    );
    const tentativas = Number(reserva?.[0]?.[1] ?? 0);
    if (tentativas > MAX_CODIGOS_ERRADOS) {
      throw new HttpException(
        "Muitos códigos errados seguidos. Espere 15 minutos e tente de novo.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const passo = verificarTotp(segredo, codigo);
    if (passo === null) {
      throw new BadRequestException(
        "Código incorreto. Use o código que aparece agora no aplicativo autenticador (e confira se a hora do celular está automática).",
      );
    }

    // guarda o passo usado pelo tempo em que ele ainda seria aceito pela janela
    const validadeSegundos = (2 * TOTP_JANELA + 2) * TOTP_PASSO_SEGUNDOS;
    const marcado = await noRedis((r) => r.set(`2fa:usado:${userId}:${passo}`, "1", "EX", validadeSegundos, "NX"));
    if (marcado === null) {
      throw new BadRequestException("Este código já foi usado. Espere o próximo código no aplicativo autenticador.");
    }
    await noRedis((r) => r.del(chaveErros));
  }
}
