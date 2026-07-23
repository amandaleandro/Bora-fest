/**
 * Teste de carga do caminho mais crítico da arquitetura (§22): "concorrência
 * de centenas de compras no último ingresso — nunca pode vender além da
 * capacidade". Os testes em `src/__tests__` já provam isso a nível de
 * serviço (in-process); este script prova o mesmo fim-a-fim pela API HTTP
 * de verdade (Fastify + Nest + rede), contra uma API já rodando.
 *
 * Uso:
 *   pnpm infra:up && pnpm --filter @borafest/api dev   # num terminal
 *   pnpm --filter @borafest/api load-test               # noutro
 *
 * Variáveis: API_BASE_URL (default http://localhost:3333),
 * LOAD_TEST_CAPACITY (default 5), LOAD_TEST_ATTEMPTS (default 100).
 */
import { prisma } from "@borafest/database";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3333";
const CAPACITY = Number(process.env.LOAD_TEST_CAPACITY ?? 5);
const ATTEMPTS = Number(process.env.LOAD_TEST_ATTEMPTS ?? 100);

async function main() {
  console.log(`Preparando lote com capacidade ${CAPACITY}...`);

  const suffix = Math.random().toString(36).slice(2, 10);
  const organization = await prisma.organization.create({
    data: {
      name: `Load Test ${suffix}`,
      slug: `load-test-${suffix}`,
      kind: "COMPANY",
      document: `${Math.floor(Math.random() * 1e14)}`,
      status: "ACTIVE",
    },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: organization.id,
      title: `Evento Load Test ${suffix}`,
      slug: `evento-load-test-${suffix}`,
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
      name: "Último lote",
      priceCents: 5000,
      feeCents: 500,
      capacity: CAPACITY,
      status: "ACTIVE",
    },
  });

  try {
    console.log(`Disparando ${ATTEMPTS} reservas concorrentes de 1 unidade contra a API HTTP...`);
    const startedAt = Date.now();

    const results = await Promise.allSettled(
      Array.from({ length: ATTEMPTS }, () =>
        fetch(`${API_BASE_URL}/v1/reservations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId: event.id, items: [{ ticketLotId: lot.id, quantity: 1 }] }),
        }).then(async (res) => ({ status: res.status, body: await res.json() })),
      ),
    );

    const elapsedMs = Date.now() - startedAt;

    const succeeded = results.filter(
      (r) => r.status === "fulfilled" && r.value.status === 201,
    ).length;
    const rejected = results.filter(
      (r) => r.status === "fulfilled" && r.value.status === 400,
    ).length;
    const networkErrors = results.filter((r) => r.status === "rejected").length;
    const unexpected = results.filter(
      (r) => r.status === "fulfilled" && r.value.status !== 201 && r.value.status !== 400,
    );

    console.log(`\nConcluído em ${elapsedMs}ms (${(ATTEMPTS / (elapsedMs / 1000)).toFixed(1)} req/s)`);
    console.log(`  Reservadas (201):        ${succeeded}`);
    console.log(`  Recusadas por lote (400): ${rejected}`);
    console.log(`  Erros de rede:            ${networkErrors}`);
    if (unexpected.length > 0) {
      console.log(`  ⚠ Respostas inesperadas:  ${unexpected.length}`, unexpected.slice(0, 3));
    }

    const lotAfter = await prisma.ticketLot.findUniqueOrThrow({ where: { id: lot.id } });
    const overselling = lotAfter.reservedCount > CAPACITY;

    console.log(
      `\nLote após o teste: reservado=${lotAfter.reservedCount} / capacidade=${CAPACITY}` +
        (overselling ? " — ❌ OVERSELLING DETECTADO" : " — ✅ nunca passou da capacidade"),
    );

    if (succeeded !== CAPACITY || overselling) {
      console.error("\n❌ FALHOU: esperava exatamente", CAPACITY, "reservas bem-sucedidas, sem overselling.");
      process.exitCode = 1;
    } else {
      console.log("\n✅ PASSOU: exatamente", CAPACITY, "reservas bem-sucedidas, zero overselling sob carga HTTP real.");
    }
  } finally {
    await prisma.reservationItem.deleteMany({ where: { reservation: { eventId: event.id } } });
    await prisma.reservation.deleteMany({ where: { eventId: event.id } });
    await prisma.ticketLot.delete({ where: { id: lot.id } });
    await prisma.ticketType.delete({ where: { id: ticketType.id } });
    await prisma.event.delete({ where: { id: event.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
