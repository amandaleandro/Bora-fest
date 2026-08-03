import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { randomBytes } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { PERMISSIONS } from "@borafest/auth";
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

    return prisma.event.create({
      data: {
        organizationId,
        venueId: input.venueId,
        title: input.title,
        slug,
        description: input.description,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        timezone: input.timezone,
      },
    });
  }

  async listForOrganization(organizationId: string, actorUserId: string) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    return prisma.event.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
  }

  async update(eventId: string, actorUserId: string, input: UpdateEventInput) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");

    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    return prisma.event.update({
      where: { id: eventId },
      data: {
        title: input.title,
        description: input.description,
        bannerUrl: input.bannerUrl,
        venueId: input.venueId,
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

    return prisma.event.update({
      where: { id: eventId },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
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
}
