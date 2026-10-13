import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { ReservationsService } from "../reservations/reservations.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// LEITURA DA RESERVA PARA O CHECKOUT (2026-10-12). O nome do lote, nominal/
// exige CPF e quem paga a taxa vinham só da página pública do evento — que
// esconde lote encerrado. Se o lote fechava DURANTE a reserva, o checkout
// mostrava "Ingresso", parava de pedir os participantes (o pedido era recusado
// lá na frente) e somava a taxa que o produtor absorve. Agora a reserva traz
// esses dados por item, com os valores ATUAIS do lote (os que o pedido confere).

after(async () => {
  await closeRedisConnection();
});

test("a reserva traz os dados do lote por item — e eles não somem quando o lote encerra", async () => {
  const fx = await createFixtureEvent({ lotCapacity: 20, priceCents: 4000, feeCents: 400 });
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  try {
    const vip = await prisma.ticketLot.create({
      data: {
        ticketTypeId: fx.ticketType.id,
        name: "VIP nominal",
        priceCents: 8000,
        feeCents: 800,
        capacity: 10,
        status: "ACTIVE",
        nominal: true,
        requiresCpf: true,
        feeMode: "PRODUCER",
      },
    });
    const reserva = await prisma.reservation.create({
      data: {
        eventId: fx.event.id,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 10 * 60_000),
        items: {
          create: [
            { ticketLotId: fx.lot.id, quantity: 2, priceCents: 2000, feeCents: 400, halfPrice: true },
            { ticketLotId: vip.id, quantity: 1, priceCents: 8000, feeCents: 800 },
          ],
        },
      },
    });

    const lida = await reservations.findById(reserva.id);
    assert.equal(lida.id, reserva.id);
    assert.equal(lida.eventId, fx.event.id);
    assert.equal(lida.eventSlug, fx.event.slug, "o checkout reabre o catálogo mesmo de evento privado");
    assert.equal(lida.status, "ACTIVE");
    assert.equal(lida.items.length, 2);

    const pista = lida.items.find((i) => i.ticketLotId === fx.lot.id)!;
    // o que já existia segue igual: preço da reserva (meia) e taxa
    assert.equal(pista.quantity, 2);
    assert.equal(pista.priceCents, 2000);
    assert.equal(pista.feeCents, 400);
    assert.equal(pista.halfPrice, true);
    assert.equal(pista.lotName, "Lote único");
    assert.equal(pista.ticketTypeName, "Pista");
    assert.equal(pista.nominal, false);
    assert.equal(pista.feeMode, "BUYER");
    assert.equal(pista.inviteMode, "NONE");

    const doVip = lida.items.find((i) => i.ticketLotId === vip.id)!;
    assert.equal(doVip.lotName, "VIP nominal");
    assert.equal(doVip.nominal, true);
    assert.equal(doVip.requiresCpf, true);
    assert.equal(doVip.feeMode, "PRODUCER", "taxa por conta do produtor não entra no total do comprador");
    assert.ok(!("ticketLot" in doVip), "o lote cru não vai junto");

    // o lote ENCERRA no meio da reserva: a página pública esconde, a reserva não
    await prisma.ticketLot.update({
      where: { id: vip.id },
      data: { status: "CLOSED", endsAt: new Date(Date.now() - 60_000) },
    });
    const depois = await reservations.findById(reserva.id);
    const vipDepois = depois.items.find((i) => i.ticketLotId === vip.id)!;
    assert.equal(vipDepois.lotName, "VIP nominal");
    assert.equal(vipDepois.nominal, true, "os participantes continuam sendo pedidos");
    assert.equal(vipDepois.requiresCpf, true);
    assert.equal(vipDepois.feeMode, "PRODUCER");

    await assert.rejects(reservations.findById("00000000-0000-0000-0000-000000000000"), /Reserva não encontrada/);
  } finally {
    await cleanupFixtureEvent(fx.organization.id);
  }
});
