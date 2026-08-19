import { randomBytes } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { BadRequestException, Injectable } from "@nestjs/common";
import { PlatformAccessService } from "../common/platform-access.service";
import { UPLOADS_DIR } from "../uploads/uploads.constants";

/**
 * Banner de divulgação da home (pedido do Arthur 2026-08-17): o admin anexa
 * UMA arte pro desktop e OUTRA pro mobile (proporções diferentes) e troca
 * quando quiser. Sem tabela nova: um banners.json no volume de uploads guarda
 * o ponteiro; os arquivos ganham nome único por upload, então o cache imutável
 * de 1 ano do /uploads continua válido.
 */
const SLOTS = ["desktop", "mobile"] as const;
type Slot = (typeof SLOTS)[number];

const POINTER_FILE = join(UPLOADS_DIR, "banners.json");

const MAGIC_BYTES: Array<{ ext: string; signature: number[]; offset?: number }> = [
  { ext: "jpg", signature: [0xff, 0xd8, 0xff] },
  { ext: "png", signature: [0x89, 0x50, 0x4e, 0x47] },
  { ext: "webp", signature: [0x57, 0x45, 0x42, 0x50], offset: 8 },
];

function detectImageExt(head: Buffer): string | null {
  for (const { ext, signature, offset = 0 } of MAGIC_BYTES) {
    if (head.length >= offset + signature.length && signature.every((b, i) => head[offset + i] === b)) {
      return ext;
    }
  }
  return null;
}

function assertSlot(slot: string): asserts slot is Slot {
  if (!SLOTS.includes(slot as Slot)) {
    throw new BadRequestException("Slot inválido — use 'desktop' ou 'mobile'");
  }
}

@Injectable()
export class BannersService {
  constructor(private readonly platformAccess: PlatformAccessService) {}

  private async readPointer(): Promise<Partial<Record<Slot, string>>> {
    try {
      return JSON.parse(await readFile(POINTER_FILE, "utf8"));
    } catch {
      return {};
    }
  }

  private async writePointer(pointer: Partial<Record<Slot, string>>): Promise<void> {
    await writeFile(POINTER_FILE, JSON.stringify(pointer));
  }

  /** URLs atuais pro site — null quando o slot está sem arte (o site usa o fallback). */
  async getPublic(): Promise<{ desktopUrl: string | null; mobileUrl: string | null }> {
    const pointer = await this.readPointer();
    const base = process.env.API_PUBLIC_URL ?? "http://localhost:3333";
    return {
      desktopUrl: pointer.desktop ? `${base}/uploads/${pointer.desktop}` : null,
      mobileUrl: pointer.mobile ? `${base}/uploads/${pointer.mobile}` : null,
    };
  }

  async upload(slot: string, actorUserId: string, file: { file: AsyncIterable<Buffer> }) {
    assertSlot(slot);
    await this.platformAccess.assertAdmin(actorUserId);

    const chunks: Buffer[] = [];
    for await (const chunk of file.file) chunks.push(chunk);
    const content = Buffer.concat(chunks);

    const ext = detectImageExt(content);
    if (!ext) throw new BadRequestException("Formato inválido — use JPG, PNG ou WebP");

    const name = `promo-${slot}-${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
    await writeFile(join(UPLOADS_DIR, name), content);

    const pointer = await this.readPointer();
    if (pointer[slot]) {
      await unlink(join(UPLOADS_DIR, basename(pointer[slot]!))).catch(() => undefined);
    }
    pointer[slot] = name;
    await this.writePointer(pointer);
    return this.getPublic();
  }

  async remove(slot: string, actorUserId: string) {
    assertSlot(slot);
    await this.platformAccess.assertAdmin(actorUserId);

    const pointer = await this.readPointer();
    if (pointer[slot]) {
      await unlink(join(UPLOADS_DIR, basename(pointer[slot]!))).catch(() => undefined);
      delete pointer[slot];
      await this.writePointer(pointer);
    }
    return this.getPublic();
  }
}
