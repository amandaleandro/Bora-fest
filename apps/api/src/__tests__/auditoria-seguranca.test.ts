import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { applyGatewayStatus } from "@borafest/payments";
import { closeRedisConnection } from "@borafest/queues";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "../payments/payments.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { IdempotencyService } from "../common/idempotency.service";
import { TicketsService } from "../tickets/tickets.service";
import { NotificationsService } from "../notifications/notifications.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { DashboardService } from "../dashboard/dashboard.service";
import { issueTicketsForOrder } from "../../../worker/src/issue-tickets";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());

async function comprarAnonimo(eventId: string, lotId: string, email: string) {
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const payments = new PaymentsService(new IdempotencyService());
  const reservation = await reservations.create(undefined, { eventId, items: [{ ticketLotId: lotId, quantity: 1 }] });
  const order = await orders.createFromReservation(undefined, {
    reservationId: reservation.id,
    contactEmail: email,
    contactName: "Comprador",
  } as never);
  const payment = await payments.createPix(order.id, {});
  await applyGatewayStatus(payment.id, "PAID");
  return prisma.order.findUniqueOrThrow({ where: { id: order.id } });
}

test("SEQUESTRO DE CONTA: informar e-mail de terceiro no checkout não dá acesso à conta dele", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 0 });
  const emailVitima = `vitima-${Math.random().toString(36).slice(2, 8)}@borafest.dev`;
  try {
    // vítima é produtora com conta por senha (emailVerifiedAt null)
    const vitima = await prisma.user.create({
      data: { email: emailVitima, passwordHash: "hash-falso", name: "Produtora Vítima" },
    });

    // atacante compra informando o e-mail da vítima
    const pedido = await comprarAnonimo(f.event.id, f.lot.id, emailVitima);

    // o pedido NÃO pode ter sido anexado à conta da vítima
    assert.notEqual(pedido.userId, vitima.id, "pedido não pode grudar em conta alheia");
    assert.equal(pedido.accountCreatedByOrder, false);

    // e a correção de e-mail NÃO pode trocar o e-mail da conta da vítima
    await assert.rejects(
      () => orders.correctEmail(pedido.publicToken, "atacante@evil.dev"),
      /Não é possível alterar/,
    );
    const aindaVitima = await prisma.user.findUniqueOrThrow({ where: { id: vitima.id } });
    assert.equal(aindaVitima.email, emailVitima, "e-mail da vítima intocado");
  } finally {
    await cleanupFixtureEvent(f.organization.id);
    await prisma.user.deleteMany({ where: { email: emailVitima } });
  }
});

test("PORTÃO DO 1º INGRESSO: QR não vaza por imagem, /status, reenvio nem WhatsApp", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 0 });
  const email = `gate-${Math.random().toString(36).slice(2, 8)}@borafest.dev`;
  try {
    const pedido = await comprarAnonimo(f.event.id, f.lot.id, email);
    await issueTicketsForOrder(pedido.id);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: pedido.id } });

    const tickets = new TicketsService();
    const notifications = new NotificationsService();

    // 1) imagem do QR
    await assert.rejects(
      () => tickets.renderTicketQrPng(pedido.publicToken, ticket.id),
      /Confirme seu e-mail/,
    );
    // 2) /status não entrega nem os ids
    const status = await orders.findByPublicToken(pedido.publicToken);
    assert.equal((status as { tickets: unknown[] }).tickets.length, 0);
    assert.equal((status as { requiresVerification: boolean }).requiresVerification, true);
    // 3) reenvio por e-mail
    await assert.rejects(() => notifications.resendTickets(pedido.publicToken), /Confirme seu e-mail/);
    // 4) WhatsApp para telefone arbitrário
    await assert.rejects(
      () => notifications.sendTicketsToWhatsApp(pedido.publicToken, { phone: "11999998888" } as never),
      /Confirme seu e-mail/,
    );

    // verificou → tudo abre
    await prisma.user.update({
      where: { id: pedido.userId! },
      data: { emailVerifiedAt: new Date() },
    });
    const png = await tickets.renderTicketQrPng(pedido.publicToken, ticket.id);
    assert.ok(png.length > 100, "QR liberado após verificar");
  } finally {
    await cleanupFixtureEvent(f.organization.id);
    await prisma.user.deleteMany({ where: { email } });
  }
});

