import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { prisma, type ValidatorDevice } from "@borafest/database";
import type { FaceEnrollmentInput, FaceVerificationInput } from "@borafest/contracts";
import { CheckinsService } from "./checkins.service";

const CONSENT_GRACE_MS = 24 * 60 * 60 * 1000;

type ProviderVerificationResult = {
  matched: boolean;
  score?: number;
  liveness?: boolean;
};

@Injectable()
export class FaceCheckinService {
  constructor(private readonly checkinsService: CheckinsService) {}

  private providerName(): string {
    return (process.env.FACE_PROVIDER_NAME ?? "").trim();
  }

  private verifyUrl(): string {
    return (process.env.FACE_PROVIDER_VERIFY_URL ?? "").trim();
  }

  private async ownedTicket(userId: string, ticketId: string) {
    const ticket = await prisma.ticket.findFirst({
      where: {
        id: ticketId,
        OR: [{ ownerUserId: userId }, { order: { userId } }],
      },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startsAt: true,
            endsAt: true,
            faceCheckinEnabled: true,
          },
        },
      },
    });
    if (!ticket) throw new NotFoundException("Ingresso não encontrado na sua conta");
    return ticket;
  }

  capabilities() {
    return {
      enabled: Boolean(this.providerName() && this.verifyUrl()),
      provider: this.providerName() || null,
      mode: "ONE_TO_ONE" as const,
      storesRawFaceImage: false,
      offlineVerification: false,
      fallbackMethods: ["QR", "MANUAL"] as const,
    };
  }

  async status(userId: string, ticketId: string) {
    await this.ownedTicket(userId, ticketId);
    const enrollment = await prisma.ticketFaceEnrollment.findUnique({
      where: { ticketId },
      select: {
        status: true,
        provider: true,
        consentVersion: true,
        consentedAt: true,
        revokedAt: true,
        expiresAt: true,
      },
    });
    return {
      enrolled: enrollment?.status === "ACTIVE" && enrollment.expiresAt > new Date(),
      enrollment,
      eventEnabled: ticket.event.faceCheckinEnabled,
      capabilities: this.capabilities(),
    };
  }

  async enroll(userId: string, ticketId: string, input: FaceEnrollmentInput) {
    const ticket = await this.ownedTicket(userId, ticketId);
    if (!["ISSUED", "ACTIVE"].includes(ticket.status)) {
      throw new BadRequestException("Somente ingresso ativo pode cadastrar biometria facial");
    }
    if (!ticket.event.faceCheckinEnabled) {
      throw new BadRequestException("O produtor não habilitou check-in facial para este evento");
    }

    const configured = this.providerName();
    if (!configured || !this.verifyUrl()) {
      throw new ServiceUnavailableException("Check-in facial ainda não está configurado neste ambiente");
    }
    if (input.provider !== configured) {
      throw new BadRequestException("Referência biométrica pertence a outro provedor");
    }

    const now = new Date();
    const expiresAt = new Date(ticket.event.endsAt.getTime() + CONSENT_GRACE_MS);

    return prisma.ticketFaceEnrollment.upsert({
      where: { ticketId },
      create: {
        ticketId,
        status: "ACTIVE",
        provider: input.provider,
        providerReference: input.providerReference,
        consentVersion: input.consentVersion,
        consentedAt: now,
        expiresAt,
      },
      update: {
        status: "ACTIVE",
        provider: input.provider,
        providerReference: input.providerReference,
        consentVersion: input.consentVersion,
        consentedAt: now,
        revokedAt: null,
        expiresAt,
      },
      select: {
        status: true,
        provider: true,
        consentVersion: true,
        consentedAt: true,
        expiresAt: true,
      },
    });
  }

  async revoke(userId: string, ticketId: string) {
    await this.ownedTicket(userId, ticketId);
    const result = await prisma.ticketFaceEnrollment.updateMany({
      where: { ticketId, status: { in: ["PENDING", "ACTIVE"] } },
      data: { status: "REVOKED", revokedAt: new Date(), providerReference: null },
    });
    return { revoked: result.count > 0 };
  }

  async verifyAndCheckin(device: ValidatorDevice, input: FaceVerificationInput) {
    const enrollment = await prisma.ticketFaceEnrollment.findFirst({
      where: {
        ticketId: input.ticketId,
        status: "ACTIVE",
        expiresAt: { gt: new Date() },
        ticket: {
          eventId: device.eventId,
          status: { in: ["ISSUED", "ACTIVE", "CHECKED_IN"] },
          event: { faceCheckinEnabled: true },
        },
      },
      include: {
        ticket: { select: { id: true, eventId: true } },
      },
    });

    if (!enrollment?.providerReference) {
      return { result: "INVALID" as const, reason: "FACE_NOT_ENROLLED" as const };
    }

    const configured = this.providerName();
    const verifyUrl = this.verifyUrl();
    if (!configured || !verifyUrl) {
      throw new ServiceUnavailableException("Check-in facial indisponível; use QR ou busca manual");
    }
    if (enrollment.provider !== configured) {
      throw new ServiceUnavailableException("O enrollment facial usa um provedor diferente do ambiente atual");
    }

    const verification = await this.verifyWithProvider(
      enrollment.providerReference,
      input.probeReference,
    );

    if (!verification.matched) {
      return {
        result: "INVALID" as const,
        reason: "FACE_NO_MATCH" as const,
        score: verification.score ?? null,
      };
    }
    // A missing liveness result is not proof of life; fail closed.
    if (verification.liveness !== true) {
      return {
        result: "INVALID" as const,
        reason: "FACE_LIVENESS_FAILED" as const,
        score: verification.score ?? null,
      };
    }

    const outcome = await this.checkinsService.createFace(
      device,
      input.ticketId,
      input.checkinPointId,
      input.scannedAt ?? new Date(),
    );

    return {
      ...outcome,
      face: {
        matched: true,
        score: verification.score ?? null,
        liveness: verification.liveness ?? null,
      },
    };
  }

  private async verifyWithProvider(
    enrollmentReference: string,
    probeReference: string,
  ): Promise<ProviderVerificationResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7_000);

    try {
      const response = await fetch(this.verifyUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.FACE_PROVIDER_API_KEY
            ? { Authorization: `Bearer ${process.env.FACE_PROVIDER_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          enrollmentReference,
          probeReference,
          mode: "ONE_TO_ONE",
          requireLiveness: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ServiceUnavailableException("Provedor facial não respondeu corretamente");
      }

      const data = (await response.json()) as Partial<ProviderVerificationResult>;
      if (typeof data.matched !== "boolean") {
        throw new ServiceUnavailableException("Resposta inválida do provedor facial");
      }
      return {
        matched: data.matched,
        score: typeof data.score === "number" ? data.score : undefined,
        liveness: typeof data.liveness === "boolean" ? data.liveness : undefined,
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException("Não foi possível validar o rosto agora; use QR ou busca manual");
    } finally {
      clearTimeout(timeout);
    }
  }
}
