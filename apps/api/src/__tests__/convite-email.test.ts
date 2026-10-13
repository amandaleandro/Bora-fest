import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { renderLotEmailInviteEmail } from "@borafest/notifications";
import { separarEmailsColados } from "@borafest/contracts";
import { CatalogService } from "../catalog/catalog.service";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { cancelarPedidoGratis } from "../common/cancelar-pedido-gratis";
import { ConvitesEmailService } from "../convites-email/convites-email.service";
import { quandoDoEvento, situacaoDoConvite } from "../convites-email/convite-regras";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// Convite por e-mail (2026-10-12): 3ª forma do ingresso restrito, formato
// Sympla. Toda garantia é provada no SERVIDOR — vitrine, reserva e pedido —
// e no banco, nunca só na tela: o lote some do site, só abre com um convite
// que ainda vale, só sai para o e-mail do convite e cada convite vira um
// pedido só, mesmo com dois cliques ao mesmo tempo.

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);
const consent = { version: "2026-08", terms: true as const, privacy: true as const };

async function montar() {
  const fx = await createFixtureEvent({ lotCapacity: 50, priceCents: 0, feeCents: 0 });
  const dono = await prisma.user.create({ data: { email: `dono-convite-${rand()}@borafest.dev` } });
  await prisma.organizationMember.create({
    data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
  });
  const org = new OrgAccessService();
  return {
    fx,
    dono,
    convites: new ConvitesEmailService(org),
    catalog: new CatalogService(org, new InventoryService()),
    reservations: new ReservationsService(new InventoryService(), new WaitingRoomService()),
    orders: new OrdersService(new CouponsService(org), org),
    emails: [] as string[],
    usuarios: [dono.id] as string[],
  };
}
type Ctx = Awaited<ReturnType<typeof montar>>;

async function desmontar(ctx: Ctx) {
  const lotes = await prisma.ticketLot.findMany({
    where: { ticketType: { eventId: ctx.fx.event.id } },
    select: { id: true },
  });
  const convites = await prisma.lotEmailInvite.findMany({
    where: { ticketLotId: { in: lotes.map((l) => l.id) } },
    select: { notificationId: true },
  });
  const pedidos = await prisma.order.findMany({ where: { eventId: ctx.fx.event.id }, select: { id: true } });
  const idsPedidos = pedidos.map((p) => p.id);
  await prisma.notification.deleteMany({
    where: {
      OR: [
        { orderId: { in: idsPedidos } },
        { template: "lot_email_invite", recipient: { in: ctx.emails } },
        { id: { in: convites.map((c) => c.notificationId).filter((id): id is string => Boolean(id)) } },
      ],
    },
  });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: idsPedidos } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: ctx.fx.organization.id } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: ctx.fx.organization.id } });
  // os convites saem junto com o lote (ON DELETE CASCADE)
  await cleanupFixtureEvent(ctx.fx.organization.id);
  await prisma.user.deleteMany({ where: { email: { in: ctx.emails } } }).catch(() => undefined);
  for (const id of ctx.usuarios) await prisma.user.delete({ where: { id } }).catch(() => undefined);
}

/** Lote "Só quem eu convidar por e-mail", já à venda. */
async function loteDeConvite(ctx: Ctx, extra: { priceCents?: number; maxPerOrder?: number } = {}) {
  return prisma.ticketLot.create({
    data: {
      ticketTypeId: ctx.fx.ticketType.id,
      name: `Convidados ${rand()}`,
      priceCents: extra.priceCents ?? 0,
      feeCents: 0,
      capacity: 10,
      maxPerOrder: extra.maxPerOrder ?? 2,
      inviteMode: "EMAIL",
      status: "ACTIVE",
    },
  });
}

function emailNovo(ctx: Ctx, prefixo = "convidado"): string {
  const email = `${prefixo}-${rand()}@example.com`;
  ctx.emails.push(email);
  return email;
}

async function conviteDe(lotId: string, email: string) {
  return prisma.lotEmailInvite.findUniqueOrThrow({ where: { ticketLotId_email: { ticketLotId: lotId, email } } });
}

