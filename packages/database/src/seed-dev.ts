import { prisma } from "./index";

/** Dados fictícios para desenvolvimento/homologação. Nunca executar em produção. */
async function main() {
  if (process.env.NODE_ENV === "production" || process.env.BORAFEST_SEED_DEMO !== "1") {
    throw new Error("Seed demo exige NODE_ENV diferente de production e BORAFEST_SEED_DEMO=1");
  }

  const org = await prisma.organization.upsert({
    where: { slug: "borafest-demo" },
    update: { displayName: "Casa Demo BoraFest", bio: "Organização fictícia para testar eventos e Loja." },
    create: {
      name: "Casa Demo BoraFest",
      slug: "borafest-demo",
      kind: "COMPANY",
      document: "00000000000191",
      displayName: "Casa Demo BoraFest",
      bio: "Organização fictícia para testar eventos e Loja.",
      status: "ACTIVE",
    },
  });

  const venue = await prisma.venue.findFirst({
    where: { organizationId: org.id, name: "Espaço Fictício BoraFest" },
  }) ?? await prisma.venue.create({
    data: {
      organizationId: org.id,
      name: "Espaço Fictício BoraFest",
      address: "Endereço fictício para homologação",
      city: "Uberlândia",
      state: "MG",
    },
  });

  const starts = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const ends = new Date(starts.getTime() + 6 * 60 * 60 * 1000);
  const existingEvents = await prisma.event.findMany({
    where: { slug: { in: ["festival-demo", "show-demo-borafest"] } },
    select: { slug: true, organizationId: true },
  });
  if (existingEvents.some((item) => item.organizationId !== org.id)) {
    throw new Error("Um slug demo já pertence a outra organização");
  }

  const event = await prisma.event.upsert({
    where: { slug: "festival-demo" },
    update: { status: "PUBLISHED", venueId: venue.id, startsAt: starts, endsAt: ends },
    create: {
      organizationId: org.id,
      venueId: venue.id,
      title: "[DEMO] Festival BoraFest",
      slug: "festival-demo",
      description: "Evento fictício para testar catálogo, compra e check-in em homologação.",
      category: "FESTAS",
      status: "PUBLISHED",
      publishedAt: new Date(),
      startsAt: starts,
      endsAt: ends,
    },
  });

  const second = await prisma.event.upsert({
    where: { slug: "show-demo-borafest" },
    update: {},
    create: {
      organizationId: org.id,
      venueId: venue.id,
      title: "[DEMO] Show de Homologação",
      slug: "show-demo-borafest",
      description: "Evento fictício para testar descoberta e lotes.",
      category: "SHOWS",
      status: "PUBLISHED",
      publishedAt: new Date(),
      startsAt: new Date(starts.getTime() + 7 * 24 * 60 * 60 * 1000),
      endsAt: new Date(ends.getTime() + 7 * 24 * 60 * 60 * 1000),
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

  const showType = await prisma.ticketType.findFirst({ where: { eventId: second.id, name: "Pista" } })
    ?? await prisma.ticketType.create({ data: { eventId: second.id, name: "Pista" } });
  if (!(await prisma.ticketLot.findFirst({ where: { ticketTypeId: showType.id, name: "Lote Demo" } }))) {
    await prisma.ticketLot.create({
      data: { ticketTypeId: showType.id, name: "Lote Demo", priceCents: 4500, feeCents: 450, capacity: 80, status: "ACTIVE" },
    });
  }

  const product = await prisma.storeProduct.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: "camiseta-demo" } },
    update: { status: "ACTIVE" },
    create: {
      organizationId: org.id, name: "[DEMO] Camiseta BoraFest", slug: "camiseta-demo",
      description: "Produto fictício para testar a Loja da Casa.", status: "ACTIVE",
    },
  });
  await prisma.storeProductVariant.upsert({
    where: { productId_name: { productId: product.id, name: "M" } },
    update: {},
    create: { productId: product.id, name: "M", sku: "DEMO-CAMISETA-M", priceCents: 3990, stockTotal: 25, active: true },
  });

  console.log(
    JSON.stringify({ organizationId: org.id, eventIds: [event.id, second.id], ticketLotId: lot.id, productId: product.id }, null, 2),
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
