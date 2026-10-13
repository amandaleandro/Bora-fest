import { test, after } from "node:test";
import assert from "node:assert/strict";
import { confirmSaleInventory, prisma, reserveInventory } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { EventRecurrenceService, filaDaViradaNaCopia } from "../events/event-recurrence.service";
import { OrgAccessService } from "../common/org-access.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// Virada atravessa a edição (2026-10-12): a cópia de lotes ("criar próxima
// edição" / duplicar) criava os lotes sem `activateAfterLotId` — o 2º lote da
// nova edição ficava guardado para sempre. Agora a fila é refeita com os ids
// novos, na mesma transação da cópia. Lote morto pulado passa a vez para o
// anterior dele (a regra do encerrar lote). Provado no banco.

// o mínimo vem do ambiente; o teste fixa o valor de produção (R$ 5,00)
process.env.PAYMENT_MIN_CHARGE_CENTS = "500";

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);

test("filaDaViradaNaCopia: refaz a fila com os ids novos", () => {
  const origem = [
    { id: "a", activateAfterLotId: null },
    { id: "b", activateAfterLotId: "a" },
    { id: "c", activateAfterLotId: "b" },
  ];
  const fila = filaDaViradaNaCopia(origem, new Map([["a", "A"], ["b", "B"], ["c", "C"]]));
  assert.deepEqual([...fila.entries()].sort(), [["B", "A"], ["C", "B"]]);
});

test("filaDaViradaNaCopia: anterior pulado passa a vez para o anterior dele", () => {
  const origem = [
    { id: "a", activateAfterLotId: null },
    { id: "b", activateAfterLotId: "a" }, // lote morto: não é copiado
    { id: "c", activateAfterLotId: "b" },
  ];
  const fila = filaDaViradaNaCopia(origem, new Map([["a", "A"], ["c", "C"]]));
  assert.deepEqual([...fila.entries()], [["C", "A"]]);

  // dois pulados em sequência: sobe até o primeiro copiado
  const longa = [...origem, { id: "d", activateAfterLotId: "c" }];
  const filaLonga = filaDaViradaNaCopia(longa, new Map([["a", "A"], ["d", "D"]]));
  assert.deepEqual([...filaLonga.entries()], [["D", "A"]]);
});

test("filaDaViradaNaCopia: sem anterior copiável, o lote fica sem virada (nunca espera lote que não existe)", () => {
  // o anterior pulado não esperava ninguém: não há para quem passar a vez
  assert.equal(
    filaDaViradaNaCopia(
      [
        { id: "a", activateAfterLotId: null },
        { id: "b", activateAfterLotId: "a" },
      ],
      new Map([["b", "B"]]),
    ).size,
    0,
  );
  // anterior que não é lote da edição de origem
  assert.equal(filaDaViradaNaCopia([{ id: "b", activateAfterLotId: "x" }], new Map([["b", "B"]])).size, 0);
  // fila que dá a volta só por lotes pulados não trava a cópia
  assert.equal(
    filaDaViradaNaCopia(
      [
        { id: "a", activateAfterLotId: "y" },
        { id: "y", activateAfterLotId: "z" },
        { id: "z", activateAfterLotId: "y" },
      ],
      new Map([["a", "A"]]),
    ).size,
    0,
  );
  // apontando para ele mesmo (dado torto): sem virada
  assert.equal(filaDaViradaNaCopia([{ id: "a", activateAfterLotId: "a" }], new Map([["a", "A"]])).size, 0);
  // lote não copiado não entra no resultado
  assert.equal(
    filaDaViradaNaCopia(
      [
        { id: "a", activateAfterLotId: null },
        { id: "b", activateAfterLotId: "a" },
      ],
      new Map([["a", "A"]]),
    ).size,
    0,
  );
});

