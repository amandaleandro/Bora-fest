import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import * as compartilhado from "@borafest/database";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import * as daApi from "../../../api/src/me/exclusao-de-conta";
import { MeService } from "../../../api/src/me/me.service";
import { createFixtureEvent, cleanupFixtureEvent } from "../../../api/src/__tests__/helpers";
import {
  ACAO_ANONIMIZACAO_POS_EVENTO,
  anonimizarContaApagada,
  contasApagadasPendentes,
  emailsDaPessoa,
  lerAnotacoes,
} from "../anonimizar-contas-apagadas";

// FRENTE WORKER (LGPD, 2026-10-12) — o que a exclusão de conta deixou para
// depois (ingresso, participante, reserva VIP e convite de evento FUTURO) é
// anonimizado pelo worker quando o evento termina, com a MESMA regra
// (@borafest/database). O cenário passa pela exclusão de verdade
// (MeService.deleteAccount) e roda a varredura em três momentos: logo depois
// da exclusão, depois do 1º evento e depois do 2º.

after(async () => {
  await closeRedisConnection();
});

const DIA = 86_400_000;
const rand = () => Math.random().toString(36).slice(2, 10);

function geraCpf(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (base: number[]) => {
    const soma = base.reduce((acc, d, i) => acc + d * (base.length + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  return [...n, d1, dv([...n, d1])].join("");
}

// ---------------------------------------------------------------------------
// Regras puras e a garantia de "uma regra só"
// ---------------------------------------------------------------------------

test("regra compartilhada: o pacote e a exclusão da API têm os mesmos valores e o mesmo comportamento", () => {
  assert.equal(compartilhado.DOMINIO_ANONIMO, daApi.DOMINIO_ANONIMO);
  assert.equal(compartilhado.NOME_REMOVIDO, daApi.NOME_REMOVIDO);
  assert.equal(compartilhado.ENVIO_CANCELADO, daApi.ENVIO_CANCELADO);
  const id = randomUUID();
  assert.equal(compartilhado.emailAnonimoDaConta(id), daApi.emailAnonimoDaConta(id));
  assert.equal(compartilhado.emailAnonimoDoRegistro(id), daApi.emailAnonimoDoRegistro(id));
  const agora = new Date();
  for (const endsAt of [new Date(agora.getTime() - 1), agora, new Date(agora.getTime() + 1)]) {
    assert.equal(compartilhado.eventoJaTerminou(endsAt, agora), daApi.eventoJaTerminou(endsAt, agora));
  }
  const amostras = [
    { payerDocument: "52998224725", amountMismatch: { expectedCents: 5500, paidCents: 5000 } },
    { id: 1, payer: { email: "a@b.com" }, customer: { name: "Maria", document: "1" }, value: 55 },
    { ticketLotId: "l1", email: "a@b.com", emailAntes: "x@y.com", emailDepois: "z@w.com" },
    { de: "maria@x.com", lista: ["joao@y.com", 3, { ip: "1.2.3.4", total: 10 }] },
    "maria@x.com",
    null,
    42,
  ];
  for (const amostra of amostras) {
    assert.deepEqual(compartilhado.semDadoPessoal(amostra as never), daApi.semDadoPessoal(amostra as never));
    const limpo = compartilhado.semDadoPessoal(amostra as never);
    assert.equal(compartilhado.mudou(amostra as never, limpo), daApi.mudou(amostra as never, limpo));
  }
  assert.equal(compartilhado.ehEmailAnonimo(daApi.emailAnonimoDaConta(id)), true);
  assert.equal(compartilhado.ehEmailAnonimo(" APAGADO-x@ANON.BORAFEST.INVALID "), true);
  assert.equal(compartilhado.ehEmailAnonimo("pessoa@borafest.dev"), false);
  assert.equal(compartilhado.ehEmailAnonimo("anon.borafest.invalid@gmail.com"), false);
  assert.equal(compartilhado.ehEmailAnonimo(null), false);
});

test("regra compartilhada: a exclusão de conta grava pelas funções do pacote", () => {
  const fonte = readFileSync(join(__dirname, "../../../api/src/me/me.service.ts"), "utf8");
  assert.match(fonte, /apagarDadosDosIngressos\(tx, ingressosEncerrados\)/);
  assert.match(fonte, /apagarParticipantesDosPedidos\(tx, pedidosEncerrados\)/);
  assert.match(fonte, /apagarReservasVipDeEventoEncerrado\(tx, \{ emails, emailAnonimo, agora \}\)/);
  assert.match(fonte, /apagarEmailDosConvitesDeEventoEncerrado\(tx, \{ emails, agora \}\)/);
  assert.doesNotMatch(fonte, /vipReservation\.updateMany/, "nenhuma cópia da regra do VIP");
  assert.doesNotMatch(fonte, /orderAttendee\.updateMany/, "nenhuma cópia da regra do participante");
});

test("regra: anotações da varredura — 1ª passada, pendentes somados e concluída", () => {
  assert.deepEqual(lerAnotacoes([]), {
    primeiraPassada: true,
    concluida: false,
    ingressosRecebidos: [],
    reservasVip: [],
    convites: [],
  });
  const [v1, v2, c1, i1] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const lidas = lerAnotacoes([
    { pendentes: { reservasVip: [v1], convites: [c1], ingressosRecebidos: [i1] }, concluida: false },
    { pendentes: { reservasVip: [v1, v2, "nao-e-id", 7], convites: "lixo" } },
    null,
    "texto",
    [1, 2],
  ]);
  assert.equal(lidas.primeiraPassada, false);
  assert.equal(lidas.concluida, false);
  assert.deepEqual(lidas.reservasVip.sort(), [v1, v2].sort(), "soma sem repetir, só ids válidos");
  assert.deepEqual(lidas.convites, [c1]);
  assert.deepEqual(lidas.ingressosRecebidos, [i1]);
  assert.equal(lerAnotacoes([{ concluida: "true" }]).concluida, false, "só o booleano conta");
  assert.equal(lerAnotacoes([{}, { concluida: true }]).concluida, true);
});

test("regra: e-mails da pessoa — como gravado e minúsculo; sem anônimo, sintético ou vazio", () => {
  assert.deepEqual(
    emailsDaPessoa([" Maria@X.com ", "maria@x.com", null, undefined, "", "   ", "sem-arroba"]).sort(),
    ["Maria@X.com", "maria@x.com"].sort(),
  );
  assert.deepEqual(
    emailsDaPessoa([
      compartilhado.emailAnonimoDaConta(randomUUID()),
      "pdv-1728000000000@borafest.local",
      `guest-list+${randomUUID()}@borafest.app`,
    ]),
    [],
  );
});

// ---------------------------------------------------------------------------
// Cenário completo: exclusão de verdade + três passadas da varredura
// ---------------------------------------------------------------------------

type Fixture = Awaited<ReturnType<typeof createFixtureEvent>>;

async function novoPedido(
  fx: Fixture,
  dados: {
    userId?: string | null;
    contactEmail: string;
    contactName?: string;
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
      status: "PAID",
      paidAt: new Date(),
      totalCents: 5500 * qtd,
      items: { create: [{ ticketLotId: fx.lot.id, quantity: qtd, priceCents: 5000, feeCents: 500 }] },
      ...(dados.participante ? { attendees: { create: [{ ticketLotId: fx.lot.id, ...dados.participante }] } } : {}),
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
          code: `ANON-${rand()}`,
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

async function novaReservaVip(fx: Fixture, contactEmail: string, createdAt?: Date) {
  const mesa = await prisma.vipInventory.create({
    data: { eventId: fx.event.id, kind: "MESA", name: `Mesa ${rand()}`, unitPriceCents: 10_000, quantity: 1, capacityPerUnit: 4 },
  });
  return prisma.vipReservation.create({
    data: {
      vipInventoryId: mesa.id,
      contactName: "Maria Souza",
      contactEmail,
      contactPhone: "34999990000",
      partySize: 2,
      unitPriceCents: 10_000,
      totalCents: 10_000,
      customerNote: "Aniversário da Maria",
      ...(createdAt ? { createdAt } : {}),
    },
  });
}

async function montarCenario() {
  // evento 1 termina em ~25 h; evento 2 só daqui a 50 dias
  const evento1 = await createFixtureEvent({ lotCapacity: 20 });
  const evento2 = await createFixtureEvent({
    lotCapacity: 20,
    startsAt: new Date(Date.now() + 50 * DIA),
    endsAt: new Date(Date.now() + 50 * DIA + 5 * 3_600_000),
  });
  const sufixo = rand();
  const email = `anon_${sufixo}@borafest.dev`;
  const emailVizinha = `anonx${sufixo}@borafest.dev`;
  const emailAmigo = `amigo-anon-${sufixo}@borafest.dev`;
  const emailOutro = `outro-anon-${sufixo}@borafest.dev`;
  const cpf = geraCpf();

  const pessoa = await prisma.user.create({ data: { email, name: "Maria Souza", cpf, emailVerifiedAt: new Date() } });
  const amigo = await prisma.user.create({ data: { email: emailAmigo, name: "Amigo Teste", emailVerifiedAt: new Date() } });

  // pedido dela no evento 1: um ingresso dela, outro passado ao amigo
  const pedido = await novoPedido(evento1, {
    userId: pessoa.id,
    contactEmail: email,
    contactName: "Maria Souza",
    participante: { name: "Maria Souza", cpf },
    ingressos: [
      { attendeeName: "Maria Souza", attendeeEmail: email, attendeeCpf: cpf },
      { ownerUserId: amigo.id, attendeeName: "Amigo Teste", attendeeEmail: emailAmigo },
    ],
  });
  // pedido sem login com o e-mail dela (outra grafia)
  const pedidoSemDono = await novoPedido(evento1, {
    contactEmail: email.toUpperCase(),
    contactName: "Maria S.",
    ingressos: [{ attendeeName: "Maria S." }],
  });
  // ingresso que o amigo passou PARA ela (pedido do amigo)
  const pedidoDoAmigo = await novoPedido(evento1, {
    userId: amigo.id,
    contactEmail: emailAmigo,
    contactName: "Amigo Teste",
    ingressos: [{ ownerUserId: pessoa.id, attendeeName: "Maria Souza", attendeeEmail: email, attendeeCpf: cpf }],
  });
  // pedido dela (logada) em que ela digitou OUTRO e-mail: o pedido é dela, mas
  // esse e-mail não é o da conta — a exclusão não mexeria na reserva dele
  const pedidoOutroEmail = await novoPedido(evento1, {
    userId: pessoa.id,
    contactEmail: emailOutro,
    contactName: "M. Souza",
    ingressos: [{ attendeeName: "M. Souza", attendeeEmail: emailOutro }],
  });
  // entregas dos ingressos por e-mail (como o worker grava): a do pedido dela
  // foi para o e-mail da conta; a do outro pedido, para o e-mail digitado
  const entregaDela = await prisma.notification.create({
    data: {
      channel: "EMAIL",
      recipient: email,
      template: "ticket_delivery",
      payload: { name: "Maria Souza" },
      status: "SENT",
      sentAt: new Date(),
      orderId: pedido.order.id,
    },
  });
  const entregaOutroEmail = await prisma.notification.create({
    data: {
      channel: "EMAIL",
      recipient: emailOutro,
      template: "ticket_delivery",
      payload: { name: "M. Souza" },
      status: "SENT",
      sentAt: new Date(),
      orderId: pedidoOutroEmail.order.id,
    },
  });

  // reservas VIP: dela nos dois eventos; da vizinha (e-mail quase igual); a
  // do e-mail digitado no outro pedido
  const vip1 = await novaReservaVip(evento1, email);
  const vip2 = await novaReservaVip(evento2, email);
  const vipVizinha = await novaReservaVip(evento1, emailVizinha);
  const vipOutroEmail = await novaReservaVip(evento1, emailOutro);

  // convites: um do evento 1 usado pelo pedido dela; outro do evento 2, só mandado
  const convitePedido = await prisma.lotEmailInvite.create({
    data: {
      ticketLotId: evento1.lot.id,
      email,
      token: `tk-${rand()}${rand()}`,
      status: "CLAIMED",
      orderId: pedido.order.id,
      claimedAt: new Date(),
    },
  });
  const mensagemConvite = await prisma.notification.create({
    data: { channel: "EMAIL", recipient: email, template: "lot_email_invite", payload: { lotName: "VIP" }, status: "SENT", sentAt: new Date() },
  });
  const conviteSoMandado = await prisma.lotEmailInvite.create({
    data: { ticketLotId: evento2.lot.id, email, token: `tk-${rand()}${rand()}`, notificationId: mensagemConvite.id },
  });
  const auditoriaConvite = await prisma.auditLog.create({
    data: {
      organizationId: evento2.organization.id,
      action: "lot_email_invite.resend",
      entityType: "lot_email_invite",
      entityId: conviteSoMandado.id,
      metadata: { ticketLotId: evento2.lot.id, email },
    },
  });

  return {
    evento1,
    evento2,
    email,
    emailOutro,
    cpf,
    pessoa,
    amigo,
    pedido,
    pedidoSemDono,
    pedidoDoAmigo,
    pedidoOutroEmail,
    entregaDela,
    entregaOutroEmail,
    vip1,
    vip2,
    vipVizinha,
    vipOutroEmail,
    convitePedido,
    conviteSoMandado,
    mensagemConvite,
    auditoriaConvite,
  };
}

async function desmontar(c: Awaited<ReturnType<typeof montarCenario>>) {
  await prisma.notification.deleteMany({
    where: { id: { in: [c.mensagemConvite.id, c.entregaDela.id, c.entregaOutroEmail.id] } },
  });
  await prisma.auditLog.deleteMany({
    where: {
      entityId: {
        in: [
          c.pessoa.id,
          c.pedido.order.id,
          c.pedidoSemDono.order.id,
          c.pedidoOutroEmail.order.id,
          ...c.pedido.tickets.map((t) => t.id),
          ...c.pedidoSemDono.tickets.map((t) => t.id),
          ...c.pedidoDoAmigo.tickets.map((t) => t.id),
          ...c.pedidoOutroEmail.tickets.map((t) => t.id),
          c.convitePedido.id,
          c.conviteSoMandado.id,
        ],
      },
    },
  });
  await cleanupFixtureEvent(c.evento1.organization.id);
  await cleanupFixtureEvent(c.evento2.organization.id);
  for (const id of [c.pessoa.id, c.amigo.id]) await prisma.user.delete({ where: { id } }).catch(() => undefined);
}

async function apagadaEmDe(userId: string): Promise<Date> {
  const auditoria = await prisma.auditLog.findFirstOrThrow({
    where: { entityType: "user", entityId: userId, action: "account.delete" },
  });
  return auditoria.createdAt;
}

test("depois do evento: o que a exclusão deixou some, pela mesma regra, e a conta sai da varredura", async () => {
  const c = await montarCenario();
  try {
    await new MeService().deleteAccount(c.pessoa.id);
    const anonimo = compartilhado.emailAnonimoDaConta(c.pessoa.id);
    const apagadaEm = await apagadaEmDe(c.pessoa.id);
    // reserva VIP feita DEPOIS da exclusão com o mesmo e-mail: não é da conta apagada
    const vipDepois = await novaReservaVip(c.evento1, c.email, new Date(apagadaEm.getTime() + 60_000));

    const ingresso = (id: string) => prisma.ticket.findUniqueOrThrow({ where: { id } });
    const vip = (id: string) => prisma.vipReservation.findUniqueOrThrow({ where: { id } });
    const convite = (id: string) => prisma.lotEmailInvite.findUniqueOrThrow({ where: { id } });

    // a exclusão deixou o evento futuro como estava
    assert.equal((await ingresso(c.pedido.tickets[0]!.id)).attendeeCpf, c.cpf);
    assert.equal((await vip(c.vip1.id)).contactEmail, c.email);
    const recipiente = async (id: string) => (await prisma.notification.findUniqueOrThrow({ where: { id } })).recipient;
    assert.equal(await recipiente(c.mensagemConvite.id), anonimo, "mensagem do convite: e-mail da conta → anônimo");
    assert.equal(await recipiente(c.entregaDela.id), anonimo, "entrega do pedido dela: e-mail da conta → anônimo");
    assert.equal(await recipiente(c.entregaOutroEmail.id), c.emailOutro, "e-mail digitado que não é o da conta fica");

    const pendentes = await contasApagadasPendentes(1_000_000);
    assert.ok(pendentes.some((p) => p.userId === c.pessoa.id), "conta excluída entra na varredura");

    // --- passada 1: logo depois da exclusão (nada terminou) -----------------
    const agora = new Date();
    const p1 = await anonimizarContaApagada({ userId: c.pessoa.id, apagadaEm }, agora);
    assert.ok(p1);
    assert.equal(p1.ingressos + p1.participantes + p1.reservasVip + p1.convites, 0, "evento futuro: nada muda ainda");
    assert.equal(p1.concluida, false);
    assert.deepEqual(
      p1.pendentes.reservasVip.sort(),
      [c.vip1.id, c.vip2.id].sort(),
      "as duas reservas com o e-mail da conta — nem a da vizinha, nem a de depois, nem a do e-mail digitado",
    );
    assert.deepEqual(p1.pendentes.convites.sort(), [c.convitePedido.id, c.conviteSoMandado.id].sort());
    assert.deepEqual(p1.pendentes.ingressosRecebidos, [c.pedidoDoAmigo.tickets[0]!.id]);
    assert.equal((await ingresso(c.pedido.tickets[0]!.id)).attendeeName, "Maria Souza");

    // --- passada 2: o evento 1 terminou; o 2 não -----------------------------
    const depoisDo1 = new Date(Date.now() + 3 * DIA);
    const p2 = await anonimizarContaApagada({ userId: c.pessoa.id, apagadaEm }, depoisDo1);
    assert.ok(p2);
    assert.equal(p2.concluida, false, "a reserva do evento 2 ainda vale");

    // ingressos dela (o do pedido, o sem login, o do outro e-mail e o
    // recebido) — sem nome, e-mail e CPF, como a exclusão faria
    const dela = [
      c.pedido.tickets[0]!.id,
      c.pedidoSemDono.tickets[0]!.id,
      c.pedidoOutroEmail.tickets[0]!.id,
      c.pedidoDoAmigo.tickets[0]!.id,
    ];
    for (const id of dela) {
      const t = await ingresso(id);
      assert.equal(t.attendeeName, null);
      assert.equal(t.attendeeEmail, null);
      assert.equal(t.attendeeCpf, null);
      assert.equal(t.status, "ACTIVE", "o ingresso em si não muda");
    }
    assert.equal(p2.ingressos, 4);
    // o que ela passou ao amigo é do amigo
    const doAmigo = await ingresso(c.pedido.tickets[1]!.id);
    assert.equal(doAmigo.attendeeName, "Amigo Teste");

    const [participante] = await prisma.orderAttendee.findMany({ where: { orderId: c.pedido.order.id } });
    assert.equal(participante!.name, compartilhado.NOME_REMOVIDO);
    assert.equal(participante!.cpf, null);

    const vip1 = await vip(c.vip1.id);
    assert.equal(vip1.contactName, compartilhado.NOME_REMOVIDO);
    assert.equal(vip1.contactEmail, anonimo);
    assert.equal(vip1.contactPhone, "");
    assert.equal(vip1.customerNote, null);
    assert.equal(vip1.totalCents, 10_000, "o valor (registro da Casa) fica");
    assert.equal((await vip(c.vip2.id)).contactEmail, c.email, "evento 2 ainda não terminou");
    assert.equal((await vip(c.vipVizinha.id)).contactEmail.startsWith("anonx"), true, "vizinha intacta");
    assert.equal((await vip(vipDepois.id)).contactName, "Maria Souza", "reserva de depois da exclusão intacta");
    assert.equal((await vip(c.vipOutroEmail.id)).contactEmail, c.emailOutro, "e-mail que não era o da conta: intacta");

    assert.equal((await convite(c.convitePedido.id)).email, compartilhado.emailAnonimoDoRegistro(c.convitePedido.id));
    assert.equal((await convite(c.conviteSoMandado.id)).email, c.email, "convite do evento 2 ainda vale");

    // --- passada 3: o evento 2 terminou --------------------------------------
    const depoisDo2 = new Date(Date.now() + 60 * DIA);
    const p3 = await anonimizarContaApagada({ userId: c.pessoa.id, apagadaEm }, depoisDo2);
    assert.ok(p3);
    assert.equal(p3.concluida, true);
    assert.equal((await vip(c.vip2.id)).contactEmail, anonimo);
    assert.equal((await convite(c.conviteSoMandado.id)).email, compartilhado.emailAnonimoDoRegistro(c.conviteSoMandado.id));
    const auditoriaConvite = await prisma.auditLog.findUniqueOrThrow({ where: { id: c.auditoriaConvite.id } });
    assert.deepEqual(auditoriaConvite.metadata, { ticketLotId: c.evento2.lot.id }, "auditoria do convite sem o e-mail");
    assert.equal((await vip(c.vipVizinha.id)).contactName, "Maria Souza", "vizinha intacta até o fim");
    assert.equal((await vip(c.vipOutroEmail.id)).contactName, "Maria Souza", "e-mail digitado intacto até o fim");

    // concluída: sai da varredura e uma nova passada não faz nada
    assert.ok(!(await contasApagadasPendentes(1_000_000)).some((p) => p.userId === c.pessoa.id));
    assert.equal(await anonimizarContaApagada({ userId: c.pessoa.id, apagadaEm }, depoisDo2), null);

    // rastro da varredura: uma linha por passada que mexeu (a 1ª sempre), sem dado pessoal
    const rastro = await prisma.auditLog.findMany({
      where: { entityType: "user", entityId: c.pessoa.id, action: ACAO_ANONIMIZACAO_POS_EVENTO },
    });
    assert.equal(rastro.length, 3);
    assert.ok(rastro.every((r) => r.actorUserId === null));
    const texto = JSON.stringify(rastro.map((r) => r.metadata));
    assert.ok(!texto.includes(c.email) && !texto.includes(c.emailOutro) && !texto.includes(c.cpf) && !texto.includes("Maria"));
  } finally {
    await desmontar(c);
  }
});

test("1ª passada depois que tudo terminou: anonimiza e conclui de uma vez", async () => {
  const c = await montarCenario();
  try {
    await new MeService().deleteAccount(c.pessoa.id);
    const apagadaEm = await apagadaEmDe(c.pessoa.id);
    const r = await anonimizarContaApagada({ userId: c.pessoa.id, apagadaEm }, new Date(Date.now() + 60 * DIA));
    assert.ok(r);
    assert.equal(r.concluida, true);
    assert.equal(r.ingressos, 4);
    assert.equal(r.reservasVip, 2);
    assert.equal(r.convites, 2);
    assert.deepEqual(r.pendentes, { ingressosRecebidos: [], reservasVip: [], convites: [] });
    for (const intacta of [c.vipVizinha.id, c.vipOutroEmail.id]) {
      assert.equal((await prisma.vipReservation.findUniqueOrThrow({ where: { id: intacta } })).contactName, "Maria Souza");
    }
  } finally {
    await desmontar(c);
  }
});

test("e-mail da conta provado só pela entrega do ingresso: acha a reserva VIP do mesmo e-mail", async () => {
  const evento = await createFixtureEvent({ lotCapacity: 5 });
  const email = `so-entrega-${rand()}@borafest.dev`;
  const pessoa = await prisma.user.create({ data: { email, name: "Ana Lima", emailVerifiedAt: new Date() } });
  const pedido = await novoPedido(evento, {
    userId: pessoa.id,
    contactEmail: email,
    contactName: "Ana Lima",
    ingressos: [{ attendeeName: "Ana Lima", attendeeEmail: email }],
  });
  const entrega = await prisma.notification.create({
    data: { channel: "EMAIL", recipient: email, template: "ticket_delivery", payload: {}, status: "SENT", orderId: pedido.order.id },
  });
  const reserva = await novaReservaVip(evento, email);
  try {
    await new MeService().deleteAccount(pessoa.id);
    const apagadaEm = await apagadaEmDe(pessoa.id);
    const p1 = await anonimizarContaApagada({ userId: pessoa.id, apagadaEm }, new Date());
    assert.ok(p1);
    assert.deepEqual(p1.pendentes.reservasVip, [reserva.id], "achada pelo e-mail da entrega");
    const p2 = await anonimizarContaApagada({ userId: pessoa.id, apagadaEm }, new Date(Date.now() + 3 * DIA));
    assert.ok(p2);
    assert.equal(p2.reservasVip, 1);
    assert.equal(p2.concluida, true);
    const salva = await prisma.vipReservation.findUniqueOrThrow({ where: { id: reserva.id } });
    assert.equal(salva.contactEmail, compartilhado.emailAnonimoDaConta(pessoa.id));
    assert.equal(salva.contactName, compartilhado.NOME_REMOVIDO);
  } finally {
    await prisma.notification.deleteMany({ where: { id: entrega.id } });
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [pessoa.id, pedido.order.id, ...pedido.tickets.map((t) => t.id)] } },
    });
    await cleanupFixtureEvent(evento.organization.id);
    await prisma.user.delete({ where: { id: pessoa.id } }).catch(() => undefined);
  }
});

test("conta que não é de exclusão (ou e-mail no formato antigo) fica de fora", async () => {
  const comum = await prisma.user.create({ data: { email: `comum-${rand()}@borafest.dev` } });
  try {
    assert.equal(await anonimizarContaApagada({ userId: comum.id, apagadaEm: new Date() }, new Date()), null);
    assert.equal(
      await prisma.auditLog.count({ where: { entityId: comum.id, action: ACAO_ANONIMIZACAO_POS_EVENTO } }),
      0,
      "nada gravado",
    );
    // e-mail anônimo antigo (8 caracteres) não entra: a regra atual usa o id inteiro
    await prisma.user.update({
      where: { id: comum.id },
      data: { email: `apagado-${comum.id.slice(0, 8)}@${compartilhado.DOMINIO_ANONIMO}` },
    });
    await prisma.auditLog.create({ data: { actorUserId: comum.id, action: "account.delete", entityType: "user", entityId: comum.id } });
    assert.ok(!(await contasApagadasPendentes(1_000_000)).some((p) => p.userId === comum.id));
  } finally {
    await prisma.auditLog.deleteMany({ where: { entityId: comum.id } });
    await prisma.user.delete({ where: { id: comum.id } }).catch(() => undefined);
  }
});
