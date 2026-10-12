import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { EventRecurrenceService, motivoParaNaoCopiarLote } from "../events/event-recurrence.service";
import { OrgAccessService } from "../common/org-access.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// Lote morto não atravessa edição (2026-10-12): "criar próxima edição" copiava
// todos os lotes, inclusive os que o cadastro de lote hoje recusa — "só balcão"
// de R$ 0 (a porta não emite cortesia e o site não mostra) e lote pago abaixo
// do mínimo que o banco aceita. Ninguém conseguiria comprar. Agora eles ficam
// de fora e a resposta diz quais e por quê.

// o mínimo vem do ambiente; o teste fixa o valor de produção (R$ 5,00)
process.env.PAYMENT_MIN_CHARGE_CENTS = "500";

const rand = () => Math.random().toString(36).slice(2, 10);

const base = { priceCents: 3000, feeCents: 300, feeMode: "BUYER", pdvOnly: false, halfPriceEnabled: false };

test("motivoParaNaoCopiarLote: só os lotes que o cadastro recusa ficam de fora", () => {
  // lote normal, grátis online e balcão pago: valem
  assert.equal(motivoParaNaoCopiarLote(base), null);
  assert.equal(motivoParaNaoCopiarLote({ ...base, priceCents: 0, feeCents: 0 }), null);
  assert.equal(motivoParaNaoCopiarLote({ ...base, pdvOnly: true, priceCents: 300, feeCents: 30 }), null);

  // só balcão de R$ 0
  assert.match(
    motivoParaNaoCopiarLote({ ...base, pdvOnly: true, priceCents: 0, feeCents: 0 }) ?? "",
    /só de balcão de R\$ 0/,
  );

  // pago abaixo do mínimo para o comprador (R$ 3 + R$ 1 de taxa = R$ 4)
  assert.match(motivoParaNaoCopiarLote({ ...base, priceCents: 300, feeCents: 100 }) ?? "", /abaixo do mínimo/);
  // com a taxa absorvida pelo produtor conta só o preço: R$ 4,50 não passa
  assert.match(
    motivoParaNaoCopiarLote({ ...base, priceCents: 450, feeCents: 100, feeMode: "PRODUCER" }) ?? "",
    /abaixo do mínimo/,
  );
  // a mesma taxa paga pelo comprador leva a R$ 5,50: passa
  assert.equal(motivoParaNaoCopiarLote({ ...base, priceCents: 450, feeCents: 100 }), null);

  // meia abaixo do mínimo (R$ 6 → meia R$ 3 + R$ 1 de taxa = R$ 4)
  assert.match(
    motivoParaNaoCopiarLote({ ...base, priceCents: 600, feeCents: 100, halfPriceEnabled: true }) ?? "",
    /meia-entrada sairia por/,
  );
});

test("próxima edição: pula o lote morto, copia o resto e diz o que ficou de fora", async () => {
  const fx = await createFixtureEvent({ lotCapacity: 50, priceCents: 4500, feeCents: 500 });
  const dono = await prisma.user.create({ data: { email: `dono-${rand()}@borafest.dev` } });
  await prisma.organizationMember.create({
    data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
  });
  const recurrence = new EventRecurrenceService(new OrgAccessService());
  try {
    // lotes antigos, de antes das travas do cadastro
    await prisma.ticketLot.create({
      data: { ticketTypeId: fx.ticketType.id, name: "Cortesia porta", priceCents: 0, feeCents: 0, capacity: 10, pdvOnly: true, status: "ACTIVE" },
    });
    await prisma.ticketLot.create({
      data: { ticketTypeId: fx.ticketType.id, name: "Promo R$ 3", priceCents: 300, feeCents: 100, capacity: 10, status: "ACTIVE" },
    });
    await prisma.ticketLot.create({
      data: { ticketTypeId: fx.ticketType.id, name: "Porta R$ 20", priceCents: 2000, feeCents: 0, capacity: 10, pdvOnly: true, status: "ACTIVE" },
    });

    const criada = await recurrence.nextEdition(fx.event.id, dono.id, { cadenceDays: 7, copyTicketCatalog: true });

    // copiados: o da fixture e o balcão pago; pulados: a cortesia de porta e a promo abaixo do mínimo
    assert.equal(criada.copiedLots, 2);
    assert.deepEqual(
      criada.skippedLots.map((s) => s.lotName).sort(),
      ["Cortesia porta", "Promo R$ 3"],
    );
    for (const pulado of criada.skippedLots) {
      assert.equal(pulado.ticketTypeName, fx.ticketType.name);
      assert.ok(pulado.reason.length > 0, "cada lote pulado diz o porquê");
    }

    const lotes = await prisma.ticketLot.findMany({
      where: { ticketType: { eventId: criada.id } },
      select: { name: true },
    });
    assert.deepEqual(lotes.map((l) => l.name).sort(), [fx.lot.name, "Porta R$ 20"].sort());

    // sem copiar o catálogo não há o que pular
    const semCatalogo = await recurrence.nextEdition(fx.event.id, dono.id, { cadenceDays: 14, copyTicketCatalog: false });
    assert.equal(semCatalogo.copiedLots, 0);
    assert.deepEqual(semCatalogo.skippedLots, []);
  } finally {
    await prisma.organizationMember.deleteMany({ where: { organizationId: fx.organization.id } });
    // as edições novas saem primeiro: o cleanup do helper limpa os lotes só do PRIMEIRO evento que achar
    await prisma.event.deleteMany({ where: { organizationId: fx.organization.id, id: { not: fx.event.id } } });
    await cleanupFixtureEvent(fx.organization.id);
    await prisma.user.delete({ where: { id: dono.id } }).catch(() => undefined);
  }
});