function idsDosLotes(evento: { ticketTypes: Array<{ lots: Array<{ id: string }> }> }) {
  return evento.ticketTypes.flatMap((t) => t.lots.map((l) => l.id));
}

test("vitrine: o lote some do site e só abre com um convite que ainda vale; o código nunca vaza", async () => {
  const ctx = await montar();
  try {
    const lote = await loteDeConvite(ctx);
    const email = emailNovo(ctx);
    const r = await ctx.convites.criar(lote.id, ctx.dono.id, [email]);
    assert.deepEqual(r.enviados, [email]);
    const convite = await conviteDe(lote.id, email);
    assert.ok(convite.token.length >= 20, "código de 128 bits");

    const publico = await ctx.catalog.getPublicEvent(ctx.fx.event.slug);
    assert.ok(!idsDosLotes(publico).includes(lote.id), "sem o convite, o lote não aparece");
    assert.ok(idsDosLotes(publico).includes(ctx.fx.lot.id), "o lote aberto continua");

    const comConvite = await ctx.catalog.getPublicEvent(ctx.fx.event.slug, undefined, convite.token);
    assert.ok(idsDosLotes(comConvite).includes(lote.id), "com o convite, o lote aparece");
    const todos = comConvite.ticketTypes.flatMap((t) => t.lots) as Array<{ inviteToken: string | null }>;
    assert.ok(todos.every((l) => l.inviteToken === null), "nenhum código sai na resposta pública");
    assert.ok(!JSON.stringify(comConvite).includes(convite.token), "o código do convite também não");

    const errado = await ctx.catalog.getPublicEvent(ctx.fx.event.slug, undefined, `x${rand()}${rand()}`);
    assert.ok(!idsDosLotes(errado).includes(lote.id), "código que não existe não abre nada");

    const estoque = await ctx.catalog.getPublicAvailability(ctx.fx.event.slug, undefined, convite.token);
    assert.ok(estoque.some((l) => l.lotId === lote.id), "o estoque aparece para quem tem o convite");
    const semConvite = await ctx.catalog.getPublicAvailability(ctx.fx.event.slug);
    assert.ok(!semConvite.some((l) => l.lotId === lote.id), "e não vaza para quem não tem");

    // revogado não abre mais (a disponibilidade não tem cache)
    await ctx.convites.revogar(convite.id, ctx.dono.id);
    const depois = await ctx.catalog.getPublicAvailability(ctx.fx.event.slug, undefined, convite.token);
    assert.ok(!depois.some((l) => l.lotId === lote.id), "convite revogado não abre o lote");
  } finally {
    await desmontar(ctx);
  }
});

