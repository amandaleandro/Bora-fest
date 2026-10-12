/**
 * Teste de carga do caminho mais crítico da arquitetura (§22): "concorrência
 * de centenas de compras no último ingresso — nunca pode vender além da
 * capacidade". Os testes em `src/__tests__` já provam isso a nível de
 * serviço (in-process); este script prova o mesmo fim-a-fim pela API HTTP
 * de verdade (Fastify + Nest + rede), contra uma API já rodando.
 *
 * Uso:
 *   pnpm infra:up
 *   NODE_ENV=development RATE_LIMIT_DISABLED=1 pnpm --filter @borafest/api dev   # num terminal
 *   pnpm --filter @borafest/api load-test                                       # noutro
 *
 * LIMITE DE REQUISIÇÕES (2026-10-12): as tentativas saem todas do mesmo IP, e a
 * reserva aceita 20 por minuto por IP. Antes o script forjava um
 * X-Forwarded-For diferente por tentativa para escapar do limite — truque que a
 * correção de 29/08 fechou (o guard passou a usar só o IP que o proxy
 * confiável informa). Agora a API do teste sobe com o limite desligado de
 * forma explícita: `RATE_LIMIT_DISABLED=1`, que o guard só aceita com
 * NODE_ENV=development ou test — nunca em produção (as imagens fixam
 * NODE_ENV=production e a variável é ignorada, com erro no log). Se a API
 * responder 429, o script para e explica, em vez de reportar "falhou".
 *
 * Contra um servidor de homologação: suba a API de lá com as mesmas duas
 * variáveis (e só lá). Contra produção, NÃO desligue o limite — use um gerador
 * distribuído (vários IPs de verdade) e conte o 429 como resultado esperado.
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

    // sem cabeçalho forjado (2026-10-12): o limite por IP fica desligado na
    // API do teste (RATE_LIMIT_DISABLED=1) — aqui o que se mede é o estoque
    const results = await Promise.allSettled(
      Array.from({ length: ATTEMPTS }, () =>
        fetch(`${API_BASE_URL}/v1/reservations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId: event.id, items: [{ ticketLotId: lot.id, quantity: 1 }] }),
        }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) })),
      ),
    );

    const elapsedMs = Date.now() - startedAt;

    const limitadas = results.filter((r) => r.status === "fulfilled" && r.value.status === 429).length;
    if (limitadas > 0) {
      console.error(
        `\n❌ ${limitadas} de ${ATTEMPTS} tentativas voltaram 429 (limite de requisições ligado).` +
          "\n   O resultado não mede o estoque. Suba a API do teste com" +
          "\n   NODE_ENV=development RATE_LIMIT_DISABLED=1 e rode de novo (nunca em produção).",
      );
      process.exitCode = 1;
      return;
    }

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
