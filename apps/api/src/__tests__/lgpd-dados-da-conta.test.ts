import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { MeService } from "../me/me.service";
import {
  ENVIO_CANCELADO,
  NOME_REMOVIDO,
  contaJaApagada,
  emailAnonimoDaConta,
  emailAnonimoDoRegistro,
  eventoJaTerminou,
  mudou,
  semDadoPessoal,
} from "../me/exclusao-de-conta";
import { ReviewsService } from "../reviews/reviews.service";
import { primeiroNome } from "../reviews/primeiro-nome";
import { OrdersController, origemDoAceite } from "../orders/orders.controller";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// FRENTE LGPD — DADOS (2026-10-12).
// (1) Excluir a conta apaga o que identifica a pessoa em TODO lugar ligado a
//     ela, numa transação só: pedidos (inclusive os sem login com o mesmo
//     e-mail, sem confundir e-mail parecido), ingressos e participantes de
//     evento que já terminou, metadata do pagamento e corpo do aviso do
//     gateway, IP do aceite, fidelidade, push, mensagens, VIP, convite e
//     auditoria. Ingresso de evento futuro segue valendo como antes.
// (2) "Baixar meus dados" traz pagamentos (sem metadata), fidelidade,
//     avaliações, Casas seguidas, aceites e mensagens (sem o corpo).
// (3) Avaliação pública mostra só o primeiro nome.
// (4) O aceite dos termos grava IP e navegador.

after(async () => {
  await closeRedisConnection();
});

const DIA = 86_400_000;
const rand = () => Math.random().toString(36).slice(2, 10);

/** CPF válido aleatório: cada execução usa CPFs que nenhum usuário antigo tem. */
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

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

test("regra: tirar dado pessoal de JSON livre sem perder o financeiro", () => {
  const marca = { expectedCents: 5500, paidCents: 5000, detectedAt: "2026-10-12T20:00:00.000Z" };
  const metadata = { payerDocument: "52998224725", amountMismatch: marca, chargebackReversal: { reversedAt: "x" } };
  const limpo = semDadoPessoal(metadata);
  assert.deepEqual(limpo, { amountMismatch: marca, chargebackReversal: { reversedAt: "x" } });
  assert.equal(metadata.payerDocument, "52998224725", "o original não é alterado");
  assert.equal(mudou(metadata, limpo), true);
  assert.equal(mudou(limpo, semDadoPessoal(limpo)), false, "limpar de novo não muda nada");

  // corpo cru de gateway: Mercado Pago (payer) e Pagar.me (customer), em qualquer nível
  assert.deepEqual(
    semDadoPessoal({
      id: 123,
      transaction_amount: 55,
      payer: { email: "maria@x.com", identification: { number: "52998224725" } },
      data: { customer: { name: "Maria", document: "52998224725", phones: {} }, amount: 5500 },
      items: [{ name: "Ingresso", amount: 1 }],
    }),
    { id: 123, transaction_amount: 55, data: { amount: 5500 }, items: [{ amount: 1 }] },
  );

  // auditoria: chaves de nome/documento/e-mail saem; e-mail solto em outra chave vira null
  assert.deepEqual(
    semDadoPessoal({
      ticketLotId: "lote",
      quantity: 1,
      buyerName: "Maria Souza",
      buyerDocument: "52998224725",
      fromEmail: "maria@x.com",
      toUserId: "u1",
      de: "maria@x.com",
      para: "outra@y.com",
      ip: "200.1.2.3",
      totalCents: 5500,
    }),
    { ticketLotId: "lote", quantity: 1, toUserId: "u1", de: null, para: null, totalCents: 5500 },
  );
  assert.equal(semDadoPessoal(null), null);
  assert.equal(semDadoPessoal(42), 42);
});

test("regra: e-mail anônimo único, conta já apagada e evento encerrado", () => {
  const id = "0f3c2a1b-1111-4222-8333-444455556666";
  assert.equal(emailAnonimoDaConta(id), `apagado-${id}@anon.borafest.invalid`, "o id inteiro — 8 caracteres colidiam");
  assert.notEqual(emailAnonimoDaConta(id), emailAnonimoDaConta("0f3c2a1b-9999-4222-8333-444455556666"));
  assert.equal(contaJaApagada(id, emailAnonimoDaConta(id)), true);
  assert.equal(contaJaApagada(id, "apagado-0f3c2a1b@anon.borafest.invalid"), true, "formato antigo também conta");
  assert.equal(contaJaApagada(id, "maria@x.com"), false);
  assert.equal(contaJaApagada(id, null), false);
  assert.equal(emailAnonimoDoRegistro("abc"), "apagado-abc@anon.borafest.invalid");
  const agora = new Date("2026-10-12T12:00:00Z");
  assert.equal(eventoJaTerminou(new Date("2026-10-12T11:59:59Z"), agora), true);
  assert.equal(eventoJaTerminou(agora, agora), true);
  assert.equal(eventoJaTerminou(new Date("2026-10-12T12:00:01Z"), agora), false);
});

test("regra: avaliação pública só com o primeiro nome", () => {
  assert.equal(primeiroNome("Maria Souza da Silva"), "Maria");
  assert.equal(primeiroNome("  Ana   Paula "), "Ana");
  assert.equal(primeiroNome("Pedro"), "Pedro");
  assert.equal(primeiroNome("joao@gmail.com"), null, "nome que é e-mail não sai");
  assert.equal(primeiroNome(""), null);
  assert.equal(primeiroNome("   "), null);
  assert.equal(primeiroNome(null), null);
  assert.equal(primeiroNome(undefined), null);
});