test("envio: normaliza, recusa formato e typo, ignora repetido e cria o e-mail junto com o convite", async () => {
  const ctx = await montar();
  try {
    const lote = await loteDeConvite(ctx);
    const email = emailNovo(ctx, "ana");
    const r = await ctx.convites.criar(lote.id, ctx.dono.id, [
      `  ${email.toUpperCase()} `,
      email,
      "nao-e-email",
      `fulano-${rand()}@gmail.comm`,
      "guest-list+abc@borafest.app",
    ]);
    assert.deepEqual(r.enviados, [email], "e-mail normalizado (sem espaço, minúsculo)");
    assert.equal(r.repetidosNaLista, 1);
    assert.equal(r.invalidos.length, 3);
    assert.ok(r.invalidos.some((i) => /Você quis dizer/.test(i.motivo)), "typo certo vem com a sugestão");

    const convite = await conviteDe(lote.id, email);
    assert.equal(convite.status, "SENT");
    const aviso = await prisma.notification.findUniqueOrThrow({ where: { id: convite.notificationId! } });
    assert.equal(aviso.template, "lot_email_invite");
    assert.equal(aviso.recipient, email);
    const payload = aviso.payload as { conviteUrl: string; eventTitle: string; casa: string };
    assert.ok(payload.conviteUrl.endsWith(`/${ctx.fx.event.slug}?convite=${convite.token}`), "link pessoal do evento");
    assert.equal(payload.eventTitle, ctx.fx.event.title);

    const rastro = await prisma.auditLog.findFirstOrThrow({
      where: { action: "lot_email_invite.create", entityId: lote.id },
    });
    assert.equal(rastro.actorUserId, ctx.dono.id);
    assert.ok(!JSON.stringify(rastro.metadata).includes(convite.token), "o código não vai para o histórico");

    // colar de novo: ninguém recebe e-mail repetido
    const deNovo = await ctx.convites.criar(lote.id, ctx.dono.id, [email]);
    assert.deepEqual(deNovo.enviados, []);
    assert.deepEqual(deNovo.jaConvidados, [email]);
    assert.equal(await prisma.notification.count({ where: { template: "lot_email_invite", recipient: email } }), 1);

    // revogado e colado de novo: volta a valer, com link NOVO
    await ctx.convites.revogar(convite.id, ctx.dono.id);
    const reconvite = await ctx.convites.criar(lote.id, ctx.dono.id, [email]);
    assert.deepEqual(reconvite.enviados, [email]);
    const novo = await conviteDe(lote.id, email);
    assert.equal(novo.status, "SENT");
    assert.notEqual(novo.token, convite.token, "o link antigo (que pode ter vazado) não volta");

    // limite por envio vale no serviço, não só no corpo validado
    await assert.rejects(
      ctx.convites.criar(lote.id, ctx.dono.id, Array.from({ length: 201 }, (_, i) => `x${i}@example.com`)),
      /no máximo 200/,
    );
  } finally {
    await desmontar(ctx);
  }
});

test("clique duplo no Enviar: um convite e um e-mail por pessoa", async () => {
  const ctx = await montar();
  try {
    const lote = await loteDeConvite(ctx);
    const a = emailNovo(ctx);
    const b = emailNovo(ctx);
    const [r1, r2] = await Promise.all([
      ctx.convites.criar(lote.id, ctx.dono.id, [a, b]),
      ctx.convites.criar(lote.id, ctx.dono.id, [a, b]),
    ]);
    assert.equal(r1.enviados.length + r2.enviados.length, 2, "cada e-mail foi enviado por uma chamada só");
    assert.equal(await prisma.lotEmailInvite.count({ where: { ticketLotId: lote.id } }), 2);
    assert.equal(
      await prisma.notification.count({ where: { template: "lot_email_invite", recipient: { in: [a, b] } } }),
      2,
      "um e-mail por pessoa",
    );
  } finally {
    await desmontar(ctx);
  }
});

test("reserva e pedido: exigem o convite e o e-mail dele; cada convite vira um pedido só", async () => {
  const ctx = await montar();
  try {
    const lote = await loteDeConvite(ctx);
    const email = emailNovo(ctx);
    await ctx.convites.criar(lote.id, ctx.dono.id, [email]);
    const convite = await conviteDe(lote.id, email);

    const reservar = (inviteToken?: string) =>
      ctx.reservations.create(undefined, {
        eventId: ctx.fx.event.id,
        items: [{ ticketLotId: lote.id, quantity: 1 }],
        inviteToken,
      });
    await assert.rejects(reservar(), /convidado por e-mail/, "sem o link, não reserva");
    await assert.rejects(reservar(`codigo-${rand()}-errado`), /convidado por e-mail/);

    // e-mail diferente do convite: recusa clara
    const r0 = await reservar(convite.token);
    const outroEmail = emailNovo(ctx, "outra");
    await assert.rejects(
      ctx.orders.createFromReservation(undefined, {
        reservationId: r0.id,
        contactEmail: outroEmail,
        contactName: "Outra Pessoa",
        consent,
      }),
      /mesmo e-mail que recebeu o convite/,
    );

    // conectado com OUTRA conta: o ingresso iria para a carteira errada
    const intruso = await prisma.user.create({ data: { email: emailNovo(ctx, "intruso") } });
    ctx.usuarios.push(intruso.id);
    await assert.rejects(
      ctx.orders.createFromReservation(intruso.id, {
        reservationId: r0.id,
        contactEmail: email,
        contactName: "Convidado",
        consent,
      }),
      /outra conta/,
    );

    // dois pedidos com o MESMO convite ao mesmo tempo: só um passa
    const r1 = await reservar(convite.token);
    const pedir = (reservationId: string) =>
      ctx.orders.createFromReservation(undefined, {
        reservationId,
        contactEmail: email,
        contactName: "Convidado",
        consent,
      });
    const resultados = await Promise.allSettled([pedir(r0.id), pedir(r1.id)]);
    const ok = resultados.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof pedir>>> => r.status === "fulfilled");
    const recusados = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.equal(ok.length, 1, "um convite, um pedido");
    assert.equal(recusados.length, 1);
    assert.match(String((recusados[0].reason as Error).message), /convite/);

    const pedido = ok[0].value;
    assert.equal(pedido.status, "PAID", "grátis nasce pago");
    const usado = await conviteDe(lote.id, email);
    assert.equal(usado.status, "CLAIMED");
    assert.equal(usado.orderId, pedido.id);
    assert.ok(usado.claimedAt);
    assert.equal((await prisma.ticketLot.findUniqueOrThrow({ where: { id: lote.id } })).soldCount, 1, "uma vaga vendida");
    assert.equal(await prisma.order.count({ where: { eventId: ctx.fx.event.id } }), 1, "o pedido recusado não ficou gravado");

    // usado: não reserva mais
    await assert.rejects(reservar(convite.token), /já foi usado/);
  } finally {
    await desmontar(ctx);
  }
});

