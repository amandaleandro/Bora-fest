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
      let year = new Date().getUTCFullYear();
      let sourceStart = new Date(Date.UTC(year, 0, 31, 22, 0, 0));
      if (sourceStart.getTime() <= Date.now()) {
        year += 1;
        sourceStart = new Date(Date.UTC(year, 0, 31, 22, 0, 0));
      }
      const sourceEnd = new Date(sourceStart.getTime() + 4 * 60 * 60_000);
      const februaryLastDay = new Date(Date.UTC(year, 2, 0)).getUTCDate();

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

      assert.equal(result.event.startsAt.getUTCFullYear(), year);
      assert.equal(result.event.startsAt.getUTCMonth(), 1, "fevereiro");
      assert.equal(
        result.event.startsAt.getUTCDate(),
        februaryLastDay,
        "31/jan vira o último dia de fevereiro, não março",
      );
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

  it("mantém lote agendado em rascunho porque não há autoativação por relógio", async () => {
    const fixture = await createFixtureEvent({ lotCapacity: 30 });
    const owner = await createOwner(fixture.organization.id, fixture.ownerRoleId);

    try {
      await prisma.ticketLot.update({
        where: { id: fixture.lot.id },
        data: {
          status: "SCHEDULED",
          startsAt: new Date(fixture.event.startsAt.getTime() - 2 * 86_400_000),
          endsAt: new Date(fixture.event.startsAt.getTime() + 2 * 60 * 60_000),
        },
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
      assert.equal(lot.status, "DRAFT");
      assert.ok(lot.startsAt && lot.startsAt.getTime() > Date.now(), "a janela deslocada continua disponível para revisão");
      assert.match(result.warnings.join(" "), /agendados/i);
    } finally {
      await cleanupFixtureEvent(fixture.organization.id);
      await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    }
  });

  it("não reabre lote cuja janela deslocada já terminou", async () => {
    const fixture = await createFixtureEvent({ lotCapacity: 30 });
    const owner = await createOwner(fixture.organization.id, fixture.ownerRoleId);

    try {
      const sourceLotEnd = new Date(fixture.event.startsAt.getTime() - 30 * 86_400_000);
      await prisma.ticketLot.update({
        where: { id: fixture.lot.id },
        data: { status: "ACTIVE", endsAt: sourceLotEnd },
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
      assert.ok(lot.endsAt && lot.endsAt.getTime() <= Date.now(), "a janela continua historicamente vencida");
      assert.equal(lot.status, "DRAFT", "uma janela vencida nunca volta ativa silenciosamente");
      assert.match(result.warnings.join(" "), /janelas de lote/i);
    } finally {
      await cleanupFixtureEvent(fixture.organization.id);
      await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    }
  });
});
