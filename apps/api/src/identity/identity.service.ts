import { Injectable, UnauthorizedException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import {
  generateOtpCode,
  hashOtpCode,
  verifyOtpCode,
  createSessionToken,
  OTP_TTL_MINUTES,
  OTP_MAX_ATTEMPTS,
} from "@borafest/auth";
import { withContext } from "@borafest/observability";
import type { RequestOtpInput, VerifyOtpInput } from "@borafest/contracts";

const log = withContext({ module: "identity" });

@Injectable()
export class IdentityService {
  async requestOtp(input: RequestOtpInput) {
    const code = generateOtpCode();
    const codeHash = hashOtpCode(code, input.destination);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await prisma.otpChallenge.create({
      data: {
        destination: input.destination,
        channel: input.channel,
        codeHash,
        expiresAt,
      },
    });

    // TODO: enfileirar envio real via notification-delivery worker (e-mail/SMS/WhatsApp)
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
}