test("conectado com a conta do próprio convite: pega normalmente", async () => {
  const ctx = await montar();
  try {
    const lote = await loteDeConvite(ctx);
    const email = emailNovo(ctx);
    const dona = await prisma.user.create({ data: { email } });
    ctx.usuarios.push(dona.id);
    await ctx.convites.criar(lote.id, ctx.dono.id, [email]);
    const convite = await conviteDe(lote.id, email);
    const reserva = await ctx.reservations.create(dona.id, {
      eventId: ctx.fx.event.id,
      items: [{ ticketLotId: lote.id, quantity: 1 }],
      inviteToken: convite.token,
    });
    const pedido = await ctx.orders.createFromReservation(dona.id, {
      reservationId: reserva.id,
      contactEmail: email.toUpperCase(),
      contactName: "Dona do Convite",
      consent,
    });
    assert.equal(pedido.userId, dona.id);
    assert.equal((await conviteDe(lote.id, email)).orderId, pedido.id);
  } finally {
    await desmontar(ctx);
  }
});

test("cancelar o grátis devolve o convite; pedido pago que expirou libera o convite sozinho", async () => {
  const ctx = await montar();
  try {
    // GRÁTIS: "Cancelar ingresso" (ou "Não vou mais") devolve o convite
    const gratis = await loteDeConvite(ctx);
    const email = emailNovo(ctx);
    await ctx.convites.criar(gratis.id, ctx.dono.id, [email]);
    const convite = await conviteDe(gratis.id, email);
    const reserva = await ctx.reservations.create(undefined, {
      eventId: ctx.fx.event.id,
      items: [{ ticketLotId: gratis.id, quantity: 1 }],
      inviteToken: convite.token,
    });
    const pedido = await ctx.orders.createFromReservation(undefined, {
      reservationId: reserva.id,
      contactEmail: email,
      contactName: "Convidado",
      consent,
    });
    await assert.rejects(ctx.convites.publico(convite.token), /já foi usado/);

    await cancelarPedidoGratis(pedido.id, ctx.dono.id, "teste");
    const devolvido = await conviteDe(gratis.id, email);
    assert.equal(devolvido.status, "SENT", "o convite volta a valer");
    assert.equal(devolvido.orderId, null);
    const rastro = await prisma.auditLog.findFirstOrThrow({
      where: { action: "order.free_cancel", entityId: pedido.id },
    });
    assert.equal((rastro.metadata as { convitesDevolvidos: number }).convitesDevolvidos, 1);
    const aberto = await ctx.convites.publico(convite.token);
    assert.equal(aberto.email, email, "o link volta a abrir");

    // PAGO: o Pix venceu e o pedido expirou — o convite volta sem ninguém mexer
    const pago = await loteDeConvite(ctx, { priceCents: 2000 });
    const emailPago = emailNovo(ctx, "pago");
    await ctx.convites.criar(pago.id, ctx.dono.id, [emailPago]);
    const convitePago = await conviteDe(pago.id, emailPago);
    const reservaPaga = await ctx.reservations.create(undefined, {
      eventId: ctx.fx.event.id,
      items: [{ ticketLotId: pago.id, quantity: 1 }],
      inviteToken: convitePago.token,
    });
    const pendente = await ctx.orders.createFromReservation(undefined, {
      reservationId: reservaPaga.id,
      contactEmail: emailPago,
      contactName: "Pagante",
      consent,
    });
    assert.equal(pendente.status, "PAYMENT_PENDING");
    let lista = await ctx.convites.listar(pago.id, ctx.dono.id);
    assert.equal(lista.convites[0].situacao, "PAGANDO");
    assert.equal(lista.convites[0].podeRevogar, false, "convite com pedido em andamento não se revoga");
    await assert.rejects(ctx.convites.publico(convitePago.token), /já foi usado/);

    await prisma.order.update({ where: { id: pendente.id }, data: { status: "EXPIRED" } });
    lista = await ctx.convites.listar(pago.id, ctx.dono.id);
    assert.equal(lista.convites[0].situacao, "ENVIADO", "pedido sem ingresso não prende o convite");
    assert.equal((await ctx.convites.publico(convitePago.token)).email, emailPago);
    const outraReserva = await ctx.reservations.create(undefined, {
      eventId: ctx.fx.event.id,
      items: [{ ticketLotId: pago.id, quantity: 1 }],
      inviteToken: convitePago.token,
    });
    const segundo = await ctx.orders.createFromReservation(undefined, {
      reservationId: outraReserva.id,
      contactEmail: emailPago,
      contactName: "Pagante",
      consent,
    });
    assert.equal((await conviteDe(pago.id, emailPago)).orderId, segundo.id, "o convite passa para o pedido novo");
  } finally {
    await desmontar(ctx);
  }
});