test("regra: origem do aceite — IP e navegador limpos e com tamanho limitado", () => {
  assert.deepEqual(origemDoAceite("200.1.2.3", "Mozilla/5.0"), { ip: "200.1.2.3", userAgent: "Mozilla/5.0" });
  assert.deepEqual(origemDoAceite("  ", ""), { ip: undefined, userAgent: undefined });
  assert.deepEqual(origemDoAceite(undefined, undefined), { ip: undefined, userAgent: undefined });
  assert.equal(origemDoAceite("::1", "x".repeat(5000)).userAgent?.length, 512);
  assert.equal(origemDoAceite("a".repeat(500), undefined).ip?.length, 64);
});

// ---------------------------------------------------------------------------
// (4) aceite dos termos com IP e navegador
// ---------------------------------------------------------------------------

test("aceite: o controller passa IP e navegador, e o pedido grava nos dois aceites", async () => {
  // a rota usa o MESMO IP do rate limit: request.ip (Fastify + TRUST_PROXY), via @Ip() do Nest
  const fonteController = readFileSync(join(__dirname, "../orders/orders.controller.ts"), "utf8");
  const fonteRateLimit = readFileSync(join(__dirname, "../common/rate-limit.guard.ts"), "utf8");
  assert.match(fonteController, /@Ip\(\) ip: string \| undefined/);
  assert.match(fonteRateLimit, /const ip = request\.ip/);

  const chamadas: unknown[][] = [];
  const servicoFalso = {
    createFromReservation: async (...args: unknown[]) => {
      chamadas.push(args);
      return { id: "pedido" };
    },
  };
  const controller = new OrdersController(servicoFalso as never, {} as never);
  await controller.create(undefined, { reservationId: "r1" }, "200.1.2.3", "Mozilla/5.0 (iPhone)");
  assert.deepEqual(chamadas[0], [
    undefined,
    { reservationId: "r1" },
    { ip: "200.1.2.3", userAgent: "Mozilla/5.0 (iPhone)" },
  ]);

  const fx = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 500 });
  const email = `aceite-${rand()}@borafest.dev`;
  try {
    const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
    const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
    const reserva = await reservations.create(undefined, {
      eventId: fx.event.id,
      items: [{ ticketLotId: fx.lot.id, quantity: 1 }],
    });
    const pedido = await orders.createFromReservation(
      undefined,
      {
        reservationId: reserva.id,
        contactEmail: email,
        contactName: "Pessoa Aceite",
        consent: { version: "2026-08", terms: true, privacy: true },
      } as never,
      { ip: "200.1.2.3", userAgent: "Mozilla/5.0 (iPhone)" },
    );
    const aceites = await prisma.consent.findMany({ where: { orderId: pedido.id }, orderBy: { document: "asc" } });
    assert.deepEqual(
      aceites.map((a) => [a.document, a.ip, a.userAgent]),
      [
        ["privacy", "200.1.2.3", "Mozilla/5.0 (iPhone)"],
        ["terms", "200.1.2.3", "Mozilla/5.0 (iPhone)"],
      ],
    );

    // sem origem (labs, testes antigos): grava sem IP, como antes — não quebra
    const reserva2 = await reservations.create(undefined, {
      eventId: fx.event.id,
      items: [{ ticketLotId: fx.lot.id, quantity: 1 }],
    });
    const pedido2 = await orders.createFromReservation(undefined, {
      reservationId: reserva2.id,
      contactEmail: email,
      consent: { version: "2026-08", terms: true, privacy: true },
    } as never);
    const semOrigem = await prisma.consent.findMany({ where: { orderId: pedido2.id } });
    assert.equal(semOrigem.length, 2);
    assert.ok(semOrigem.every((a) => a.ip === null && a.userAgent === null));
  } finally {
    const pedidos = await prisma.order.findMany({ where: { eventId: fx.event.id }, select: { id: true } });
    await prisma.notification.deleteMany({ where: { orderId: { in: pedidos.map((p) => p.id) } } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: pedidos.map((p) => p.id) } } });
    await cleanupFixtureEvent(fx.organization.id);
    await prisma.user.deleteMany({ where: { email } }).catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// (3) avaliações públicas
// ---------------------------------------------------------------------------

