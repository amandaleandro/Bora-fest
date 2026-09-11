import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { OrgAccessService } from "../common/org-access.service";
import { EventDuplicationService } from "../events/event-duplication.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

const duplication = new EventDuplicationService(new OrgAccessService());

async function createOwner(organizationId: string, roleId: string) {
  const user = await prisma.user.create({
    data: { email: `n3-edge-${Math.random().toString(36).slice(2, 10)}@borafest.dev` },
  });
  await prisma.organizationMember.create({
    data: { organizationId, userId: user.id, roleId, status: "ACTIVE" },
  });
  return user;
}

describe("N3 — bordas da recorrência", () => {
  it("recorrência mensal de dia 31 usa o último dia quando o mês é menor", async () => {
    const fixture = await createFixtureEvent({ lotCapacity: 10 });
    const owner = await createOwner(fixture.organization.id, fixture.ownerRoleId);

    try {
      const sourceStart = new Date("2027-01-31T22:00:00.000Z");
      const sourceEnd = new Date("2027-02-01T02:00:00.000Z");
      await prisma.event.update({
        where: { id: fixture.event.id },
        data: { startsAt: sourceStart, endsAt: sourceEnd },
      });

      const result = await duplication.duplicate(fixture.event.id, owner.id, {
        cadence: "MONTHLY",
        copyTickets: false,
        copyAddOns: false,
        copySalesPartners: false,
        copyCheckinPoints: false,
        copyMarketing: false,
      });

      assert.equal(result.event.startsAt.getUTCFullYear(), 2027);
      assert.equal(result.event.startsAt.getUTCMonth(), 1, "fevereiro");
      assert.equal(result.event.startsAt.getUTCDate(), 28, "31/jan vira o último dia de fevereiro, não março");
      assert.equal(result.event.startsAt.getUTCHours(), 22);
      assert.equal(result.event.endsAt.getTime() - result.event.startsAt.getTime(), 4 * 60 * 60_000);
    } finally {
      await cleanupFixtureEvent(fixture.organization.id);
      await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    }
  });

  it("mantém lote exclusivo de promoter em rascunho quando não há promoter global", async () => {
    const fixture = await createFixtureEvent({ lotCapacity: 30 });
    const owner = await createOwner(fixture.organization.id, fixture.ownerRoleId);

    try {
      await prisma.ticketLot.update({
        where: { id: fixture.lot.id },
        data: { promoterOnly: true, status: "ACTIVE" },
      });

      const result = await duplication.duplicate(fixture.event.id, owner.id, {
        cadence: "WEEKLY",
        copyTickets: true,
        copyAddOns: false,
        copySalesPartners: false,
        copyCheckinPoints: false,
        copyMarketing: false,
      });

      const lot = await prisma.ticketLot.findFirstOrThrow({
        where: { ticketType: { eventId: result.event.id } },
      });
      assert.equal(lot.promoterOnly, true, "regra comercial não é silenciosamente removida");
      assert.equal(lot.status, "DRAFT", "não fica ativo sem promoter que possa acessá-lo");
      assert.equal(result.warnings.length, 1);
      assert.match(result.warnings[0] ?? "", /promoter/i);
    } finally {
      await cleanupFixtureEvent(fixture.organization.id);
      await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    }
  });
});
