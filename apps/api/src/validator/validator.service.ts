import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { prisma, type ValidatorDevice } from "@borafest/database";
import {
  generateDeviceToken,
  generateValidatorPin,
  hashDeviceToken,
  hashValidatorPin,
  verifyValidatorPin,
} from "@borafest/auth";
import type {
  CreateCheckinPointInput,
  CreateValidatorCredentialInput,
  RegisterValidatorDeviceInput,
  ValidatorSessionInput,
} from "@borafest/contracts";
import { PERMISSIONS } from "@borafest/auth";
import { OrgAccessService } from "../common/org-access.service";

@Injectable()
export class ValidatorService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  // --- configuração pelo produtor (painel) --------------------------------

  async createCheckinPoint(userId: string, eventId: string, input: CreateCheckinPointInput) {
    const event = await this.loadEventForConfig(userId, eventId);
    return prisma.checkinPoint.upsert({
      where: { eventId_name: { eventId: event.id, name: input.name } },
      update: { active: true },
      create: { eventId: event.id, name: input.name },
    });
  }

  async listCheckinPoints(userId: string, eventId: string) {
    const event = await this.loadEventForConfig(userId, eventId);
    return prisma.checkinPoint.findMany({
      where: { eventId: event.id, active: true },
      orderBy: { name: "asc" },
    });
  }

  /** Gera o PIN no servidor e o devolve UMA vez — só o hash é persistido. */
  async createCredential(
    userId: string,
    eventId: string,
    input: CreateValidatorCredentialInput,
  ) {
    const event = await this.loadEventForConfig(userId, eventId);
    const pin = generateValidatorPin();
    const expiresAt =
      input.expiresAt ?? new Date(event.endsAt.getTime() + 2 * 24 * 60 * 60 * 1000);

    const credential = await prisma.validatorCredential.upsert({
      where: { eventId_label: { eventId: event.id, label: input.label } },
      update: { pinHash: hashValidatorPin(pin, event.id), active: true, expiresAt },
      create: {
        eventId: event.id,
        label: input.label,
        pinHash: hashValidatorPin(pin, event.id),
        expiresAt,
      },
    });

    return {
      id: credential.id,
      label: credential.label,
      expiresAt: credential.expiresAt,
      /** exibido uma única vez; recriar a credencial rotaciona o PIN */
      pin,
    };
  }

  async blockDevice(userId: string, eventId: string, deviceId: string) {
    await this.loadEventForConfig(userId, eventId);
    const updated = await prisma.validatorDevice.updateMany({
      where: { id: deviceId, eventId },
      data: { status: "BLOCKED" },
    });
    if (updated.count === 0) throw new NotFoundException("Dispositivo não encontrado");
    return { blocked: true };
  }

  async listDevices(userId: string, eventId: string) {
    await this.loadEventForConfig(userId, eventId);
    return prisma.validatorDevice.findMany({
      where: { eventId },
      orderBy: { registeredAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        registeredAt: true,
        lastSeenAt: true,
        lastSyncAt: true,
        credential: { select: { label: true } },
      },
    });
  }

  // --- app de check-in -----------------------------------------------------

  /**
   * Login por PIN (§13): valida a credencial do evento e registra o aparelho
   * na sequência. O token do dispositivo é a credencial de trabalho.
   */
  async createSessionAndRegisterDevice(
    session: ValidatorSessionInput,
    device: RegisterValidatorDeviceInput,
  ) {
    const credentials = await prisma.validatorCredential.findMany({
      where: {
        eventId: session.eventId,
        active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });

    const credential = credentials.find((c) =>
      verifyValidatorPin(session.pin, session.eventId, c.pinHash),
    );
    if (!credential) {
      throw new UnauthorizedException("PIN inválido ou expirado");
    }

    const token = generateDeviceToken();
    const created = await prisma.validatorDevice.create({
      data: {
        credentialId: credential.id,
        eventId: session.eventId,
        name: device.name,
        tokenHash: hashDeviceToken(token),
      },
    });

    const event = await prisma.event.findUniqueOrThrow({
      where: { id: session.eventId },
      select: { id: true, title: true, slug: true, startsAt: true, endsAt: true },
    });
    const checkinPoints = await prisma.checkinPoint.findMany({
      where: { eventId: session.eventId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });

    return {
      deviceId: created.id,
      /** guardar no SecureStore; enviado em x-device-token */
      deviceToken: token,
      credentialLabel: credential.label,
      event,
      checkinPoints,
    };
  }

  /** Rotaciona o token do próprio aparelho autenticado. */
  async refreshDeviceToken(device: ValidatorDevice, deviceId: string) {
    if (device.id !== deviceId) {
      throw new BadRequestException("Só é possível renovar o próprio token");
    }
    const token = generateDeviceToken();
    await prisma.validatorDevice.update({
      where: { id: device.id },
      data: { tokenHash: hashDeviceToken(token) },
    });
    return { deviceId: device.id, deviceToken: token };
  }

  /** Manifesto (§12): chave pública + ingressos do evento p/ validação offline. */
  async getManifest(device: ValidatorDevice, since?: Date) {
    const [event, signingKey] = await Promise.all([
      prisma.event.findUniqueOrThrow({
        where: { id: device.eventId },
        select: { id: true, title: true, startsAt: true, endsAt: true, timezone: true },
      }),
      prisma.eventSigningKey.findUnique({
        where: { eventId: device.eventId },
        select: { publicKeyPem: true, algorithm: true },
      }),
    ]);

    const generatedAt = new Date();
    const tickets = await prisma.ticket.findMany({
      where: {
        eventId: device.eventId,
        ...(since ? { updatedAt: { gt: since } } : {}),
      },
      orderBy: { updatedAt: "asc" },
      select: {
        id: true,
        code: true,
        status: true,
        ticketLotId: true,
        checkedInAt: true,
        updatedAt: true,
      },
    });

    return {
      manifestVersion: generatedAt.toISOString(),
      delta: Boolean(since),
      event,
      signingKey: signingKey ?? null,
      ticketCount: tickets.length,
      tickets,
    };
  }

  // -------------------------------------------------------------------------

  private async loadEventForConfig(userId: string, eventId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    await this.orgAccess.assertPermission(
      event.organizationId,
      userId,
      PERMISSIONS.EVENT_CREATE,
    );
    return event;
  }
}
