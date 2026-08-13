import { createHash } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
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
import { PERMISSIONS, roleHasPermission } from "@borafest/auth";
import { OrgAccessService } from "../common/org-access.service";

/** SHA-256 (hex minúsculo) dos 11 dígitos do CPF — o cru nunca sai do servidor. */
function hashCpf(cpf: string | null): string | null {
  if (!cpf) return null;
  const digits = cpf.replace(/\D/g, "");
  if (!digits) return null;
  return createHash("sha256").update(digits).digest("hex");
}

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

  /**
   * Portaria por CONTA (2026-08-11) — padrão do mercado (Sympla: a equipe
   * loga com a própria conta e enxerga só os eventos autorizados).
   *
   * Antes o app listava TODOS os eventos públicos da plataforma e pedia um PIN
   * — o porteiro procurava o evento dele entre os dos outros produtores. Agora
   * a lista vem da PERMISSÃO da pessoa; o PIN fica como plano B (celular
   * emprestado / equipe sem conta).
   */
  async listMyValidatorEvents(userId: string) {
    const memberships = await prisma.organizationMember.findMany({
      where: { userId, status: "ACTIVE" },
      include: { role: true },
    });
    const orgIds = memberships
      .filter(
        (m) =>
          roleHasPermission(m.role.key, PERMISSIONS.CHECKIN_PERFORM) ||
          roleHasPermission(m.role.key, PERMISSIONS.EVENT_CREATE),
      )
      .map((m) => m.organizationId);
    if (orgIds.length === 0) return [];

    // eventos que ainda fazem sentido validar: futuros ou terminados há < 12h
    const limite = new Date(Date.now() - 12 * 60 * 60 * 1000);
    return prisma.event.findMany({
      where: {
        organizationId: { in: orgIds },
        status: { in: ["PUBLISHED", "SALES_PAUSED"] },
        endsAt: { gt: limite },
      },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        venue: { select: { name: true, city: true } },
      },
      take: 50,
    });
  }

  /** Entra na portaria com a CONTA (sem PIN) — exige permissão no evento. */
  async createSessionFromAccount(
    userId: string,
    eventId: string,
    device: RegisterValidatorDeviceInput,
  ) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, slug: true, startsAt: true, endsAt: true, organizationId: true },
    });
    if (!event) throw new NotFoundException("Evento não encontrado");

    const membership = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: event.organizationId, userId } },
      include: { role: true, user: { select: { name: true, email: true } } },
    });
    const ativo = membership?.status === "ACTIVE";
    const canValidate =
      ativo &&
      (roleHasPermission(membership!.role.key, PERMISSIONS.CHECKIN_PERFORM) ||
        roleHasPermission(membership!.role.key, PERMISSIONS.EVENT_CREATE));
    // venda na porta (2026-08-12): quem tem SALES_PERFORM também entra — pode
    // só vender (vendedor) sem validar. A aba certa aparece conforme a permissão.
    const canSell = Boolean(ativo && roleHasPermission(membership!.role.key, PERMISSIONS.SALES_PERFORM));
    if (!canValidate && !canSell) {
      throw new ForbiddenException("Você não tem acesso à portaria deste evento");
    }

    // credencial "por conta": uma por pessoa no evento, para o histórico de
    // check-in ficar com nome e poder ser revogada individualmente
    const quem = membership!.user.name ?? membership!.user.email ?? "equipe";
    const label = `Conta · ${quem}`;
    const credential = await prisma.validatorCredential.upsert({
      where: { eventId_label: { eventId, label } },
      update: { active: true },
      create: {
        eventId,
        label,
        // credencial de conta não usa PIN: hash impossível de casar
        pinHash: hashValidatorPin(generateValidatorPin(), `conta:${userId}:${eventId}`),
        active: true,
      },
    });

    const token = generateDeviceToken();
    const created = await prisma.validatorDevice.create({
      data: {
        credentialId: credential.id,
        eventId,
        name: device.name,
        tokenHash: hashDeviceToken(token),
      },
    });
    const checkinPoints = await prisma.checkinPoint.findMany({
      where: { eventId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });

    return {
      deviceId: created.id,
      deviceToken: token,
      credentialLabel: credential.label,
      // a portaria mostra a aba Validar só com canValidate e a aba Vender na
      // porta só com canSell (venda usa a sessão da conta + SALES_PERFORM)
      canValidate,
      canSell,
      event: {
        id: event.id,
        title: event.title,
        slug: event.slug,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
      },
      checkinPoints,
    };
  }

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
        // busca manual por nome na portaria (handoff §4). CPF NÃO vai para o
        // aparelho: só o hash sai do servidor (minimização LGPD).
        attendeeName: true,
        attendeeCpf: true,
      },
    });

    const lots = await prisma.ticketLot.findMany({
      where: { ticketType: { eventId: device.eventId } },
      select: { id: true, name: true, ticketType: { select: { name: true } } },
    });

    return {
      manifestVersion: generatedAt.toISOString(),
      lots: lots.map((l) => ({ id: l.id, name: l.name, typeName: l.ticketType.name })),
      delta: Boolean(since),
      event,
      signingKey: signingKey ?? null,
      ticketCount: tickets.length,
      // busca por documento na portaria compara sha256 no aparelho — o CPF cru
      // nunca sai do servidor.
      tickets: tickets.map(({ attendeeCpf, ...ticket }) => ({
        ...ticket,
        cpfHash: hashCpf(attendeeCpf),
      })),
    };
  }

  /** Resumo de portaria pelo próprio aparelho (handoff §4: presentes + por portão). */
  async summary(device: ValidatorDevice) {
    const [total, checkedIn, byPoint, points] = await Promise.all([
      prisma.ticket.count({
        where: { eventId: device.eventId, status: { in: ["ISSUED", "ACTIVE", "CHECKED_IN"] } },
      }),
      prisma.ticket.count({ where: { eventId: device.eventId, status: "CHECKED_IN" } }),
      prisma.checkin.groupBy({
        by: ["checkinPointId"],
        where: { eventId: device.eventId, status: "CONFIRMED" },
        _count: { _all: true },
      }),
      prisma.checkinPoint.findMany({
        where: { eventId: device.eventId },
        select: { id: true, name: true },
      }),
    ]);

    const nameById = new Map(points.map((p) => [p.id, p.name]));
    return {
      totalTickets: total,
      checkedIn,
      remaining: Math.max(total - checkedIn, 0),
      byGate: byPoint.map((p) => ({
        gate: p.checkinPointId ? (nameById.get(p.checkinPointId) ?? "Portão") : "Sem portão",
        count: p._count._all,
      })),
    };
  }

  /** Últimas entradas confirmadas do evento — alimenta o "Reverter" do resumo. */
  async recentCheckins(device: ValidatorDevice) {
    const rows = await prisma.checkin.findMany({
      where: { eventId: device.eventId, status: "CONFIRMED" },
      orderBy: { receivedAt: "desc" },
      take: 20,
      select: {
        id: true,
        scannedAt: true,
        ticket: { select: { code: true, attendeeName: true } },
        checkinPoint: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      checkinId: r.id,
      code: r.ticket.code,
      name: r.ticket.attendeeName,
      gate: r.checkinPoint?.name ?? null,
      at: r.scannedAt,
    }));
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
