import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { randomBytes } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { PERMISSIONS } from "@borafest/auth";
import { getEmailSender } from "@borafest/notifications";
import type { CreateEventInput, UpdateEventInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";
import { UPLOADS_DIR } from "../uploads/uploads.constants";

/** Assinatura (magic bytes) dos formatos aceitos — mimetype do multipart é só o que o cliente alegou. */
const MAGIC_BYTES: Record<string, { ext: string; signature: number[]; offset?: number }> = {
  "image/jpeg": { ext: "jpg", signature: [0xff, 0xd8, 0xff] },
  "image/png": { ext: "png", signature: [0x89, 0x50, 0x4e, 0x47] },
  "image/webp": { ext: "webp", signature: [0x57, 0x45, 0x42, 0x50], offset: 8 },
};

function detectImageExt(head: Buffer): string | null {
  for (const { ext, signature, offset = 0 } of Object.values(MAGIC_BYTES)) {
    if (head.length >= offset + signature.length) {
      const matches = signature.every((byte, i) => head[offset + i] === byte);
      if (matches) return ext;
    }
  }
  return null;
}

function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

@Injectable()
export class EventsService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  async create(organizationId: string, actorUserId: string, input: CreateEventInput) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    const slug = `${slugify(input.title)}-${Math.random().toString(36).slice(2, 7)}`;

    // local inline: reaproveita o mesmo (nome+cidade) da organização ou cria
    const venueId = input.venue
      ? (await this.upsertVenue(organizationId, input.venue)).id
      : input.venueId;

    return prisma.event.create({
      data: {
        organizationId,
        venueId,
        title: input.title,
        slug,
        description: input.description,
        lineup: input.lineup,
        amenities: input.amenities,
        minAge: input.minAge,
        category: input.category,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        timezone: input.timezone,
      },
    });
  }

  async listForOrganization(organizationId: string, actorUserId: string) {
    try {
      await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);
    } catch {
      await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.SALES_PERFORM);
    }

    return prisma.event.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
  }

  async update(eventId: string, actorUserId: string, input: UpdateEventInput) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");

    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    const venueId = input.venue
      ? (await this.upsertVenue(event.organizationId, input.venue)).id
      : input.venueId;

    // merge parcial: enviar só um pixel (ex. metaPixelId) não deve apagar os outros já salvos
    const pixelSettings = input.pixelSettings
      ? { ...(event.pixelSettings as Record<string, string> | null), ...input.pixelSettings }
      : undefined;

    return prisma.event.update({
      where: { id: eventId },
      data: {
        title: input.title,
        description: input.description,
        lineup: input.lineup,
        amenities: input.amenities,
        minAge: input.minAge,
        category: input.category,
        bannerUrl: input.bannerUrl,
        waitingRoomEnabled: input.waitingRoomEnabled,
        waitingRoomConcurrency: input.waitingRoomConcurrency,
        pixelSettings,
        venueId,
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
        timezone: input.timezone,
      },
    });
  }

  async publish(eventId: string, actorUserId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");

    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_PUBLISH);

    if (event.status !== "DRAFT") {
      return event;
    }

    const published = await prisma.event.update({
      where: { id: eventId },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });

    // melhor esforço — não bloqueia a publicação se o envio falhar
    this.notifyFollowers(published).catch(() => undefined);

    return published;
  }

  private async notifyFollowers(event: { id: string; organizationId: string; title: string; slug: string }) {
    const [followers, organization] = await Promise.all([
      prisma.organizationFollow.findMany({
        where: { organizationId: event.organizationId },
        include: { user: { select: { email: true } } },
      }),
      prisma.organization.findUnique({ where: { id: event.organizationId }, select: { name: true } }),
    ]);
    const recipients = followers.map((f) => f.user.email).filter((email): email is string => !!email);
    if (recipients.length === 0) return;

    const webBaseUrl = process.env.WEB_BASE_URL ?? "http://localhost:3000";
    const link = `${webBaseUrl}/evento/${event.slug}`;
    const sender = getEmailSender();
    await Promise.allSettled(
      recipients.map((to) =>
        sender.send({
          to,
          subject: `${organization?.name ?? "Um produtor que você segue"} publicou um novo evento`,
          html: `<p>${event.title} já está com vendas abertas.</p><p><a href="${link}">${link}</a></p>`,
          text: `${event.title} já está com vendas abertas: ${link}`,
        }),
      ),
    );
  }

  /** Despublicar = pausar vendas (máquina de estados §9: PUBLISHED → SALES_PAUSED). */
  async unpublish(eventId: string, actorUserId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");

    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_PUBLISH);

    if (event.status !== "PUBLISHED") {
      return event;
    }

    return prisma.event.update({
      where: { id: eventId },
      data: { status: "SALES_PAUSED" },
    });
  }

  /** Republicar depois de pausar (SALES_PAUSED → PUBLISHED). */
  async republish(eventId: string, actorUserId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");

    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_PUBLISH);

    if (event.status !== "SALES_PAUSED") {
      return event;
    }

    return prisma.event.update({
      where: { id: eventId },
      data: { status: "PUBLISHED" },
    });
  }

  /**
   * Banner por upload de arquivo (decisão 2026-08-01: URL colada não presta —
   * produtor escolhe a imagem no aparelho). Limites: 5 MB, jpeg/png/webp.
   */
  async uploadBanner(
    eventId: string,
    actorUserId: string,
    file: { mimetype: string; filename: string; file: NodeJS.ReadableStream },
  ) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    const chunks: Buffer[] = [];
    for await (const chunk of file.file as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks);

    // extensão vem do conteúdo real do arquivo, não do mimetype alegado pelo
    // cliente na parte multipart (fácil de forjar)
    const ext = detectImageExt(content);
    if (!ext) {
      throw new BadRequestException("Formato inválido — use JPG, PNG ou WebP");
    }

    const name = `evento-${eventId}-${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
    await writeFile(join(UPLOADS_DIR, name), content);

    // remove o banner anterior deste evento para não acumular arquivo órfão
    if (event.bannerUrl) {
      const previousName = basename(event.bannerUrl);
      await unlink(join(UPLOADS_DIR, previousName)).catch(() => undefined);
    }

    const base = process.env.API_PUBLIC_URL ?? "http://localhost:3333";
    const bannerUrl = `${base}/uploads/${name}`;
    await prisma.event.update({ where: { id: eventId }, data: { bannerUrl } });
    return { bannerUrl };
  }

  /** Um Venue por (organização, nome, cidade) — evita duplicar a cada edição. */
  private async upsertVenue(
    organizationId: string,
    venue: { name: string; address?: string; mapsUrl?: string; city: string; state: string },
  ) {
    const existing = await prisma.venue.findFirst({
      where: {
        organizationId,
        name: { equals: venue.name, mode: "insensitive" },
        city: { equals: venue.city, mode: "insensitive" },
      },
    });
    const state = venue.state.toUpperCase();
    if (existing) {
      return prisma.venue.update({
        where: { id: existing.id },
        data: { address: venue.address, mapsUrl: venue.mapsUrl, state },
      });
    }
    return prisma.venue.create({ data: { organizationId, ...venue, state } });
  }
}