test("link público: e-mail, evento e lote só para convite que vale; 404 e 410 nos outros", async () => {
  const ctx = await montar();
  try {
    const lote = await loteDeConvite(ctx);
    const email = emailNovo(ctx);
    await ctx.convites.criar(lote.id, ctx.dono.id, [email]);
    const convite = await conviteDe(lote.id, email);

    const aberto = await ctx.convites.publico(convite.token);
    assert.equal(aberto.email, email, "o dono do link vê o próprio e-mail (o checkout trava nele)");
    assert.equal(aberto.eventSlug, ctx.fx.event.slug);
    assert.equal(aberto.lote.id, lote.id);
    assert.ok(!JSON.stringify(aberto).includes(convite.token));

    await assert.rejects(ctx.convites.publico(`nao-existe-${rand()}`), (e: { status?: number }) => e.status === 404);
    await assert.rejects(ctx.convites.publico("curto"), (e: { status?: number }) => e.status === 404);

    await ctx.convites.revogar(convite.id, ctx.dono.id);
    await assert.rejects(
      ctx.convites.publico(convite.token),
      (e: { status?: number; message?: string }) => e.status === 410 && /cancelado pela produção/.test(e.message ?? ""),
    );
  } finally {
    await desmontar(ctx);
  }
});

test("produtor: permissão, motivo para não mandar, reenviar com trava e corrigir com link novo", async () => {
  const ctx = await montar();
  try {
    const lote = await loteDeConvite(ctx);
    const email = emailNovo(ctx);

    // sem ser da organização: não vê nem convida
    const estranho = await prisma.user.create({ data: { email: emailNovo(ctx, "estranho") } });
    ctx.usuarios.push(estranho.id);
    await assert.rejects(ctx.convites.listar(lote.id, estranho.id), /Sem permissão/);
    await assert.rejects(ctx.convites.criar(lote.id, estranho.id, [email]), /Sem permissão/);

    // lote aberto ao público não é de convite
    await assert.rejects(ctx.convites.criar(ctx.fx.lot.id, ctx.dono.id, [email]), /não é de convite por e-mail/);

    // lote ainda não ativo / evento em rascunho: o link não abriria
    await prisma.ticketLot.update({ where: { id: lote.id }, data: { status: "DRAFT" } });
    await assert.rejects(ctx.convites.criar(lote.id, ctx.dono.id, [email]), /Ative o lote/);
    await prisma.ticketLot.update({ where: { id: lote.id }, data: { status: "ACTIVE" } });
    await prisma.event.update({ where: { id: ctx.fx.event.id }, data: { status: "DRAFT" } });
    await assert.rejects(ctx.convites.criar(lote.id, ctx.dono.id, [email]), /Publique o evento/);
    const travada = await ctx.convites.listar(lote.id, ctx.dono.id);
    assert.match(travada.motivoParaNaoMandar ?? "", /Publique o evento/, "a tela recebe o motivo");
    await prisma.event.update({ where: { id: ctx.fx.event.id }, data: { status: "PUBLISHED" } });

    await ctx.convites.criar(lote.id, ctx.dono.id, [email]);
    const convite = await conviteDe(lote.id, email);

    // reenviar logo depois de mandar: um e-mail só (clique duplo, impaciência)
    await assert.rejects(ctx.convites.reenviar(convite.id, ctx.dono.id), /acabou de ser enviado/);
    await prisma.lotEmailInvite.update({
      where: { id: convite.id },
      data: { sentAt: new Date(Date.now() - 10 * 60_000) },
    });
    const [a, b] = await Promise.allSettled([
      ctx.convites.reenviar(convite.id, ctx.dono.id),
      ctx.convites.reenviar(convite.id, ctx.dono.id),
    ]);
    assert.equal([a, b].filter((r) => r.status === "fulfilled").length, 1, "dois cliques, um reenvio");
    const reenviado = await conviteDe(lote.id, email);
    assert.equal(reenviado.token, convite.token, "reenviar mantém o mesmo link");
    assert.notEqual(reenviado.notificationId, convite.notificationId);
    assert.equal(await prisma.notification.count({ where: { template: "lot_email_invite", recipient: email } }), 2);
    assert.equal(
      await prisma.auditLog.count({ where: { action: "lot_email_invite.resend", entityId: convite.id } }),
      1,
    );

    // corrigir: e-mail novo, link novo; o antigo para de abrir
    const certo = emailNovo(ctx, "certo");
    await assert.rejects(ctx.convites.corrigir(convite.id, ctx.dono.id, email), /mesmo e-mail/);
    await assert.rejects(ctx.convites.corrigir(convite.id, ctx.dono.id, "isso nao e email"), /inválido/);
    const outro = emailNovo(ctx, "ja-convidado");
    await ctx.convites.criar(lote.id, ctx.dono.id, [outro]);
    await assert.rejects(ctx.convites.corrigir(convite.id, ctx.dono.id, outro), /já tem convite neste lote/);

    const corrigido = await ctx.convites.corrigir(convite.id, ctx.dono.id, certo);
    assert.equal(corrigido.email, certo);
    const depois = await prisma.lotEmailInvite.findUniqueOrThrow({ where: { id: convite.id } });
    assert.notEqual(depois.token, convite.token);
    await assert.rejects(ctx.convites.publico(convite.token), (e: { status?: number }) => e.status === 404);
    assert.equal((await ctx.convites.publico(depois.token)).email, certo);
    const rastro = await prisma.auditLog.findFirstOrThrow({
      where: { action: "lot_email_invite.correct", entityId: convite.id },
    });
    assert.deepEqual(rastro.metadata, { ticketLotId: lote.id, emailAntes: email, emailDepois: certo });

    // revogar duas vezes (dois cliques): um registro só, sem erro
    await Promise.all([ctx.convites.revogar(convite.id, ctx.dono.id), ctx.convites.revogar(convite.id, ctx.dono.id)]);
    assert.equal(await prisma.auditLog.count({ where: { action: "lot_email_invite.revoke", entityId: convite.id } }), 1);
    await assert.rejects(ctx.convites.reenviar(convite.id, ctx.dono.id), /revogado/);
  } finally {
    await desmontar(ctx);
  }
});

