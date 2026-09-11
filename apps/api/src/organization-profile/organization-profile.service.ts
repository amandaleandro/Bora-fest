import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import type { UpdateOrganizationPublicProfileInput } from "@borafest/contracts";
import { randomBytes } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import sharp from "sharp";
import { OrgAccessService } from "../common/org-access.service";
import { UPLOADS_DIR } from "../uploads/uploads.constants";

const MAGIC_BYTES: Array<{ signature: number[]; offset?: number }> = [
  { signature: [0xff, 0xd8, 0xff] },
  { signature: [0x89, 0x50, 0x4e, 0x47] },
  { signature: [0x57, 0x45, 0x42, 0x50], offset: 8 },
];

function isSupportedImage(content: Buffer): boolean {
  return MAGIC_BYTES.some(({ signature, offset = 0 }) =>
    content.length >= offset + signature.length && signature.every((byte, index) => content[offset + index] === byte),
  );
}

const PROFILE_SELECT = {
  id: true,
  name: true,
  displayName: true,
  slug: true,
  producerType: true,
  bio: true,
  logoUrl: true,
  coverUrl: true,
  instagramUrl: true,
  websiteUrl: true,
} as const;

@Injectable()
export class OrganizationProfileService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  private async assertCanManage(organizationId: string, actorUserId: string) {
    await this.orgAccess.assertPermission(
      organizationId,
      actorUserId,
      PERMISSIONS.ORG_MANAGE_MEMBERS,
    );
  }

  async getProfile(organizationId: string, actorUserId: string) {
    await this.assertCanManage(organizationId, actorUserId);
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: PROFILE_SELECT,
    });
    if (!organization) throw new NotFoundException("Organização não encontrada");
    return organization;
  }

  async updateProfile(
    organizationId: string,
    actorUserId: string,
    input: UpdateOrganizationPublicProfileInput,
  ) {
    await this.assertCanManage(organizationId, actorUserId);

    const [updated] = await prisma.$transaction([
      prisma.organization.update({
        where: { id: organizationId },
        data: {
          displayName: input.displayName === undefined ? undefined : input.displayName,
          bio: input.bio === undefined ? undefined : input.bio,
          instagramUrl: input.instagramUrl === undefined ? undefined : input.instagramUrl,
          websiteUrl: input.websiteUrl === undefined ? undefined : input.websiteUrl,
        },
        select: PROFILE_SELECT,
      }),
      prisma.auditLog.create({
        data: {
          actorUserId,
          organizationId,
          action: "organization.public_profile.updated",
          entityType: "organization",
          entityId: organizationId,
          metadata: {
            fields: Object.keys(input).filter((key) => input[key as keyof typeof input] !== undefined),
          },
        },
      }),
    ]);

    return updated;
  }

  async uploadImage(
    organizationId: string,
    actorUserId: string,
    kind: string,
    file: { file: NodeJS.ReadableStream & { truncated?: boolean } },
  ) {
    if (kind !== "logo" && kind !== "cover") {
      throw new BadRequestException("Tipo de imagem inválido — use logo ou cover");
    }
    await this.assertCanManage(organizationId, actorUserId);

    const exists = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException("Organização não encontrada");

    const chunks: Buffer[] = [];
    for await (const chunk of file.file as AsyncIterable<Buffer>) chunks.push(chunk);
    if (file.file.truncated) {
      throw new BadRequestException("A imagem deve ter no máximo 5 MB");
    }

    const content = Buffer.concat(chunks);
    if (!isSupportedImage(content)) {
      throw new BadRequestException("Formato inválido — use JPG, PNG ou WebP");
    }

    let processed: Buffer;
    try {
      const pipeline = sharp(content, { limitInputPixels: 30_000_000 }).rotate();
      processed = kind === "logo"
        ? await pipeline.resize({ width: 800, height: 800, fit: "cover" }).webp({ quality: 84 }).toBuffer()
        : await pipeline.resize({ width: 1600, height: 900, fit: "cover" }).webp({ quality: 82 }).toBuffer();
    } catch {
      throw new BadRequestException("Não consegui ler a imagem — tente outro arquivo");
    }

    const prefix = `organization-${organizationId}-${kind}-`;
    const name = `${prefix}${Date.now()}-${randomBytes(4).toString("hex")}.webp`;
    const filepath = join(UPLOADS_DIR, name);
    await writeFile(filepath, processed);

    const base = process.env.API_PUBLIC_URL ?? "http://localhost:3333";
    const imageUrl = `${base}/uploads/${name}`;

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Serializa alterações de identidade da mesma organização inclusive
        // entre réplicas da API. A linha fica travada até o commit.
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE
        `;
        if (locked.length === 0) throw new NotFoundException("Organização não encontrada");

        const current = await tx.organization.findUniqueOrThrow({
          where: { id: organizationId },
          select: { logoUrl: true, coverUrl: true },
        });
        const previousUrl = kind === "logo" ? current.logoUrl : current.coverUrl;

        const updated = await tx.organization.update({
          where: { id: organizationId },
          data: kind === "logo" ? { logoUrl: imageUrl } : { coverUrl: imageUrl },
          select: PROFILE_SELECT,
        });
        await tx.auditLog.create({
          data: {
            actorUserId,
            organizationId,
            action: `organization.public_profile.${kind}_uploaded`,
            entityType: "organization",
            entityId: organizationId,
          },
        });

        return { updated, previousUrl };
      });

      if (result.previousUrl) {
        const previousName = basename(result.previousUrl);
        if (previousName.startsWith(prefix)) {
          await unlink(join(UPLOADS_DIR, previousName)).catch(() => undefined);
        }
      }

      return result.updated;
    } catch (error) {
      await unlink(filepath).catch(() => undefined);
      throw error;
    }
  }
}
