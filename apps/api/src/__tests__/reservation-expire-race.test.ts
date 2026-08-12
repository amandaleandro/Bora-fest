import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { InventoryService } from "../inventory/inventory.service";
import { expireReservation } from "../../../worker/src/expire-reservation";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
  await prisma.$disconnect();
});

/**
 * Corrida achada na auditoria adversarial (2026-08-12): o worker de expiração
 * lia o status da reserva FORA da transação e depois sobrescrevia
 * CONVERTED→EXPIRED sem guarda, liberando o estoque de um pedido já vivo →
 * oversell. Aqui simulamos a corrida fielmente: no MESMO instante, uma tarefa
 * converte a reserva (o comprador pagando na margem) e o worker tenta expirar
 * (o job do TTL disparando). A invariante que NUNCA pode quebrar: o estoque
 * reservado tem que bater exatamente com o número de reservas convertidas —
 * uma reserva convertida jamais pode ter o estoque devolvido.
 */
test("corrida conversão × expiração: estoque reservado = nº de reservas convertidas (sem oversell)", async () => {
  const RODADAS = 6;
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: RODADAS + 5 });
  const inventory = new InventoryService();

  try {
    const reservationIds: string[] = [];
    // corrida par-a-par por reserva (a corrida real é por LINHA da reserva).
    // Sequencial entre reservas evita contenção artificial na linha do lote,
    // que só deixaria o teste lento sem mudar a invariante testada.
    for (let i = 0; i < RODADAS; i++) {
      // reserva 1 unidade (reserved_count++) e já nasce "expirada" para o
      // worker aceitar processá-la — a conversão concorrente é a margem de ms
      await inventory.tryReserve(lot.id, 1);
      const r = await prisma.reservation.create({
        data: {
          eventId: event.id,
          status: "ACTIVE",
          expiresAt: new Date(Date.now() - 1000),
          items: { create: [{ ticketLotId: lot.id, quantity: 1, priceCents: 5000, feeCents: 500 }] },
        },
      });
      reservationIds.push(r.id);

      await Promise.all([
        // "comprador pagando": converte se ainda ACTIVE (mesma guarda de
        // createFromReservation), sem tocar no estoque (convert não vende)
        prisma.reservation.updateMany({
          where: { id: r.id, status: "ACTIVE" },
          data: { status: "CONVERTED" },
        }),
        // "job do TTL": worker de expiração no MESMO instante
        expireReservation(r.id).catch(() => {}),
      ]);
    }

    const convertidas = await prisma.reservation.count({
      where: { id: { in: reservationIds }, status: "CONVERTED" },
    });
    const ativas = await prisma.reservation.count({
      where: { id: { in: reservationIds }, status: "ACTIVE" },
    });
    const availability = await inventory.getAvailability(lot.id);
    const reserved = availability?.reserved ?? -1;

    // A invariante de segurança: toda reserva NÃO expirada (convertida ou ainda
    // ativa por contenção) precisa continuar segurando exatamente 1 unidade —
    // só as EXPIRED devolvem estoque. O bug de oversell aparecia como
    // reserved < convertidas (uma reserva convertida perdia o estoque para
    // outro comprador). Aqui isso jamais pode acontecer.
    assert.equal(
      reserved,
      convertidas + ativas,
      `estoque reservado (${reserved}) tem que ser convertidas(${convertidas}) + ativas(${ativas})`,
    );
    assert.ok(
      reserved >= convertidas,
      `OVERSELL: reservado (${reserved}) < convertidas (${convertidas}) — reserva convertida perdeu estoque`,
    );
  } finally {
    await prisma.reservationItem.deleteMany({
      where: { reservation: { eventId: event.id } },
    });
    await prisma.reservation.deleteMany({ where: { eventId: event.id } });
    await cleanupFixtureEvent(organization.id);
  }
});