test("próxima edição: a fila da virada vem junto, com os ids novos, e funciona na edição nova", async () => {
  // 1º lote da fixture: R$ 45 + R$ 5, ACTIVE
  const fx = await createFixtureEvent({ lotCapacity: 5, priceCents: 4500, feeCents: 500 });
  const dono = await prisma.user.create({ data: { email: `dono-rec-virada-${rand()}@borafest.dev` } });
  await prisma.organizationMember.create({
    data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
  });
  const recurrence = new EventRecurrenceService(new OrgAccessService());
  try {
    const lote = (name: string, activateAfterLotId: string | null, extra: Record<string, unknown> = {}) =>
      prisma.ticketLot.create({
        data: {
          ticketTypeId: fx.ticketType.id,
          name,
          priceCents: 3000,
          feeCents: 300,
          capacity: 10,
          status: "DRAFT",
          activateAfterLotId,
          ...extra,
        },
      });
    const segundo = await lote("2º lote", fx.lot.id);
    const terceiro = await lote("3º lote", segundo.id);
    // lote morto (balcão de R$ 0) no meio de uma fila: fica de fora e passa a vez
    const morto = await lote("Cortesia porta", fx.lot.id, { priceCents: 0, feeCents: 0, pdvOnly: true });
    const depoisDoMorto = await lote("Depois da cortesia", morto.id);

    const criada = await recurrence.nextEdition(fx.event.id, dono.id, { cadenceDays: 7, copyTicketCatalog: true });
    assert.equal(criada.copiedLots, 4);
    assert.deepEqual(criada.skippedLots.map((s) => s.lotName), ["Cortesia porta"]);

    const novos = await prisma.ticketLot.findMany({ where: { ticketType: { eventId: criada.id } } });
    const porNome = new Map(novos.map((l) => [l.name, l]));
    const n1 = porNome.get(fx.lot.name)!;
    const n2 = porNome.get("2º lote")!;
    const n3 = porNome.get("3º lote")!;
    const nDepois = porNome.get("Depois da cortesia")!;
    assert.ok(n1 && n2 && n3 && nDepois, "os 4 lotes vivos foram copiados");
    assert.ok(!porNome.has("Cortesia porta"));

    // ids novos, fila refeita com eles — nunca apontando para a edição antiga
    const idsAntigos = new Set([fx.lot.id, segundo.id, terceiro.id, morto.id, depoisDoMorto.id]);
    for (const novo of novos) {
      assert.ok(!idsAntigos.has(novo.id), "lote novo tem id novo");
      assert.equal(novo.status, "DRAFT", "tudo nasce guardado");
      if (novo.activateAfterLotId) {
        assert.ok(!idsAntigos.has(novo.activateAfterLotId), "nenhum lote novo espera lote da edição antiga");
      }
    }
    assert.equal(n1.activateAfterLotId, null, "o 1º lote não espera ninguém");
    assert.equal(n2.activateAfterLotId, n1.id, "o 2º espera o 1º da edição nova");
    assert.equal(n3.activateAfterLotId, n2.id, "o 3º espera o 2º da edição nova");
    assert.equal(nDepois.activateAfterLotId, n1.id, "quem esperava o lote morto passa a esperar o anterior dele");

    // a edição de origem não muda
    assert.equal((await prisma.ticketLot.findUniqueOrThrow({ where: { id: segundo.id } })).activateAfterLotId, fx.lot.id);
    assert.equal((await prisma.ticketLot.findUniqueOrThrow({ where: { id: terceiro.id } })).activateAfterLotId, segundo.id);

    // rastro da cópia, na mesma transação
    const rastro = await prisma.auditLog.findFirst({ where: { entityId: criada.id, action: "event.duplicate" } });
    assert.ok(rastro, "a cópia deixa rastro");
    assert.equal(rastro!.actorUserId, dono.id);
    assert.equal(rastro!.organizationId, fx.organization.id);
    const meta = rastro!.metadata as Record<string, unknown>;
    assert.equal(meta.copiedFromEventId, fx.event.id);
    assert.equal(meta.copiedLots, 4);
    assert.equal(meta.lotesComVirada, 3);

    // A FILA FUNCIONA NA EDIÇÃO NOVA: o produtor abre o 1º; esgotou, abrem os
    // que esperavam por ele (2º e o de depois da cortesia) — o 3º segue guardado
    await prisma.ticketLot.update({ where: { id: n1.id }, data: { status: "ACTIVE" } });
    await prisma.$transaction(async (tx) => {
      await reserveInventory(tx, n1.id, n1.capacity);
      await confirmSaleInventory(tx, n1.id, n1.capacity);
    });
    const depois = new Map(
      (await prisma.ticketLot.findMany({ where: { ticketType: { eventId: criada.id } } })).map((l) => [l.id, l.status]),
    );
    assert.equal(depois.get(n2.id), "ACTIVE");
    assert.equal(depois.get(nDepois.id), "ACTIVE");
    assert.equal(depois.get(n3.id), "DRAFT", "o 3º espera o 2º esgotar");

    // a edição de origem não foi tocada pela virada da nova
    assert.equal((await prisma.ticketLot.findUniqueOrThrow({ where: { id: segundo.id } })).status, "DRAFT");

    // sem copiar o catálogo: nada de lote, nada de fila, e o rastro diz isso
    const semCatalogo = await recurrence.nextEdition(fx.event.id, dono.id, { cadenceDays: 14, copyTicketCatalog: false });
    assert.equal(semCatalogo.copiedLots, 0);
    const rastroSem = await prisma.auditLog.findFirst({ where: { entityId: semCatalogo.id, action: "event.duplicate" } });
    assert.equal((rastroSem!.metadata as Record<string, unknown>).lotesComVirada, 0);
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: fx.organization.id } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: fx.organization.id } });
    // as edições novas saem primeiro: o cleanup do helper limpa os lotes só do PRIMEIRO evento que achar
    await prisma.event.deleteMany({ where: { organizationId: fx.organization.id, id: { not: fx.event.id } } });
    await cleanupFixtureEvent(fx.organization.id);
    await prisma.user.delete({ where: { id: dono.id } }).catch(() => undefined);
  }
});
