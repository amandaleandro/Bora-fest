import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import {
  generateOtpCode,
  hashOtpCode,
  verifyOtpCode,
  createSessionToken,
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

@Injectable()
export class IdentityService {
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

    if (!challenge || challenge.attempts >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException("Código inválido ou expirado");
    }

    const isValid = verifyOtpCode(input.code, input.destination, challenge.codeHash);

    if (!isValid) {
      await prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException("Código inválido ou expirado");
    }

    const user = await prisma.user.upsert({
      where: { email: input.destination },
      update: {},
      create: { email: input.destination },
    });

    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date(), userId: user.id },
    });

    const token = await createSessionToken({ sub: user.id });

    return { token, user };
  }
  // --- auth por senha (painel do produtor) ---------------------------------

  async registerWithPassword(input: RegisterInput) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing?.passwordHash) {
      throw new ConflictException("Já existe uma conta com este e-mail — faça login");
    }

    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            name: existing.name ?? input.name,
            passwordHash: hashPassword(input.password),
            termsAcceptedAt: new Date(),
          },
        })
      : await prisma.user.create({
          data: {
            name: input.name,
            email: input.email,
            passwordHash: hashPassword(input.password),
            termsAcceptedAt: new Date(),
          },
        });

    log.info({ userId: user.id }, "conta de produtor criada (senha)");
    const token = await createSessionToken({ sub: user.id });
    return { token, user: { id: user.id, name: user.name, email: user.email } };
  }

  async loginWithPassword(input: PasswordLoginInput) {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user?.passwordHash || !verifyPassword(input.password, user.passwordHash)) {
      throw new UnauthorizedException("E-mail ou senha inválidos");
    }
    const token = await createSessionToken({ sub: user.id });
    return { token, user: { id: user.id, name: user.name, email: user.email } };
  }

  /** Sempre responde {sent:true} — sem enumeração de contas. */
  async recoverPassword(input: RecoverPasswordInput) {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (user?.passwordHash) {
      const { token, tokenHash } = generateResetToken();
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
      const baseUrl = process.env.PRODUCER_BASE_URL ?? "http://localhost:3001";
      await prisma.$transaction([
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
        data: { passwordHash: hashPassword(input.password) },
      }),
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    const token = await createSessionToken({ sub: user.id });
    return { token, user: { id: user.id, name: user.name, email: user.email } };
  }

}