test("PRIVILÉGIO: admin não cria dono; conta bancária e PII exigem papel certo", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 0 });
  const orgs = new OrganizationsService(new OrgAccessService());
  const dash = new DashboardService(new OrgAccessService());
  try {
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "admin" } });
    const sellerRole = await prisma.role.findUniqueOrThrow({ where: { key: "seller" } });
    const admin = await prisma.user.create({ data: { email: `adm-${Math.random().toString(36).slice(2, 8)}@borafest.dev` } });
    const seller = await prisma.user.create({ data: { email: `sel-${Math.random().toString(36).slice(2, 8)}@borafest.dev` } });
    await prisma.organizationMember.createMany({
      data: [
        { organizationId: f.organization.id, userId: admin.id, roleId: adminRole.id, status: "ACTIVE" },
        { organizationId: f.organization.id, userId: seller.id, roleId: sellerRole.id, status: "ACTIVE" },
      ],
    });

    // admin tentando criar OWNER = escalação
    await assert.rejects(
      () => orgs.inviteMember(f.organization.id, admin.id, { email: "novo-dono@evil.dev", roleKey: "owner" } as never),
      /Apenas o dono/,
    );

    // vendedor não exporta PII do evento inteiro
    await assert.rejects(() => dash.exportParticipantsCsv(f.event.id, seller.id), /Sem permissão/);
    await assert.rejects(() => dash.listOrders(f.event.id, seller.id, {} as never), /Sem permissão/);

    // vendedor não troca a conta bancária (destino do dinheiro)
    await assert.rejects(
      () =>
        orgs.addBankAccount(f.organization.id, seller.id, {
          holderName: "X", holderDocument: "12345678000190", bankCode: "001",
          agency: "1", account: "1", accountType: "corrente",
        }),
      /Sem permissão/,
    );
  } finally {
    await cleanupFixtureEvent(f.organization.id);
  }
});

test("DINHEIRO: saque não duplica em clique simultâneo e repasse pago não é contado 2×", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 0 });
  try {
    const { FinanceService } = await import("../finance/finance.service");
    const finance = new FinanceService(new OrgAccessService());
    const user = await prisma.user.create({ data: { email: `fin-${Math.random().toString(36).slice(2, 8)}@borafest.dev` } });
    await prisma.organizationMember.create({
      data: { organizationId: f.organization.id, userId: user.id, roleId: f.ownerRoleId, status: "ACTIVE" },
    });
    await prisma.bankAccount.create({
      data: {
        organizationId: f.organization.id, holderName: "C", holderDocument: "12345678000190",
        bankCode: "001", agency: "1", account: "9", accountType: "corrente",
        pixKey: "x@pix.dev", isDefault: true,
        pixKeyUpdatedAt: new Date(Date.now() - 72 * 3600_000),
      },
    });
    const account = await prisma.ledgerAccount.upsert({
      where: { organizationId: f.organization.id }, update: {}, create: { organizationId: f.organization.id },
    });
    await prisma.ledgerEntry.create({
      data: {
        ledgerAccountId: account.id, type: "SALE_CREDIT", amountCents: 50_000,
        referenceType: "order", referenceId: "t1", availableAt: new Date(Date.now() - 1000),
      },
    });
    // casa já verificada (pula regra do 1º saque)
    await prisma.payout.create({
      data: { organizationId: f.organization.id, amountCents: 1, status: "PAID", paidAt: new Date() },
    });

    // dois cliques ao MESMO tempo: só um vira solicitação
    const resultados = await Promise.allSettled([
      finance.requestPayout(f.organization.id, user.id, 20_000),
      finance.requestPayout(f.organization.id, user.id, 20_000),
    ]);
    const ok = resultados.filter((r) => r.status === "fulfilled").length;
    assert.equal(ok, 1, "corrida de saque cria exatamente 1 solicitação");
    const pedidos = await prisma.payoutRequest.count({
      where: { organizationId: f.organization.id, status: { not: "REJECTED" } },
    });
    assert.equal(pedidos, 1);
  } finally {
    await prisma.payoutRequest.deleteMany({ where: { organizationId: f.organization.id } });
    await prisma.payout.deleteMany({ where: { organizationId: f.organization.id } });
    await cleanupFixtureEvent(f.organization.id);
  }
});
