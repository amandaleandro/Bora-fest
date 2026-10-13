import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { GuestListService } from "../guest-list/guest-list.service";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// Virada automática pela LISTA DE CONVIDADOS (2026-10-12). O InventoryService
// fazia o próprio UPDATE de vendidos e não abria o lote seguinte: a lista que
// esgotava o 1º lote deixava o 2º guardado para sempre. Agora confirmSale usa a
// operação única de @borafest/database (a mesma do pagamento) — venda e
// virada na mesma transação, ou nenhuma. Toda garantia é provada no banco.

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);

/** CPF válido aleatório: a lista exige CPF (contracts/guest-list.ts). */
function geraCpf(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (base: number[]) => {
    const soma = base.reduce((acc, d, i) => acc + d * (base.length + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  const d2 = dv([...n, d1]);
  return [...n, d1, d2].join("");
}

const convidado = (ticketLotId: string, guestName: string) => ({ ticketLotId, guestName, guestDocument: geraCpf() });

async function montar(capacidade: number) {
  // evento amanhã: a lista fecha quando o evento começa
  const fx = await createFixtureEvent({ lotCapacity: capacidade, priceCents: 0, feeCents: 0 });
  const dono = await prisma.user.create({ data: { email: `dono-virada-lista-${rand()}@borafest.dev` } });
  await prisma.organizationMember.create({
    data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
  });
  return { fx, dono };
}
type Ctx = Awaited<ReturnType<typeof montar>>;

async function desmontar(ctx: Ctx) {
  const organizationId = ctx.fx.organization.id;
  const pedidos = await prisma.order.findMany({ where: { eventId: ctx.fx.event.id }, select: { id: true } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: pedidos.map((p) => p.id) } } });
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.organizationMember.deleteMany({ where: { organizationId } });
  await cleanupFixtureEvent(organizationId);
  await prisma.user.delete({ where: { id: ctx.dono.id } }).catch(() => undefined);
}

/** Lote guardado (DRAFT) que abre quando `anteriorId` esgotar. */
function loteGuardado(ctx: Ctx, anteriorId: string, nome = `2º lote ${rand()}`) {
  return prisma.ticketLot.create({
    data: {
      ticketTypeId: ctx.fx.ticketType.id,
      name: nome,
      priceCents: 0,
      feeCents: 0,
      capacity: 10,
      status: "DRAFT",
      activateAfterLotId: anteriorId,
    },
  });
}

const lote = (id: string) => prisma.ticketLot.findUniqueOrThrow({ where: { id } });

const viradas = (loteId: string) =>
  prisma.auditLog.findMany({ where: { entityId: loteId, action: "lot.activate" } });

test("lista de convidados que esgota o lote abre o lote seguinte, com rastro sem ator", async () => {
  const ctx = await montar(2);
  const lista = new GuestListService(new OrgAccessService(), new InventoryService());
  try {
    const segundo = await loteGuardado(ctx, ctx.fx.lot.id, "2º lote");

    await lista.create(ctx.dono.id, ctx.fx.event.id, convidado(ctx.fx.lot.id, "Convidada Um"));
    assert.equal((await lote(ctx.fx.lot.id)).soldCount, 1);
    assert.equal((await lote(segundo.id)).status, "DRAFT", "com vaga sobrando, o 2º lote segue guardado");
    assert.equal((await viradas(segundo.id)).length, 0);

    await lista.create(ctx.dono.id, ctx.fx.event.id, convidado(ctx.fx.lot.id, "Convidado Dois"));
    const primeiro = await lote(ctx.fx.lot.id);
    assert.equal(primeiro.soldCount, 2);
    assert.equal(primeiro.reservedCount, 0, "a lista reserva e confirma: nada fica preso como reservado");
    assert.equal((await lote(segundo.id)).status, "ACTIVE", "o convidado que esgotou o 1º lote abriu o 2º");

    const rastro = await viradas(segundo.id);
    assert.equal(rastro.length, 1, "um registro de virada");
    assert.equal(rastro[0].actorUserId, null, "foi o sistema, não uma pessoa");
    assert.equal(rastro[0].organizationId, ctx.fx.organization.id);
    const meta = rastro[0].metadata as Record<string, unknown>;
    assert.equal(meta.motivo, "virada automática");
    assert.equal(meta.anterior, ctx.fx.lot.id);
    assert.equal(meta.gatilho, "esgotado");

    // o 1º lote está cheio: a lista recusa com a mensagem de sempre e nada muda
    await assert.rejects(
      () => lista.create(ctx.dono.id, ctx.fx.event.id, convidado(ctx.fx.lot.id, "Convidado Três")),
      /Lista cheia/,
    );
    assert.equal((await lote(ctx.fx.lot.id)).soldCount, 2);
    assert.equal((await viradas(segundo.id)).length, 1, "recusa não grava virada de novo");

    // o 2º lote (agora aberto) recebe convidado normalmente
    await lista.create(ctx.dono.id, ctx.fx.event.id, convidado(segundo.id, "Convidada Quatro"));
    assert.equal((await lote(segundo.id)).soldCount, 1);
  } finally {
    await desmontar(ctx);
  }
});

test("InventoryService.confirmSale: venda e virada caem juntas se a transação de quem chama falha", async () => {
  const ctx = await montar(1);
  const estoque = new InventoryService();
  try {
    const segundo = await loteGuardado(ctx, ctx.fx.lot.id);

    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          await estoque.tryReserve(ctx.fx.lot.id, 1, tx);
          await estoque.confirmSale(ctx.fx.lot.id, 1, tx);
          // dentro da transação, a virada já aconteceu junto com a venda
          const aberto = await tx.ticketLot.findUniqueOrThrow({ where: { id: segundo.id } });
          assert.equal(aberto.status, "ACTIVE");
          throw new Error("falha depois da venda");
        }),
      /falha depois da venda/,
    );

    const primeiro = await lote(ctx.fx.lot.id);
    assert.equal(primeiro.soldCount, 0, "a venda desfeita não conta");
    assert.equal(primeiro.reservedCount, 0, "nem a reserva");
    assert.equal((await lote(segundo.id)).status, "DRAFT", "a virada foi desfeita junto");
    assert.equal((await viradas(segundo.id)).length, 0, "e o registro também");
  } finally {
    await desmontar(ctx);
  }
});

test("InventoryService.confirmSale sem transação de quem chama: abre a sua e ainda vira o lote", async () => {
  const ctx = await montar(1);
  const estoque = new InventoryService();
  try {
    const segundo = await loteGuardado(ctx, ctx.fx.lot.id);
    await estoque.tryReserve(ctx.fx.lot.id, 1);
    await estoque.confirmSale(ctx.fx.lot.id, 1);

    const primeiro = await lote(ctx.fx.lot.id);
    assert.equal(primeiro.soldCount, 1);
    assert.equal(primeiro.reservedCount, 0);
    assert.equal((await lote(segundo.id)).status, "ACTIVE");
    assert.equal((await viradas(segundo.id)).length, 1);

    // venda a mais num lote já esgotado (rodar de novo) não abre nada nem suja o histórico
    await estoque.confirmSale(ctx.fx.lot.id, 0);
    assert.equal((await viradas(segundo.id)).length, 1, "a virada é uma vez só");
  } finally {
    await desmontar(ctx);
  }
});