test("avaliações públicas: só o primeiro nome de quem comentou", async () => {
  const fx = await createFixtureEvent({
    lotCapacity: 5,
    startsAt: new Date(Date.now() - 2 * DIA),
    endsAt: new Date(Date.now() - DIA),
  });
  const usuarios: string[] = [];
  try {
    const nomes = ["Ana Paula Lima", "maria.souza@gmail.com", null];
    for (const [i, name] of nomes.entries()) {
      const u = await prisma.user.create({ data: { email: `review-${i}-${rand()}@borafest.dev`, name } });
      usuarios.push(u.id);
      await prisma.eventReview.create({
        data: { eventId: fx.event.id, userId: u.id, rating: 5, comment: `comentário ${i}`, createdAt: new Date(Date.now() - i * 1000) },
      });
    }
    const resumo = await new ReviewsService().summaryForEvent(fx.event.id);
    assert.equal(resumo.count, 3);
    assert.deepEqual(
      resumo.recent.map((r) => r.user.name),
      ["Ana", null, null],
      "nome completo e nome-e-mail nunca saem",
    );
    assert.ok(resumo.recent.every((r) => Object.keys(r.user).join() === "name"), "só o nome, nada além");
  } finally {
    await cleanupFixtureEvent(fx.organization.id);
    for (const id of usuarios) await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// Cenário completo de uma pessoa com conta (export e exclusão)
// ---------------------------------------------------------------------------

type Fixture = Awaited<ReturnType<typeof createFixtureEvent>>;

async function novoPedido(
  fx: Fixture,
  dados: {
    userId?: string | null;
    contactEmail: string;
    contactName?: string;
    contactPhone?: string;
    contactCpf?: string;
    participante?: { name: string; cpf?: string };
    ingressos: Array<{ ownerUserId?: string; attendeeName: string; attendeeEmail?: string; attendeeCpf?: string }>;
  },
) {
  const qtd = dados.ingressos.length;
  const reservation = await prisma.reservation.create({
    data: {
      eventId: fx.event.id,
      status: "CONVERTED",
      expiresAt: new Date(),
      items: { create: [{ ticketLotId: fx.lot.id, quantity: qtd, priceCents: 5000, feeCents: 500 }] },
    },
  });
  const order = await prisma.order.create({
    data: {
      eventId: fx.event.id,
      reservationId: reservation.id,
      userId: dados.userId ?? null,
      contactEmail: dados.contactEmail,
      contactName: dados.contactName,
      contactPhone: dados.contactPhone,
      contactCpf: dados.contactCpf,
      status: "PAID",
      paidAt: new Date(),
      totalCents: 5500 * qtd,
      items: { create: [{ ticketLotId: fx.lot.id, quantity: qtd, priceCents: 5000, feeCents: 500 }] },
      ...(dados.participante
        ? { attendees: { create: [{ ticketLotId: fx.lot.id, ...dados.participante }] } }
        : {}),
    },
    include: { items: true },
  });
  const tickets = [];
  for (const [i, t] of dados.ingressos.entries()) {
    tickets.push(
      await prisma.ticket.create({
        data: {
          orderId: order.id,
          orderItemId: order.items[0]!.id,
          eventId: fx.event.id,
          ticketLotId: fx.lot.id,
          seq: i + 1,
          code: `LGPD-${rand()}`,
          qrToken: `qr-${rand()}`,
          status: "ACTIVE",
          ownerUserId: t.ownerUserId ?? null,
          attendeeName: t.attendeeName,
          attendeeEmail: t.attendeeEmail ?? null,
          attendeeCpf: t.attendeeCpf ?? null,
        },
      }),
    );
  }
  return { order, tickets };
}

async function montarCenario() {
  const passado = await createFixtureEvent({
    lotCapacity: 20,
    startsAt: new Date(Date.now() - 3 * DIA),
    endsAt: new Date(Date.now() - 2 * DIA),
  });
  const futuro = await createFixtureEvent({ lotCapacity: 20 });
  const sufixo = rand();
  // `_` de propósito: no ILIKE ele casa com qualquer letra — a vizinha abaixo
  // tem um e-mail que só difere nesse caractere e NÃO pode ser tocada
  const email = `lgpd_${sufixo}@borafest.dev`;
  const emailVizinha = `lgpdx${sufixo}@borafest.dev`;
  const emailAmigo = `amigo-${sufixo}@borafest.dev`;
  const emailProdutor = `produtor-${sufixo}@borafest.dev`;
  const cpf = geraCpf();
  const telefone = `+5534${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;
  // o pedido sem login foi feito com OUTRO telefone: o WhatsApp dele vai para lá
  const telefoneDoPedido = `+5534${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;

  const pessoa = await prisma.user.create({
    data: {
      email,
      name: "Maria Souza",
      phone: telefone,
      cpf,
      emailVerifiedAt: new Date(),
      notifyEmailOffers: true,
      notifyWhatsapp: true,
    },
  });
  const amigo = await prisma.user.create({ data: { email: emailAmigo, name: "Amigo Teste", emailVerifiedAt: new Date() } });

  // pedido dela em evento que JÁ TERMINOU: 1 ingresso dela + 1 que ela passou ao amigo
  const pedidoPassado = await novoPedido(passado, {
    userId: pessoa.id,
    contactEmail: email,
    contactName: "Maria Souza",
    contactPhone: telefone,
    contactCpf: cpf,
    participante: { name: "Maria Souza", cpf },
    ingressos: [
      { attendeeName: "Maria Souza", attendeeEmail: email, attendeeCpf: cpf },
      { ownerUserId: amigo.id, attendeeName: "Amigo Teste", attendeeEmail: emailAmigo },
    ],
  });
  // pedido dela em evento FUTURO: o ingresso segue valendo, com o nome
  const pedidoFuturo = await novoPedido(futuro, {
    userId: pessoa.id,
    contactEmail: email,
    contactName: "Maria Souza",
    contactPhone: telefone,
    participante: { name: "Maria Souza", cpf },
    ingressos: [{ attendeeName: "Maria Souza", attendeeEmail: email, attendeeCpf: cpf }],
  });
  // pedido SEM login com o e-mail dela (outra caixa): também é dela
  const pedidoSemDono = await novoPedido(futuro, {
    contactEmail: email.toUpperCase(),
    contactName: "Maria S.",
    contactPhone: telefoneDoPedido,
    ingressos: [{ attendeeName: "Maria S." }],
  });
  // vizinha: e-mail quase igual, sem conta — nada dela muda
  const pedidoVizinha = await novoPedido(futuro, {
    contactEmail: emailVizinha,
    contactName: "Vizinha",
    contactPhone: "34999990000",
    ingressos: [{ attendeeName: "Vizinha" }],
  });
  // pedido do amigo em evento passado, com um ingresso transferido PARA ela
  const pedidoDoAmigo = await novoPedido(passado, {
    userId: amigo.id,
    contactEmail: emailAmigo,
    contactName: "Amigo Teste",
    ingressos: [{ ownerUserId: pessoa.id, attendeeName: "Maria Souza", attendeeEmail: email, attendeeCpf: cpf }],
  });

  const pagamento = await prisma.payment.create({
    data: {
      orderId: pedidoPassado.order.id,
      provider: "mock",
      method: "PIX",
      status: "PAID",
      amountCents: 11_000,
      paidAt: new Date(),
      metadata: {
        payerDocument: cpf,
        amountMismatch: { expectedCents: 11_000, paidCents: 11_000, detectedAt: "2026-10-12T20:00:00.000Z" },
      },
    },
  });
  const avisoGateway = await prisma.paymentEvent.create({
    data: {
      paymentId: pagamento.id,
      provider: "mock",
      externalEventId: `ev-${rand()}`,
      type: "PAYMENT_RECEIVED",
      payload: { id: "pay_123", value: 110, customer: { name: "Maria Souza", email, document: cpf } },
      processedAt: new Date(),
    },
  });
  await prisma.consent.create({
    data: {
      orderId: pedidoPassado.order.id,
      userId: pessoa.id,
      document: "terms",
      version: "2026-08",
      ip: "200.10.20.30",
      userAgent: "Mozilla/5.0",
    },
  });

  // fidelidade: uma conta ligada a ela, outra só pelo e-mail (nunca abriu "Meus pontos")
  const fidelidadeComDono = randomUUID();
  const fidelidadeSoEmail = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO loyalty_accounts (id, organization_id, email_key, user_id, display_name, created_at, updated_at)
    VALUES (${fidelidadeComDono}::uuid, ${passado.organization.id}::uuid, ${email}, ${pessoa.id}::uuid, 'Maria Souza', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await prisma.$executeRaw`
    INSERT INTO loyalty_accounts (id, organization_id, email_key, user_id, display_name, created_at, updated_at)
    VALUES (${fidelidadeSoEmail}::uuid, ${futuro.organization.id}::uuid, ${email}, NULL, 'Maria Souza', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await prisma.$executeRaw`
    INSERT INTO loyalty_entries (id, loyalty_account_id, organization_id, delta_points, source_type, source_id, description, created_at)
    VALUES (${randomUUID()}::uuid, ${fidelidadeComDono}::uuid, ${passado.organization.id}::uuid, 110, 'ORDER_EARN', ${pedidoPassado.order.id}::uuid, 'Pontos por compra paga', CURRENT_TIMESTAMP)
  `;

  await prisma.webPushSubscription.create({
    data: { userId: pessoa.id, endpoint: `https://push.example/${rand()}`, p256dh: "k", auth: "a", userAgent: "Mozilla/5.0" },
  });
  await prisma.pushToken.create({ data: { orderId: pedidoFuturo.order.id, token: `expo-${rand()}`, platform: "ios" } });
  await prisma.organizationFollow.create({ data: { organizationId: futuro.organization.id, userId: pessoa.id } });
  await prisma.eventReview.create({
    data: { eventId: passado.event.id, userId: pessoa.id, rating: 5, comment: "Foi ótimo, aqui é a Maria Souza" },
  });
  await prisma.otpChallenge.create({
    data: { destination: email, channel: "EMAIL", codeHash: "hash", expiresAt: new Date(Date.now() + 600_000) },
  });

  const longe = new Date(Date.now() + 30 * DIA); // o worker nunca pega durante o teste
  const notificacoes = {
    ingressoEnviado: await prisma.notification.create({
      data: {
        channel: "EMAIL",
        recipient: email,
        template: "ticket_delivery",
        payload: { name: "Maria Souza" },
        status: "SENT",
        sentAt: new Date(),
        orderId: pedidoPassado.order.id,
      },
    }),
    lembretePendente: await prisma.notification.create({
      data: { channel: "EMAIL", recipient: email, template: "event_reminder", payload: { name: "Maria" }, availableAt: longe },
    }),
    // WhatsApp da entrega (sempre ligado ao pedido, como o worker grava)
    whatsappEnviado: await prisma.notification.create({
      data: {
        channel: "WHATSAPP",
        recipient: telefone,
        template: "ticket_delivery",
        payload: { name: "Maria" },
        status: "SENT",
        orderId: pedidoPassado.order.id,
      },
    }),
    // telefone dela, mas mensagem SEM pedido (ex.: de outra pessoa que digitou
    // o mesmo número): telefone não vale "no sistema inteiro" — fica
    whatsappSemPedido: await prisma.notification.create({
      data: { channel: "WHATSAPP", recipient: telefone, template: "otp_code", payload: { code: "1" }, status: "SENT" },
    }),
    // WhatsApp do ingresso para o telefone do PEDIDO (não o da conta)
    whatsappDoPedido: await prisma.notification.create({
      data: {
        channel: "WHATSAPP",
        recipient: telefoneDoPedido,
        template: "ticket_delivery",
        payload: { name: "Maria S." },
        status: "SENT",
        orderId: pedidoSemDono.order.id,
      },
    }),
    // a mesma caixa escrita com outra grafia
    emailOutraGrafia: await prisma.notification.create({
      data: {
        channel: "EMAIL",
        recipient: ` ${email.charAt(0).toUpperCase()}${email.slice(1)}`,
        template: "event_reminder",
        payload: { name: "Maria" },
        availableAt: longe,
      },
    }),
    // a vizinha: telefone dela não é da pessoa
    whatsappDaVizinha: await prisma.notification.create({
      data: { channel: "WHATSAPP", recipient: "34999990000", template: "ticket_delivery", payload: { name: "Vizinha" }, status: "SENT" },
    }),
    avisoAoProdutor: await prisma.notification.create({
      data: {
        channel: "EMAIL",
        recipient: emailProdutor,
        template: "sale_alert",
        payload: { buyerName: "Maria Souza" },
        status: "SENT",
        orderId: pedidoPassado.order.id,
      },
    }),
    avisoAoProdutorPendente: await prisma.notification.create({
      data: {
        channel: "EMAIL",
        recipient: emailProdutor,
        template: "sale_alert",
        payload: { buyerName: "Maria Souza" },
        orderId: pedidoPassado.order.id,
        availableAt: longe,
      },
    }),
  };

  const auditoriaVenda = await prisma.auditLog.create({
    data: {
      action: "order.pdv_sale",
      entityType: "order",
      entityId: pedidoPassado.order.id,
      metadata: { ticketLotId: passado.lot.id, quantity: 2, buyerName: "Maria Souza", buyerDocument: cpf, totalCents: 11_000 },
    },
  });
  const auditoriaTransferencia = await prisma.auditLog.create({
    data: {
      action: "ticket.transfer",
      entityType: "ticket",
      entityId: pedidoDoAmigo.tickets[0]!.id,
      metadata: { fromName: "Amigo Teste", fromEmail: emailAmigo, toUserId: pessoa.id, toEmail: email },
    },
  });

  // VIP e convite por e-mail em evento que já terminou
  const mesa = await prisma.vipInventory.create({
    data: { eventId: passado.event.id, kind: "MESA", name: "Mesa 1", unitPriceCents: 10_000, quantity: 1, capacityPerUnit: 4 },
  });
  const vip = await prisma.vipReservation.create({
    data: {
      vipInventoryId: mesa.id,
      contactName: "Maria Souza",
      contactEmail: email,
      contactPhone: telefone,
      partySize: 2,
      unitPriceCents: 10_000,
      totalCents: 10_000,
      customerNote: "Aniversário da Maria",
    },
  });
  const convite = await prisma.lotEmailInvite.create({
    data: { ticketLotId: passado.lot.id, email, token: `tk-${rand()}${rand()}` },
  });

  return {
    passado,
    futuro,
    email,
    emailVizinha,
    cpf,
    telefone,
    pessoa,
    amigo,
    pedidoPassado,
    pedidoFuturo,
    pedidoSemDono,
    pedidoVizinha,
    pedidoDoAmigo,
    pagamento,
    avisoGateway,
    fidelidadeComDono,
    fidelidadeSoEmail,
    notificacoes,
    auditoriaVenda,
    auditoriaTransferencia,
    vip,
    convite,
  };
}

async function desmontarCenario(c: Awaited<ReturnType<typeof montarCenario>>) {
  await prisma.notification.deleteMany({ where: { id: { in: Object.values(c.notificacoes).map((n) => n.id) } } });
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: [c.pessoa.id, c.pedidoPassado.order.id, c.pedidoDoAmigo.tickets[0]!.id] } },
  });
  await prisma.otpChallenge.deleteMany({ where: { destination: c.email } });
  await cleanupFixtureEvent(c.passado.organization.id);
  await cleanupFixtureEvent(c.futuro.organization.id);
  for (const id of [c.pessoa.id, c.amigo.id]) await prisma.user.delete({ where: { id } }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// (2) Baixar meus dados
// ---------------------------------------------------------------------------

test("Baixar meus dados: pagamentos, fidelidade, avaliações, Casas, aceites e mensagens — sem corpo nem metadata", async () => {
  const c = await montarCenario();
  try {
    const dados = await new MeService().dataExport(c.pessoa.id);
    assert.deepEqual(Object.keys(dados).sort(), [
      "consents",
      "emails",
      "exportedAt",
      "followedHouses",
      "loyalty",
      "orders",
      "payments",
      "reviews",
      "tickets",
      "user",
    ]);

    // pedidos da conta + o feito sem login com o mesmo e-mail; nunca o da vizinha
    assert.deepEqual(
      dados.orders.map((o) => o.id).sort(),
      [c.pedidoPassado.order.id, c.pedidoFuturo.order.id, c.pedidoSemDono.order.id].sort(),
    );
    // ingressos: os dela e o recebido; o que ela passou ao amigo é do amigo
    const ingressos = new Set(dados.tickets.map((t) => t.id));
    assert.ok(ingressos.has(c.pedidoPassado.tickets[0]!.id));
    assert.ok(ingressos.has(c.pedidoDoAmigo.tickets[0]!.id), "ingresso recebido por transferência");
    assert.ok(!ingressos.has(c.pedidoPassado.tickets[1]!.id), "ingresso passado adiante não entra");

    assert.equal(dados.payments.length, 1);
    assert.equal(dados.payments[0]!.amountCents, 11_000);
    assert.equal(dados.payments[0]!.method, "PIX");
    assert.ok(!("metadata" in dados.payments[0]!), "metadata do gateway não sai");
    assert.ok(!("pixQrCodeText" in dados.payments[0]!));

    assert.equal(dados.loyalty.length, 2, "conta de fidelidade com dono e a só pelo e-mail");
    const comPontos = dados.loyalty.find((l) => l.points === 110);
    assert.ok(comPontos, "saldo de pontos como número");
    assert.equal(comPontos.entries.length, 1);
    assert.equal(comPontos.entries[0]!.sourceType, "ORDER_EARN");
    assert.equal(dados.loyalty.find((l) => l !== comPontos)!.points, 0);

    assert.equal(dados.reviews.length, 1);
    assert.equal(dados.reviews[0]!.rating, 5);
    assert.equal(dados.reviews[0]!.event.title, c.passado.event.title);

    assert.equal(dados.followedHouses.length, 1);
    assert.equal(dados.followedHouses[0]!.slug, c.futuro.organization.slug);

    assert.equal(dados.consents.length, 1);
    assert.equal(dados.consents[0]!.version, "2026-08");
    assert.equal(dados.consents[0]!.ip, "200.10.20.30", "o IP é dado dela: sai na exportação");

    // mensagens PARA ela (e-mail e WhatsApp, inclusive o telefone do pedido e a
    // outra grafia do e-mail); o aviso ao produtor e o WhatsApp da vizinha não
    assert.equal(dados.emails.length, 5);
    for (const mensagem of dados.emails) {
      assert.ok(!("payload" in mensagem), "o corpo não sai");
      assert.ok(!("recipient" in mensagem));
      assert.ok(mensagem.template && mensagem.status && mensagem.createdAt);
    }
    assert.ok(!JSON.stringify(dados).includes("sale_alert"));
  } finally {
    await desmontarCenario(c);
  }
});

// ---------------------------------------------------------------------------
// (1) Exclusão de conta
// ---------------------------------------------------------------------------

test("exclusão de conta: anonimiza tudo ligado à pessoa numa vez só, e ingresso de evento futuro segue valendo", async () => {
  const c = await montarCenario();
  try {
    const me = new MeService();
    // clique duplo: as duas chamadas terminam bem e a exclusão roda uma vez só
    const [r1, r2] = await Promise.all([me.deleteAccount(c.pessoa.id), me.deleteAccount(c.pessoa.id)]);
    assert.deepEqual(r1, { deleted: true });
    assert.deepEqual(r2, { deleted: true });
    assert.equal(
      await prisma.auditLog.count({ where: { action: "account.delete", entityId: c.pessoa.id } }),
      1,
      "uma auditoria só",
    );
    const auditoriaDaExclusao = await prisma.auditLog.findFirstOrThrow({
      where: { action: "account.delete", entityId: c.pessoa.id },
    });
    assert.deepEqual(auditoriaDaExclusao.metadata, {
      pedidos: 3,
      ingressosAnonimizados: 2,
      ingressosDeEventoFuturoMantidos: 2,
    });

    const anonimo = emailAnonimoDaConta(c.pessoa.id);

    // conta
    const conta = await prisma.user.findUniqueOrThrow({ where: { id: c.pessoa.id } });
    assert.equal(conta.email, anonimo);
    assert.equal(conta.name, null);
    assert.equal(conta.phone, null);
    assert.equal(conta.cpf, null);
    assert.equal(conta.notifyEmailOffers, false);
    assert.equal(conta.notifyWhatsapp, false);
    assert.equal(conta.sessionVersion, 1, "sessões derrubadas — uma vez só");
    assert.ok(conta.emailVerifiedAt, "fica: mantém aberto o ingresso de evento futuro");

    // pedidos dela (inclusive o sem login em outra caixa) — todos
    for (const pedido of [c.pedidoPassado, c.pedidoFuturo, c.pedidoSemDono]) {
      const salvo = await prisma.order.findUniqueOrThrow({ where: { id: pedido.order.id } });
      assert.equal(salvo.contactEmail, anonimo);
      assert.equal(salvo.contactName, null);
      assert.equal(salvo.contactPhone, null);
      assert.equal(salvo.contactCpf, null);
      assert.equal(salvo.totalCents, pedido.order.totalCents, "o valor (registro financeiro) não muda");
    }
    // vizinha com e-mail quase igual e o pedido do amigo: intactos
    const vizinha = await prisma.order.findUniqueOrThrow({ where: { id: c.pedidoVizinha.order.id } });
    assert.equal(vizinha.contactEmail, c.emailVizinha);
    assert.equal(vizinha.contactName, "Vizinha");
    const doAmigo = await prisma.order.findUniqueOrThrow({ where: { id: c.pedidoDoAmigo.order.id } });
    assert.equal(doAmigo.contactName, "Amigo Teste");

    // ingressos: evento que terminou perde nome/e-mail/CPF; o passado ao amigo é do amigo
    const ingresso = (id: string) => prisma.ticket.findUniqueOrThrow({ where: { id } });
    for (const id of [c.pedidoPassado.tickets[0]!.id, c.pedidoDoAmigo.tickets[0]!.id]) {
      const t = await ingresso(id);
      assert.equal(t.attendeeName, null);
      assert.equal(t.attendeeEmail, null);
      assert.equal(t.attendeeCpf, null);
    }
    assert.equal((await ingresso(c.pedidoPassado.tickets[1]!.id)).attendeeName, "Amigo Teste");
    // evento futuro: o ingresso segue valendo como antes (decisão pendente do Arthur)
    const futuro = await ingresso(c.pedidoFuturo.tickets[0]!.id);
    assert.equal(futuro.status, "ACTIVE");
    assert.equal(futuro.attendeeName, "Maria Souza");
    assert.equal(futuro.attendeeCpf, c.cpf);

    // participantes: só do evento que terminou
    const [participantePassado] = await prisma.orderAttendee.findMany({ where: { orderId: c.pedidoPassado.order.id } });
    assert.equal(participantePassado!.name, NOME_REMOVIDO);
    assert.equal(participantePassado!.cpf, null);
    const [participanteFuturo] = await prisma.orderAttendee.findMany({ where: { orderId: c.pedidoFuturo.order.id } });
    assert.equal(participanteFuturo!.name, "Maria Souza");

    // pagamento: sai o pagador, fica o financeiro
    const pagamento = await prisma.payment.findUniqueOrThrow({ where: { id: c.pagamento.id } });
    assert.deepEqual(pagamento.metadata, {
      amountMismatch: { expectedCents: 11_000, paidCents: 11_000, detectedAt: "2026-10-12T20:00:00.000Z" },
    });
    assert.equal(pagamento.amountCents, 11_000);
    assert.equal(pagamento.status, "PAID");
    const aviso = await prisma.paymentEvent.findUniqueOrThrow({ where: { id: c.avisoGateway.id } });
    assert.deepEqual(aviso.payload, { id: "pay_123", value: 110 });
    assert.ok(aviso.processedAt, "o dedupe do webhook continua igual");

    // aceite: a prova fica, o IP sai
    const [aceite] = await prisma.consent.findMany({ where: { orderId: c.pedidoPassado.order.id } });
    assert.equal(aceite!.version, "2026-08");
    assert.equal(aceite!.ip, null);
    assert.equal(aceite!.userAgent, null);

    // fidelidade: pontos ficam com a Casa, sem dono e sem e-mail
    const contas = await prisma.$queryRaw<Array<{ id: string; emailKey: string; userId: string | null; displayName: string | null }>>`
      SELECT id, email_key AS "emailKey", user_id AS "userId", display_name AS "displayName"
      FROM loyalty_accounts WHERE id IN (${c.fidelidadeComDono}::uuid, ${c.fidelidadeSoEmail}::uuid)
    `;
    assert.equal(contas.length, 2);
    for (const contaFidelidade of contas) {
      assert.equal(contaFidelidade.emailKey, emailAnonimoDoRegistro(contaFidelidade.id));
      assert.equal(contaFidelidade.userId, null);
      assert.equal(contaFidelidade.displayName, null);
    }
    const [{ pontos }] = await prisma.$queryRaw<Array<{ pontos: bigint }>>`
      SELECT COALESCE(SUM(delta_points), 0)::bigint AS pontos FROM loyalty_entries WHERE loyalty_account_id = ${c.fidelidadeComDono}::uuid
    `;
    assert.equal(Number(pontos), 110, "os lançamentos de pontos não somem");

    // push, Casas seguidas, código de acesso
    assert.equal(await prisma.webPushSubscription.count({ where: { userId: c.pessoa.id } }), 0);
    assert.equal(await prisma.pushToken.count({ where: { orderId: c.pedidoFuturo.order.id } }), 0);
    assert.equal(await prisma.organizationFollow.count({ where: { userId: c.pessoa.id } }), 0);
    assert.equal(await prisma.otpChallenge.count({ where: { destination: c.email } }), 0);

    // avaliação: fica a nota, sai o comentário
    const avaliacao = await prisma.eventReview.findFirstOrThrow({ where: { userId: c.pessoa.id } });
    assert.equal(avaliacao.rating, 5);
    assert.equal(avaliacao.comment, null);

    // mensagens
    const msg = (id: string) => prisma.notification.findUniqueOrThrow({ where: { id } });
    const enviada = await msg(c.notificacoes.ingressoEnviado.id);
    assert.equal(enviada.recipient, anonimo);
    assert.deepEqual(enviada.payload, {});
    assert.equal(enviada.status, "SENT", "o histórico de envio fica");
    const pendente = await msg(c.notificacoes.lembretePendente.id);
    assert.equal(pendente.status, "FAILED", "o que não saiu é cancelado");
    assert.equal(pendente.error, ENVIO_CANCELADO);
    assert.equal(pendente.recipient, anonimo);
    const whatsapp = await msg(c.notificacoes.whatsappEnviado.id);
    assert.equal(whatsapp.recipient, anonimo);
    assert.deepEqual(whatsapp.payload, {});
    const whatsappDoPedido = await msg(c.notificacoes.whatsappDoPedido.id);
    assert.equal(whatsappDoPedido.recipient, anonimo, "telefone do pedido também sai");
    assert.deepEqual(whatsappDoPedido.payload, {});
    const outraGrafia = await msg(c.notificacoes.emailOutraGrafia.id);
    assert.equal(outraGrafia.recipient, anonimo, "maiúscula/espaço não escapam");
    assert.equal(outraGrafia.status, "FAILED");
    const semPedido = await msg(c.notificacoes.whatsappSemPedido.id);
    assert.equal(semPedido.recipient, c.telefone, "telefone fora dos pedidos dela não é apagado");
    const daVizinha = await msg(c.notificacoes.whatsappDaVizinha.id);
    assert.equal(daVizinha.recipient, "34999990000", "telefone de outra pessoa fica");
    assert.deepEqual(daVizinha.payload, { name: "Vizinha" });
    const aoProdutor = await msg(c.notificacoes.avisoAoProdutor.id);
    assert.notEqual(aoProdutor.recipient, anonimo, "destinatário que não é ela fica");
    assert.deepEqual(aoProdutor.payload, {}, "mas o corpo sobre o pedido dela sai");
    const aoProdutorPendente = await msg(c.notificacoes.avisoAoProdutorPendente.id);
    assert.equal(aoProdutorPendente.status, "PENDING", "aviso a outra pessoa que ainda vai sair não é mexido");
    assert.deepEqual(aoProdutorPendente.payload, { buyerName: "Maria Souza" });

    // VIP e convite de evento que terminou
    const vip = await prisma.vipReservation.findUniqueOrThrow({ where: { id: c.vip.id } });
    assert.equal(vip.contactName, NOME_REMOVIDO);
    assert.equal(vip.contactEmail, anonimo);
    assert.equal(vip.contactPhone, "");
    assert.equal(vip.customerNote, null);
    assert.equal(vip.totalCents, 10_000);
    const convite = await prisma.lotEmailInvite.findUniqueOrThrow({ where: { id: c.convite.id } });
    assert.equal(convite.email, emailAnonimoDoRegistro(c.convite.id));

    // auditoria: o registro fica, sem nome, e-mail e documento
    const venda = await prisma.auditLog.findUniqueOrThrow({ where: { id: c.auditoriaVenda.id } });
    assert.equal(venda.action, "order.pdv_sale");
    assert.deepEqual(venda.metadata, { ticketLotId: c.passado.lot.id, quantity: 2, totalCents: 11_000 });
    const transferencia = await prisma.auditLog.findUniqueOrThrow({ where: { id: c.auditoriaTransferencia.id } });
    assert.deepEqual(transferencia.metadata, { toUserId: c.pessoa.id });

    // nenhuma linha ligada a ela ainda carrega o e-mail, o CPF ou o telefone
    const restos = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM orders
      WHERE id IN (${c.pedidoPassado.order.id}::uuid, ${c.pedidoFuturo.order.id}::uuid, ${c.pedidoSemDono.order.id}::uuid)
        AND (lower(contact_email) = ${c.email} OR contact_cpf = ${c.cpf} OR contact_phone = ${c.telefone})
    `;
    assert.equal(Number(restos[0]!.n), 0);
  } finally {
    await desmontarCenario(c);
  }
});

test("exclusão de conta: conta que não existe é 404, não erro do banco", async () => {
  await assert.rejects(new MeService().deleteAccount(randomUUID()), (error: any) => error.status === 404);
});

test("conta com e-mail NÃO provado não leva o que é de quem tem o e-mail (exportação e exclusão)", async () => {
  const c = await montarCenario();
  const email = `nao-provado-${Math.random().toString(36).slice(2, 10)}@borafest.dev`;
  // a dona de verdade do e-mail comprou sem login; outra pessoa criou conta
  // com o mesmo e-mail e nunca confirmou (sem código, sem link)
  const pedidoDaDona = await novoPedido(c.futuro, {
    contactEmail: email,
    contactName: "Dona do E-mail",
    ingressos: [{ attendeeName: "Dona do E-mail" }],
  });
  const avisoDaDona = await prisma.notification.create({
    data: { channel: "EMAIL", recipient: email, template: "event_reminder", payload: { name: "Dona" }, status: "SENT" },
  });
  const impostor = await prisma.user.create({ data: { email, name: "Outra Pessoa" } });
  try {
    const dados = await new MeService().dataExport(impostor.id);
    assert.equal(dados.orders.length, 0, "o pedido sem login da dona não aparece");
    assert.equal(dados.emails.length, 0, "nem as mensagens dela");

    await new MeService().deleteAccount(impostor.id);
    const pedido = await prisma.order.findUniqueOrThrow({ where: { id: pedidoDaDona.order.id } });
    assert.equal(pedido.contactEmail, email, "a exclusão não mexe no pedido da dona");
    assert.equal(pedido.contactName, "Dona do E-mail");
    const aviso = await prisma.notification.findUniqueOrThrow({ where: { id: avisoDaDona.id } });
    assert.equal(aviso.recipient, email, "o destinatário fica: o e-mail pode ser de outra pessoa");
    assert.deepEqual(aviso.payload, {}, "mas mensagem da conta sem pedido perde o corpo");
  } finally {
    await prisma.notification.delete({ where: { id: avisoDaDona.id } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { entityId: impostor.id } });
    await desmontarCenario(c);
    await prisma.user.delete({ where: { id: impostor.id } }).catch(() => undefined);
  }
});
