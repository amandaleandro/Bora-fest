import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@borafest/database";
import { generateEventKeyPair, generateTicketCode, parseTicketToken, signTicketToken } from "@borafest/tickets";
import { CheckinsService } from "../checkins/checkins.service";
import { ValidatorService } from "../validator/validator.service";
import { OrgAccessService } from "../common/org-access.service";
import { TicketsService } from "../tickets/tickets.service";
import { ehOQrAtual, qrAtualDoIngresso } from "../checkins/qr-atual";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// SÓ O QR ATUAL VALE NA PORTA (2026-10-12). Falha confirmada: depois de
// transferir um ingresso, o QR ANTIGO continuava entrando — a porta só
// conferia a assinatura, e o QR de antes foi assinado pela mesma chave.
// Provado no banco, pelos dois caminhos da porta:
//  1. online: QR antigo recusado com OLD_QR (sem consumir o ingresso nem
//     mostrar o novo dono), QR novo entra, e o antigo segue recusado depois;
//  2. offline: o manifesto (full e delta) leva o nonce do QR atual — nunca o
//     token — e o formato sobe para 4;
//  3. duas transferências ao mesmo tempo: só uma grava.
// Rodar: cd apps/api && pnpm exec tsx --test src/__tests__/qr-antigo-transferencia.test.ts

const rand = () => Math.random().toString(36).slice(2, 10);
const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** motivo da recusa — só as respostas INVALID trazem `reason` */
const motivo = (r: object) => ("reason" in r ? (r as { reason?: unknown }).reason : undefined);