test("situação vem da entrega do e-mail: voltou pede Corrigir, não Reenviar", async () => {
  const ctx = await montar();
  try {
    const lote = await loteDeConvite(ctx);
    const email = emailNovo(ctx);
    await ctx.convites.criar(lote.id, ctx.dono.id, [email]);
    const convite = await conviteDe(lote.id, email);

    let lista = await ctx.convites.listar(lote.id, ctx.dono.id);
    assert.equal(lista.convites[0].situacao, "ENVIADO");
    assert.ok(!("token" in lista.convites[0]), "o código do link não vai para a tela");

    await prisma.notification.update({ where: { id: convite.notificationId! }, data: { bouncedAt: new Date() } });
    lista = await ctx.convites.listar(lote.id, ctx.dono.id);
    assert.equal(lista.convites[0].situacao, "VOLTOU");
    assert.equal(lista.convites[0].podeReenviar, false);
    assert.equal(lista.convites[0].podeCorrigir, true);
    assert.equal(lista.resumo.voltaram, 1);

    await prisma.notification.update({
      where: { id: convite.notificationId! },
      data: { bouncedAt: null, status: "FAILED" },
    });
    lista = await ctx.convites.listar(lote.id, ctx.dono.id);
    assert.equal(lista.convites[0].situacao, "NAO_SAIU");

    // regras puras
    assert.equal(situacaoDoConvite({ status: "CLAIMED" }, { status: "FULFILLED" }, null), "PEGOU");
    assert.equal(situacaoDoConvite({ status: "CLAIMED" }, { status: "REFUNDED" }, null), "ENVIADO");
    assert.equal(situacaoDoConvite({ status: "REVOKED" }, null, null), "REVOGADO");
    assert.equal(
      situacaoDoConvite({ status: "SENT" }, null, { status: "SENT", deliveredAt: new Date(), bouncedAt: null }),
      "ENTREGUE",
    );
  } finally {
    await desmontar(ctx);
  }
});

