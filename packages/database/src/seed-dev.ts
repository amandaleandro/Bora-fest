import { prisma } from "./index";

/**
 * Seed de desenvolvimento: cria organização, evento publicado e lote ativo
 * para testar o fluxo completo de compra localmente.
 * Uso: pnpm --filter @borafest/database seed:dev
 */
async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: "borafest-demo" },
    update: {},
    create: {
      name: "BoraFest Demo",
      slug: "borafest-demo",
      kind: "COMPANY",
      document: "00000000000191",
      status: "ACTIVE",
    },
  });

  const starts = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const ends = new Date(starts.getTime() + 6 * 60 * 60 * 1000);

  const event = await prisma.event.upsert({
    where: { slug: "festival-demo" },
    update: { status: "PUBLISHED" },
    create: {
      organizationId: org.id,
      title: "Festival Demo BoraFest",
      slug: "festival-demo",
      description: "Evento de teste do ambiente de desenvolvimento",
      status: "PUBLISHED",
      publishedAt: new Date(),
      startsAt: starts,
      endsAt: ends,
    },
  });

  let ticketType = await prisma.ticketType.findFirst({
    where: { eventId: event.id, name: "Pista" },
  });
  if (!ticketType) {
    ticketType = await prisma.ticketType.create({
      data: { eventId: event.id, name: "Pista", description: "Acesso geral" },
    });
  }

  let lot = await prisma.ticketLot.findFirst({
    where: { ticketTypeId: ticketType.id, name: "1º Lote" },
  });
  if (!lot) {
    lot = await prisma.ticketLot.create({
      data: {
        ticketTypeId: ticketType.id,
        name: "1º Lote",
        priceCents: 8000,
        feeCents: 800,
        capacity: 100,
        status: "ACTIVE",
      },
    });
  } else {
    await prisma.ticketLot.update({ where: { id: lot.id }, data: { status: "ACTIVE" } });
  }

  console.log(
    JSON.stringify({ organizationId: org.id, eventId: event.id, ticketLotId: lot.id }, null, 2),
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