async function montar() {
  const fx = await createFixtureEvent({ lotCapacity: 10, priceCents: 5000, feeCents: 0 });
  const chave = generateEventKeyPair();
  await prisma.eventSigningKey.create({
    data: { eventId: fx.event.id, publicKeyPem: chave.publicKeyPem, privateKeyPem: chave.privateKeyPem },
  });

  const comprador = await prisma.user.create({
    data: { name: "Comprador QR", email: `comprador-qr-${rand()}@borafest.dev`, emailVerifiedAt: new Date() },
  });
  const reservation = await prisma.reservation.create({
    data: { eventId: fx.event.id, status: "CONVERTED", expiresAt: new Date() },
  });
  const order = await prisma.order.create({
    data: {
      eventId: fx.event.id,
      reservationId: reservation.id,
      userId: comprador.id,
      contactEmail: comprador.email!,
      contactName: "Comprador QR",
      status: "FULFILLED",
      // pago: cortesia (R$ 0) é intransferível
      totalCents: 5000,
    },
  });
  const item = await prisma.orderItem.create({
    data: { orderId: order.id, ticketLotId: fx.lot.id, quantity: 1, priceCents: 5000, feeCents: 0 },
  });

  // QR emitido como o worker emite (issue-tickets.ts), uma hora antes
  const ticketId = randomUUID();
  const qrOriginal = signTicketToken(
    {
      v: 1,
      eid: fx.event.id,
      tid: ticketId,
      lid: fx.lot.id,
      n: randomBytes(8).toString("base64url"),
      iat: Math.floor(Date.now() / 1000) - 3600,
    },
    chave.privateKeyPem,
  );
  const ticket = await prisma.ticket.create({
    data: {
      id: ticketId,
      orderId: order.id,
      orderItemId: item.id,
      eventId: fx.event.id,
      ticketLotId: fx.lot.id,
      seq: 1,
      code: generateTicketCode(),
      qrToken: qrOriginal,
      status: "ACTIVE",
      attendeeName: "Comprador QR",
      attendeeEmail: comprador.email,
    },
  });

  const credential = await prisma.validatorCredential.create({
    data: {
      eventId: fx.event.id,
      label: `Portão QR ${rand()}`,
      pinHash: "n/a",
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  const device = await prisma.validatorDevice.create({
    data: { credentialId: credential.id, eventId: fx.event.id, name: "Aparelho QR", tokenHash: "n/a", status: "ACTIVE" },
  });

  return {
    fx,
    comprador,
    ticket,
    qrOriginal,
    device,
    usuarios: [comprador.id] as string[],
    checkins: new CheckinsService(new OrgAccessService()),
    validator: new ValidatorService(new OrgAccessService()),
    tickets: new TicketsService(),
  };
}
type Ctx = Awaited<ReturnType<typeof montar>>;

async function novoUsuario(ctx: Ctx, nome: string) {
  const user = await prisma.user.create({
    data: { name: nome, email: `destino-qr-${rand()}@borafest.dev`, emailVerifiedAt: new Date() },
  });
  ctx.usuarios.push(user.id);
  return user;
}

async function desmontar(ctx: Ctx) {
  const emails = (
    await prisma.user.findMany({ where: { id: { in: ctx.usuarios } }, select: { email: true } })
  )
    .map((u) => u.email)
    .filter((e): e is string => Boolean(e));
  await prisma.notification.deleteMany({ where: { recipient: { in: emails }, template: "ticket_transferred" } });
  await prisma.auditLog.deleteMany({ where: { entityId: ctx.ticket.id } });
  await cleanupFixtureEvent(ctx.fx.organization.id);
  await prisma.user.deleteMany({ where: { id: { in: ctx.usuarios } } }).catch(() => undefined);
}

test("regra pura: só a parte assinada idêntica é o QR atual; nonce e emissão saem do QR gravado", () => {
  const chave = generateEventKeyPair();
  const base = { v: 1 as const, eid: "evt", tid: "tkt", lid: "lot", iat: 1_760_000_000 };
  const atual = signTicketToken({ ...base, n: "nonce-atual" }, chave.privateKeyPem);
  const antigo = signTicketToken({ ...base, n: "nonce-antigo", iat: base.iat - 60 }, chave.privateKeyPem);

  assert.equal(ehOQrAtual(atual, atual), true);
  // o leitor pode deixar espaço/quebra de linha nas pontas: não vira recusa falsa
  assert.equal(ehOQrAtual(`${atual}\n`, atual), true);
  assert.equal(ehOQrAtual(`  ${atual}  `, atual), true);
  assert.equal(ehOQrAtual(antigo, atual), false, "QR de antes da troca não é o atual");
  assert.equal(ehOQrAtual(atual, "n/a"), false, "QR gravado fora do padrão nunca casa");
  assert.equal(ehOQrAtual("lixo", "lixo"), false, "texto sem o formato BF1 nunca casa");

  assert.deepEqual(qrAtualDoIngresso(atual), { n: "nonce-atual", iat: base.iat });
  assert.equal(qrAtualDoIngresso("n/a"), null, "QR gravado fora do padrão: a porta offline não tem o que comparar");
});

test("transferir: QR antigo recusado online, QR novo entra; o manifesto leva o nonce atual", async () => {
  const ctx = await montar();
  try {
    const { ticket, qrOriginal, device } = ctx;
    const nonceOriginal = parseTicketToken(qrOriginal).n;

    // ANTES: o manifesto já sai no formato 4, com o nonce do QR que vale
    const antes = await ctx.validator.getManifest(device);
    assert.equal(antes.manifestSchema, 4, "o servidor confirma o formato com qrAtual");
    const noManifestoAntes = antes.tickets.find((t) => t.id === ticket.id);
    assert.ok(noManifestoAntes, "ingresso no manifesto");
    assert.equal(noManifestoAntes.qrAtual?.n, nonceOriginal);

    const marco = new Date();
    await esperar(5);

    const novoDono = await novoUsuario(ctx, "Novo Dono QR");
    await ctx.tickets.transferTicket(ticket.id, ctx.comprador.id, { toEmail: novoDono.email! });
    const depois = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    const qrNovo = depois.qrToken;
    assert.notEqual(qrNovo, qrOriginal, "a transferência reassina o QR");
    // o código digitável também muda (revisão 2026-10-13): o antigo não abre a porta
    assert.notEqual(depois.code, ticket.code, "a transferência troca o código curto");
    const pelaDigitacao = await ctx.checkins.create(device, { code: ticket.code });
    assert.equal(pelaDigitacao.result, "INVALID");
    assert.equal(motivo(pelaDigitacao), "NOT_FOUND", "código antigo digitado não acha ingresso");
    const avisoAoNovoDono = await prisma.notification.findFirstOrThrow({
      where: { template: "ticket_transferred", recipient: novoDono.email! },
    });
    assert.equal((avisoAoNovoDono.payload as { code?: string }).code, depois.code, "o e-mail leva o código novo");

    // ONLINE: o QR antigo tem assinatura boa, mas não é mais o do ingresso
    const recusa = await ctx.checkins.create(device, { qrToken: qrOriginal });
    assert.equal(recusa.result, "INVALID");
    assert.equal(motivo(recusa), "OLD_QR", "motivo: QR antigo — ingresso transferido");
    assert.ok(!("ticket" in recusa), "o novo dono não aparece na tela de quem mostrou o QR antigo");

    const intacto = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    assert.equal(intacto.status, "ACTIVE", "QR antigo não consome o ingresso do novo dono");
    assert.equal(await prisma.checkin.count({ where: { ticketId: ticket.id } }), 0, "nenhuma entrada registrada");

    const rastro = await prisma.auditLog.findFirst({
      where: { action: "checkin.qr_antigo", entityType: "ticket", entityId: ticket.id },
    });
    assert.ok(rastro, "a tentativa com QR antigo fica registrada");
    assert.equal(rastro.organizationId, ctx.fx.organization.id, "o produtor do evento enxerga o rastro");

    // OFFLINE: o delta traz o ingresso transferido com o nonce NOVO; o full também
    const nonceNovo = parseTicketToken(qrNovo).n;
    for (const since of [marco, undefined]) {
      const manifesto = await ctx.validator.getManifest(device, since);
      assert.equal(manifesto.manifestSchema, 4);
      const t = manifesto.tickets.find((x) => x.id === ticket.id);
      assert.ok(t, since ? "a transferência faz o ingresso voltar no delta" : "ingresso no full");
      assert.deepEqual(t.qrAtual, qrAtualDoIngresso(qrNovo));
      assert.equal(t.qrAtual?.n, nonceNovo);
      assert.notEqual(t.qrAtual?.n, nonceOriginal);
      assert.equal(t.attendeeName, "Novo Dono QR");

      // o token NUNCA vai para o aparelho: com ele, qualquer aparelho geraria o QR de qualquer pessoa
      const serializado = JSON.stringify(manifesto);
      assert.ok(!serializado.includes(qrNovo), "QR novo não vaza no manifesto");
      assert.ok(!serializado.includes(qrOriginal), "QR antigo não vaza no manifesto");
      assert.ok(!("qrToken" in t), "campo qrToken não vai para o aparelho");
    }

    // o QR NOVO entra normalmente
    const entrada = await ctx.checkins.create(device, { qrToken: qrNovo });
    assert.equal(entrada.result, "VALID");
    assert.ok("ticket" in entrada && entrada.ticket);
    assert.equal(entrada.ticket.attendeeName, "Novo Dono QR");

    // e o antigo segue "QR antigo" — não vira "já utilizado" depois da entrada
    const deNovo = await ctx.checkins.create(device, { qrToken: qrOriginal });
    assert.equal(deNovo.result, "INVALID");
    assert.equal(motivo(deNovo), "OLD_QR");
    assert.equal(
      await prisma.checkin.count({ where: { ticketId: ticket.id, status: "CONFIRMED" } }),
      1,
      "uma entrada só: a do novo dono",
    );
  } finally {
    await desmontar(ctx);
  }
});

test("QR que nunca foi trocado continua valendo", async () => {
  const ctx = await montar();
  try {
    const r = await ctx.checkins.create(ctx.device, { qrToken: ctx.qrOriginal });
    assert.equal(r.result, "VALID", "sem transferência, o QR emitido é o atual");
  } finally {
    await desmontar(ctx);
  }
});

test("duas transferências ao mesmo tempo: só uma grava, e o QR devolvido é o que vale", async () => {
  const ctx = await montar();
  try {
    const bia = await novoUsuario(ctx, "Bia QR");
    const caio = await novoUsuario(ctx, "Caio QR");

    const resultados = await Promise.allSettled([
      ctx.tickets.transferTicket(ctx.ticket.id, ctx.comprador.id, { toEmail: bia.email! }),
      ctx.tickets.transferTicket(ctx.ticket.id, ctx.comprador.id, { toEmail: caio.email! }),
    ]);
    const ok = resultados.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<TicketsService["transferTicket"]>>> =>
        r.status === "fulfilled",
    );
    const falhou = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.equal(ok.length, 1, "exatamente uma transferência grava");
    assert.equal(falhou.length, 1);
    // a outra leu o ingresso antes (guarda do update) ou depois (já não é dona)
    assert.match(String(falhou[0].reason?.message), /mudou enquanto você transferia|dono atual/);

    const vencedor = ok[0].value;
    const gravado = await prisma.ticket.findUniqueOrThrow({ where: { id: ctx.ticket.id } });
    const donoEsperado = vencedor.attendeeName === "Bia QR" ? bia : caio;
    assert.equal(gravado.ownerUserId, donoEsperado.id, "dono gravado = quem a resposta disse");
    assert.equal(gravado.qrToken, vencedor.qrToken, "o QR devolvido é o gravado (não nasce antigo)");

    assert.equal(
      await prisma.notification.count({
        where: { recipient: { in: [bia.email!, caio.email!] }, template: "ticket_transferred" },
      }),
      1,
      "só quem recebeu de verdade ganha o e-mail",
    );
    assert.equal(
      await prisma.auditLog.count({ where: { action: "ticket.transfer", entityId: ctx.ticket.id } }),
      1,
      "uma transferência, um registro",
    );

    const entrada = await ctx.checkins.create(ctx.device, { qrToken: vencedor.qrToken });
    assert.equal(entrada.result, "VALID", "o QR de quem recebeu entra");
  } finally {
    await desmontar(ctx);
  }
});
