import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { after, before, describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { updateOrganizationPublicProfileSchema } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";
import { HousesService } from "../houses/houses.service";
import { OrganizationProfileService } from "../organization-profile/organization-profile.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

let fixture: Awaited<ReturnType<typeof createFixtureEvent>>;
let actorId = "";
let outsiderId = "";

const service = new OrganizationProfileService(new OrgAccessService());
const houses = new HousesService();

describe("N1.1 — identidade pública da Casa", () => {
  before(async () => {
    fixture = await createFixtureEvent({ lotCapacity: 100, priceCents: 4000, feeCents: 400 });

    const actor = await prisma.user.create({
      data: { email: `perfil-casa-${Math.random().toString(36).slice(2)}@example.com` },
    });
    actorId = actor.id;
    await prisma.organizationMember.create({
      data: {
        organizationId: fixture.organization.id,
        userId: actor.id,
        roleId: fixture.ownerRoleId,
        status: "ACTIVE",
        joinedAt: new Date(),
      },
    });

    const outsider = await prisma.user.create({
      data: { email: `perfil-outsider-${Math.random().toString(36).slice(2)}@example.com` },
    });
    outsiderId = outsider.id;
  });

  after(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: fixture.organization.id } });
    await cleanupFixtureEvent(fixture.organization.id);
    await prisma.user.delete({ where: { id: actorId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: outsiderId } }).catch(() => undefined);
  });

  it("salva a identidade na própria Organization", async () => {
    const updated = await service.updateProfile(fixture.organization.id, actorId, {
      displayName: "Clube Horizonte",
      bio: "Música, encontros e experiências no coração da cidade.",
      instagramUrl: "https://instagram.com/clubehorizonte",
      websiteUrl: "https://clubehorizonte.example.com",
    });

    assert.equal(updated.displayName, "Clube Horizonte");
    assert.equal(updated.bio, "Música, encontros e experiências no coração da cidade.");
    assert.equal(updated.instagramUrl, "https://instagram.com/clubehorizonte");
    assert.equal(updated.websiteUrl, "https://clubehorizonte.example.com");

    const stored = await prisma.organization.findUniqueOrThrow({ where: { id: fixture.organization.id } });
    assert.equal(stored.bio, updated.bio);
    assert.equal(stored.instagramUrl, updated.instagramUrl);
  });

  it("expõe bio e redes no perfil permanente da Casa", async () => {
    const profile = await houses.getPublicHouse(fixture.organization.slug);
    assert.equal(profile.name, "Clube Horizonte");
    assert.equal(profile.bio, "Música, encontros e experiências no coração da cidade.");
    assert.equal(profile.instagramUrl, "https://instagram.com/clubehorizonte");
    assert.equal(profile.websiteUrl, "https://clubehorizonte.example.com");
  });

  it("aceita apenas links públicos http/https", () => {
    assert.equal(
      updateOrganizationPublicProfileSchema.safeParse({ websiteUrl: "https://clube.example.com" }).success,
      true,
    );
    assert.equal(
      updateOrganizationPublicProfileSchema.safeParse({ instagramUrl: "javascript:alert(1)" }).success,
      false,
    );
    assert.equal(
      updateOrganizationPublicProfileSchema.safeParse({ websiteUrl: "data:text/html;base64,SGVsbG8=" }).success,
      false,
    );
  });

  it("rejeita upload truncado pelo limite multipart", async () => {
    const stream = Readable.from([Buffer.from([0xff, 0xd8, 0xff])]) as Readable & { truncated?: boolean };
    stream.truncated = true;

    await assert.rejects(
      () => service.uploadImage(fixture.organization.id, actorId, "logo", { file: stream }),
      /no máximo 5 MB/,
    );
  });

  it("não deixa usuário de fora editar a identidade", async () => {
    await assert.rejects(
      () => service.updateProfile(fixture.organization.id, outsiderId, { bio: "tentativa" }),
      /Sem permissão/,
    );
  });
});
