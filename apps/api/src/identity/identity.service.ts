import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import {
  generateOtpCode,
  hashOtpCode,
  verifyOtpCode,
  createSessionToken,
  verifySessionToken,
  OTP_TTL_MINUTES,
  OTP_MAX_ATTEMPTS,
  hashPassword,
  verifyPassword,
  generateResetToken,
  hashResetToken,
  PASSWORD_RESET_TTL_MINUTES,
} from "@borafest/auth";
import { withContext } from "@borafest/observability";
import type {
  PasswordLoginInput,
  RecoverPasswordInput,
  RegisterInput,
  RequestOtpInput,
  ResetPasswordInput,
  VerifyOtpInput,
} from "@borafest/contracts";

const log = withContext({ module: "identity" });

/**
 * Hash-isca para o login gastar o MESMO custo quando a conta não existe —
 * sem isso, o tempo de resposta denunciava se um e-mail tinha conta.
 */
const IDENTITY_DUMMY_HASH = hashPassword("borafest-timing-equalizer");

@Injectable()
export class IdentityService {
  private async activateInvitedMemberships(userId: string) {
    await prisma.organizationMember.updateMany({
      where: { userId, status: "INVITED" },
      data: { status: "ACTIVE", joinedAt: new Date() },
    });
  }

  async requestOtp(input: RequestOtpInput) {
    const code = generateOtpCode();
    const codeHash = hashOtpCode(code, input.destination);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await prisma.$transaction([
      prisma.otpChallenge.create({
        data: {
          destination: input.destination,
          channel: input.channel,
          codeHash,
          expiresAt,
        },
      }),
      // envio real via fila persistente de notificações (worker entrega pelo
      // adapter configurado — devlog em dev, provedor real em produção)
      prisma.notification.create({
        data: {
          // SMS não tem sender próprio ainda — destino telefônico vai pelo WhatsApp
          channel: input.channel === "EMAIL" ? "EMAIL" : "WHATSAPP",
          recipient: input.destination,
          template: "otp_code",
          payload: { code, ttlMinutes: OTP_TTL_MINUTES },
        },
      }),
    ]);

    log.info({ destination: input.destination, channel: input.channel }, "otp requested");
    if (process.env.NODE_ENV !== "production") {
      log.info({ code }, "otp code (dev only)");
    }

    return { sent: true, expiresAt };
  }

  async verifyOtp(input: VerifyOtpInput) {
    const challenge = await prisma.otpChallenge.findFirst({
      where: {
        destination: input.destination,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!challenge) {
      throw new UnauthorizedException("Código inválido ou expirado");
    }

    // TOCTOU (auditoria 2026-08-29): antes lia `attempts`, checava e só
    // incrementava DEPOIS — duas requisições paralelas liam o mesmo valor e o
    // teto de 5 tentativas virava ilimitado, permitindo força-bruta do código
    // de 6 dígitos. Agora a tentativa é RESERVADA atomicamente no banco antes
    // de comparar o código: o `attempts < MAX` no WHERE é avaliado sob trava de
    // linha, então N requisições concorrentes nunca passam do teto.
    const claim = await prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (claim.count === 0) {
      throw new UnauthorizedException("Código inválido ou expirado");
    }

    const isValid = verifyOtpCode(input.code, input.destination, challenge.codeHash);

    if (!isValid) {
      // a tentativa já foi contada no claim acima
      throw new UnauthorizedException("Código inválido ou expirado");
    }

    const user = await prisma.user.upsert({
      where: { email: input.destination },
      // código digitado = posse do e-mail comprovada — abre o 1º ingresso
      update: { emailVerifiedAt: new Date() },
      create: { email: input.destination, emailVerifiedAt: new Date() },
    });

    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date(), userId: user.id },
    });

    // OTP verificado = posse do e-mail comprovada: reivindica os pedidos feitos
    // como convidado com este e-mail, para os ingressos aparecerem na carteira.
    await prisma.order.updateMany({
      where: { userId: null, contactEmail: input.destination },
      data: { userId: user.id },
    });

    const token = await createSessionToken({ sub: user.id, sv: user.sessionVersion });

