import { prisma } from "@borafest/database";

/**
 * Fixtures de integração: cada teste cria sua própria organização/evento/lote
 * e limpa tudo no fim (`cleanup()`), pra rodar contra o Postgres de dev sem
 * sujar dados nem colidir entre execuções (nomes com sufixo aleatório).
 */
export async function createFixtureEvent(options: { lotCapacity: number; priceCents?: number; feeCents?: number }) {
  const suffix = Math.random().toString(36).slice(2, 10);
  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { key: "owner" } });

  const organization = await prisma.organization.create({
    data: {
      name: `Teste Integração ${suffix}`,
      slug: `teste-integracao-${suffix}`,
      kind: "COMPANY",
      document: `${Math.floor(Math.random() * 1e14)}`,
      status: "ACTIVE",
    },
  });

  const event = await prisma.event.create({
    data: {
      organizationId: organization.id,
      title: `Evento Teste ${suffix}`,
      slug: `evento-teste-${suffix}`,
      status: "PUBLISHED",
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
      publishedAt: new Date(),
    },
  });

  const ticketType = await prisma.ticketType.create({
    data: { eventId: event.id, name: "Pista" },
  });

  const lot = await prisma.ticketLot.create({
    data: {
      ticketTypeId: ticketType.id,
      name: "Lote único",
      priceCents: options.priceCents ?? 5000,
      feeCents: options.feeCents ?? 500,
      capacity: options.lotCapacity,
      status: "ACTIVE",
    },
  });

  return { organization, event, ticketType, lot, ownerRoleId: ownerRole.id };
}

export async function cleanupFixtureEvent(organizationId: string) {
  const event = await prisma.event.findFirst({ where: { organizationId } });
  if (event) {
    await prisma.checkin.deleteMany({ where: { eventId: event.id } });
    await prisma.checkinSyncBatch.deleteMany({
      where: { device: { eventId: event.id } },
    });
    await prisma.validatorDevice.deleteMany({ where: { eventId: event.id } });
    await prisma.validatorCredential.deleteMany({ where: { eventId: event.id } });
    await prisma.ticket.deleteMany({ where: { eventId: event.id } });
    await prisma.refundRequest.deleteMany({ where: { order: { eventId: event.id } } });
    await prisma.pushToken.deleteMany({ where: { order: { eventId: event.id } } });
    await prisma.orderItem.deleteMany({ where: { order: { eventId: event.id } } });
    await prisma.payment.deleteMany({ where: { order: { eventId: event.id } } });
    await prisma.order.deleteMany({ where: { eventId: event.id } });
    await prisma.reservationItem.deleteMany({ where: { reservation: { eventId: event.id } } });
    await prisma.reservation.deleteMany({ where: { eventId: event.id } });
    await prisma.ticketLot.deleteMany({ where: { ticketType: { eventId: event.id } } });
    await prisma.ticketType.deleteMany({ where: { eventId: event.id } });
  }
  await prisma.ledgerEntry.deleteMany({
    where: { ledgerAccount: { organizationId } },
  });
  await prisma.ledgerAccount.deleteMany({ where: { organizationId } });
  await prisma.event.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
}