test("e-mail do convite: texto do protótipo, link pessoal e data no fuso do evento", () => {
  const msg = renderLotEmailInviteEmail("carlos.m@hotmail.com", {
    casa: "Casa <Noturna> X",
    eventTitle: "Festa Fechada",
    eventStartsAt: "sexta, 17/10, 23h",
    conviteUrl: "https://borafest.com.br/festa-fechada?convite=abc_DEF-123",
  });
  assert.equal(msg.subject, "Você foi convidado — Festa Fechada ✨");
  assert.match(msg.text, /Casa <Noturna> X te convidou para Festa Fechada, sexta, 17\/10, 23h\./);
  assert.match(msg.text, /O convite é pessoal: toque em "Pegar meu ingresso" e confirme seus dados\./);
  assert.match(msg.text, /https:\/\/borafest\.com\.br\/festa-fechada\?convite=abc_DEF-123/);
  assert.match(msg.html, /Pegar meu ingresso<\/a>/);
  assert.ok(!msg.html.includes("<Noturna>"), "nome da casa escapado no HTML");

  assert.equal(quandoDoEvento(new Date("2026-10-17T02:00:00Z"), "America/Sao_Paulo"), "sexta, 16/10, 23h");
  assert.equal(quandoDoEvento(new Date("2026-10-17T22:30:00Z"), "America/Sao_Paulo"), "sábado, 17/10, 19h30");
  assert.equal(quandoDoEvento(new Date(), "Fuso/Inexistente"), null, "fuso inválido não derruba o envio");

  assert.deepEqual(
    separarEmailsColados("Ana <Ana@Gmail.com>\ncarlos@x.com, bia@y.com.br; d@e.com f@g.com\n\n texto solto "),
    ["ana@gmail.com", "carlos@x.com", "bia@y.com.br", "d@e.com", "f@g.com", "texto solto"],
  );
});