    // NAO devolver a User row crua (auditoria 2026-08-29): ela carrega
    // passwordHash, cpf, telefone e platformRole. So o publico do cliente.
    return { token, user: { id: user.id, name: user.name, email: user.email } };
  }
  /**
   * Link mágico do e-mail de "seu ingresso está pronto": clicar É a prova de
   * posse do e-mail — verifica a conta, loga e devolve o pedido de destino.
   */
  async verifyMagicLink(token: string) {
    let claims: { sub?: string; purpose?: string; orderToken?: string; sv?: number };
    try {
      claims = (await verifySessionToken(token)) as typeof claims;
    } catch {
      throw new UnauthorizedException("Link inválido ou expirado — peça um código no site");
    }
    if (claims.purpose !== "email-verify" || !claims.sub) {
      throw new UnauthorizedException("Link inválido ou expirado — peça um código no site");
    }
    // amarra o link ao session_version (auditoria 2026-08-30): trocar a senha
    // (ou apagar a conta) incrementa o sv e invalida os links de e-mail antigos,
    // como já acontece com as sessões. Link de conta sem senha nasce com sv=0.
    const alvo = await prisma.user.findUnique({
      where: { id: claims.sub },
      select: { sessionVersion: true },
    });
    const svToken = typeof claims.sv === "number" ? claims.sv : 0;
    if (!alvo || alvo.sessionVersion !== svToken) {
      throw new UnauthorizedException("Link expirado — peça um novo (a conta mudou desde o envio)");
    }
    const user = await prisma.user.update({
      where: { id: claims.sub },
      data: { emailVerifiedAt: new Date() },
    });
    // mesmo efeito do OTP: reivindica pedidos de convidado antigos deste e-mail
    if (user.email) {
      await prisma.order.updateMany({
        where: { userId: null, contactEmail: user.email },
        data: { userId: user.id },
      });
    }
    const session = await createSessionToken({ sub: user.id, sv: user.sessionVersion });
    // idem verifyOtp: nada de User row crua (passwordHash/cpf/platformRole)
    return {
      token: session,
      user: { id: user.id, name: user.name, email: user.email },
      orderToken: claims.orderToken ?? null,
    };
  }

  // --- auth por senha (painel do produtor) ---------------------------------

  async registerWithPassword(input: RegisterInput) {
    const existing = await prisma.user.findFirst({
      where: { email: { equals: input.email, mode: "insensitive" } },
    });
    // TAKEOVER DE CONTA (auditoria de seguranca 2026-08-29): o codigo antigo so
    // barrava quem JA tinha senha. Toda conta SEM senha — e todo comprador do
    // checkout tem uma, criada pelo e-mail — caia no ramo de update: quem
    // soubesse o e-mail definia a senha e recebia um token de sessao da conta
    // da vitima (ingressos, pedidos, vinculos de organizacao). Provado ao vivo.
    //
    // Registro NUNCA reivindica uma conta que ja existe. Quem comprou e quer
    // senha usa "entrar" -> "esqueci a senha": o link vai para o e-mail DELE,
    // que e a unica prova de posse aceitavel.
    if (existing) {
      throw new ConflictException(
        existing.passwordHash
          ? "Já existe uma conta com este e-mail — faça login"
          : "Já existe uma conta com este e-mail (criada em uma compra). Clique em \"Entrar\" e depois em \"Esqueci minha senha\" para definir a sua.",
      );
    }

    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: hashPassword(input.password),
        termsAcceptedAt: new Date(),
      },
    });

    await this.activateInvitedMemberships(user.id);
    log.info({ userId: user.id }, "conta de produtor criada (senha)");
    const token = await createSessionToken({ sub: user.id, sv: user.sessionVersion });
    return { token, user: { id: user.id, name: user.name, email: user.email } };
  }

  async loginWithPassword(input: PasswordLoginInput) {
    // busca insensível a caixa (auditoria 2026-08-30): o schema já normaliza o
    // input, mas contas antigas podem ter sido gravadas com maiúscula — sem CI,
    // o login delas quebraria.
    const user = await prisma.user.findFirst({
      where: { email: { equals: input.email, mode: "insensitive" } },
    });
    // Timing constante (auditoria 2026-08-29): antes, e-mail inexistente pulava
    // o scrypt e respondia mais rápido — dava pra enumerar contas pelo tempo.
    // Agora sempre gastamos o mesmo custo, comparando contra um hash-isca quando
    // a conta não existe ou não tem senha.
    const hashParaConferir = user?.passwordHash ?? IDENTITY_DUMMY_HASH;
    const senhaConfere = verifyPassword(input.password, hashParaConferir);
    if (!user?.passwordHash || !senhaConfere) {
      throw new UnauthorizedException("E-mail ou senha inválidos");
    }
    await this.activateInvitedMemberships(user.id);
    const token = await createSessionToken({ sub: user.id, sv: user.sessionVersion });
    return { token, user: { id: user.id, name: user.name, email: user.email } };
  }

  /** Sempre responde {sent:true} — sem enumeração de contas. */
  async recoverPassword(input: RecoverPasswordInput) {
    const user = await prisma.user.findFirst({
      where: { email: { equals: input.email, mode: "insensitive" } },
    });
    if (user) {
      const { token, tokenHash } = generateResetToken();
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
      const baseUrl = process.env.PRODUCER_BASE_URL ?? "http://localhost:3001";
      await prisma.$transaction([
        // um pedido novo invalida os anteriores (auditoria 2026-08-29): antes
        // todos os links emitidos continuavam valendo em paralelo
        prisma.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        }),
        prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } }),
        prisma.notification.create({
          data: {
            channel: "EMAIL",
            recipient: input.email,
            template: "password_reset",
            payload: {
              resetUrl: `${baseUrl}/redefinir-senha?token=${token}`,
              ttlMinutes: PASSWORD_RESET_TTL_MINUTES,
            },
          },
        }),
      ]);
      log.info({ userId: user.id }, "recuperação de senha solicitada");
    }
    return { sent: true };
  }

  async resetPassword(input: ResetPasswordInput) {
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashResetToken(input.token) },
    });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Link de redefinição inválido ou expirado");
    }

    const [user] = await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        // trocar a senha invalida as sessões antigas (ver session.guard):
        // sem bump do sessionVersion, um token roubado sobrevivia à troca
        data: { passwordHash: hashPassword(input.password), sessionVersion: { increment: 1 } },
      }),
      // todos os links de reset pendentes deste usuário morrem aqui, não só o usado
      prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    const token = await createSessionToken({ sub: user.id, sv: user.sessionVersion });
    return { token, user: { id: user.id, name: user.name, email: user.email } };
  }

}
