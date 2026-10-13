import { test, after } from "node:test";
import assert from "node:assert/strict";
import { confirmSaleInventory, prisma, reserveInventory } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { CatalogService } from "../catalog/catalog.service";
import { alteracoesDoLote, conferirRegrasDoLote, type LoteParaConferir } from "../catalog/regras-do-lote";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// Editar lote + virada automática (protótipo aprovado em 2026-10-12).
// (1) O lote passa a ser editável com as MESMAS regras da criação, conferidas
//     no estado final — preço só sem venda nem reserva, quantidade nunca abaixo
//     do que saiu, link de convite que nasce/morre com o modo, rastro 'lot.update'
//     sem o código do convite.
// (2) O 2º lote pode nascer guardado e abrir sozinho quando o 1º esgota (na
//     mesma transação da venda) ou é encerrado, com 'lot.activate' sem ator.
// Toda garantia é provada no banco, não na tela.

// o mínimo vem do ambiente; o teste fixa R$ 5,00 para as contas serem estas
process.env.PAYMENT_MIN_CHARGE_CENTS = "500";

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);

async function montar(capacidade = 10) {
  // lote da fixture: R$ 30 + R$ 3, ACTIVE, sem datas
  const fx = await createFixtureEvent({ lotCapacity: capacidade, priceCents: 3000, feeCents: 300 });
  const dono = await prisma.user.create({ data: { email: `dono-lote-${rand()}@borafest.dev` } });
  await prisma.organizationMember.create({
    data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
  });
  const catalog = new CatalogService(new OrgAccessService(), new InventoryService());
  return { fx, dono, catalog, usuarios: [dono.id] as string[] };
}
type Ctx = Awaited<ReturnType<typeof montar>>;

async function desmontar(ctx: Ctx) {
  const organizationId = ctx.fx.organization.id;
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.organizationMember.deleteMany({ where: { organizationId } });
  await cleanupFixtureEvent(organizationId);
  for (const id of ctx.usuarios) await prisma.user.delete({ where: { id } }).catch(() => undefined);
}

const lote = (id: string) => prisma.ticketLot.findUniqueOrThrow({ where: { id } });

/** Venda confirmada pelo mesmo caminho do pagamento: reserva e confirma na mesma transação. */
async function vender(lotId: string, quantidade: number) {
  await prisma.$transaction(async (tx) => {
    await reserveInventory(tx, lotId, quantidade);
    await confirmSaleInventory(tx, lotId, quantidade);
  });
}

function criar(ctx: Ctx, extra: Record<string, unknown> = {}) {
  return ctx.catalog.createLot(ctx.fx.ticketType.id, ctx.dono.id, {
    name: `Lote ${rand()}`,
    priceCents: 4000,
    feeCents: 0,
    capacity: 10,
    maxPerOrder: 4,
    ...extra,
  } as never);
}

function registros(entityId: string, action: string) {
  return prisma.auditLog.findMany({ where: { entityId, action }, orderBy: { createdAt: "asc" } });
}

// ---------------------------------------------------------------------------
// Regras puras (o helper que criação e edição dividem)
// ---------------------------------------------------------------------------

test("regras do lote: as mesmas recusas da criação valem para qualquer estado final", () => {
  const base: LoteParaConferir = {
    priceCents: 3000,
    feeCents: 150,
    feeMode: "BUYER",
    halfPriceEnabled: false,
    pdvOnly: false,
    promoterOnly: false,
    inviteMode: "NONE",
    startsAt: null,
    endsAt: null,
  };
  assert.doesNotThrow(() => conferirRegrasDoLote(base));
  assert.throws(() => conferirRegrasDoLote({ ...base, pdvOnly: true, inviteMode: "LINK" }), /só uma forma/);
  assert.throws(() => conferirRegrasDoLote({ ...base, promoterOnly: true, inviteMode: "EMAIL" }), /só uma forma/);
  assert.throws(() => conferirRegrasDoLote({ ...base, pdvOnly: true, priceCents: 0, feeCents: 0 }), /Lista de convidados/);
  assert.throws(() => conferirRegrasDoLote({ ...base, priceCents: 300, feeCents: 100 }), /pelo menos R\$\s?5,00/);
  assert.throws(
    () => conferirRegrasDoLote({ ...base, priceCents: 600, feeCents: 100, halfPriceEnabled: true }),
    /meia-entrada sairia por/,
  );
  // balcão não passa pelo banco: pode ficar abaixo do mínimo online
  assert.doesNotThrow(() => conferirRegrasDoLote({ ...base, priceCents: 300, feeCents: 100, pdvOnly: true }));
  const inicio = new Date("2026-12-01T22:00:00.000Z");
  assert.throws(
    () => conferirRegrasDoLote({ ...base, startsAt: inicio, endsAt: new Date(inicio.getTime()) }),
    /fim das vendas do lote precisa ser depois do início/,
  );
});

test("alteracoesDoLote: o código do convite só marca que mudou; data igual em outro objeto não conta", () => {
  const data = new Date("2026-12-01T22:00:00.000Z");
  const antes = {
    name: "1º lote",
    priceCents: 3000,
    feeCents: 150,
    capacity: 100,
    maxPerOrder: 6,
    limitPerCpf: null,
    startsAt: data,
    endsAt: null,
    inviteMode: "NONE",
    promoterOnly: false,
    pdvOnly: false,
    halfPriceEnabled: false,
    activateAfterLotId: null,
    inviteToken: null,
  };
  assert.deepEqual(alteracoesDoLote(antes, { ...antes, startsAt: new Date(data.getTime()) }).campos, []);
  const mudou = alteracoesDoLote(antes, { ...antes, inviteMode: "LINK", inviteToken: "segredo-123", capacity: 120 });
  assert.deepEqual(mudou.campos.sort(), ["capacity", "inviteMode", "inviteToken"]);
  assert.equal(mudou.antes.capacity, 100);
  assert.equal(mudou.depois.capacity, 120);
  assert.ok(!JSON.stringify(mudou).includes("segredo-123"), "o código do convite nunca vai para o histórico");
});

// ---------------------------------------------------------------------------
// Editar lote
// ---------------------------------------------------------------------------

test("editar: muda nome, quantidade, máximo, limite por CPF e datas; grava antes/depois; salvar igual não grava", async () => {
  const ctx = await montar();
  try {
    const id = ctx.fx.lot.id;
    const fim = new Date(Date.now() + 48 * 3_600_000);
    const r = await ctx.catalog.updateLot(id, ctx.dono.id, {
      name: "Lote promocional",
      capacity: 50,
      maxPerOrder: 2,
      limitPerCpf: 1,
      endsAt: fim.toISOString(),
    });
    assert.deepEqual(r.openedLots, []);
    const salvo = await lote(id);
    assert.equal(salvo.name, "Lote promocional");
    assert.equal(salvo.capacity, 50);
    assert.equal(salvo.maxPerOrder, 2);
    assert.equal(salvo.limitPerCpf, 1);
    assert.equal(salvo.endsAt?.toISOString(), fim.toISOString());
    assert.equal(salvo.priceCents, 3000, "o que não veio no pedido fica como estava");
    assert.equal(salvo.feeCents, 300, "taxa só se recalcula quando o preço muda");

    const [editou] = await registros(id, "lot.update");
    assert.ok(editou, "editar lote fica na auditoria");
    assert.equal(editou.actorUserId, ctx.dono.id);
    assert.equal(editou.organizationId, ctx.fx.organization.id);
    assert.equal(editou.entityType, "ticket_lot");
    const meta = editou.metadata as { campos: string[]; antes: Record<string, unknown>; depois: Record<string, unknown> };
    assert.deepEqual([...meta.campos].sort(), ["capacity", "endsAt", "limitPerCpf", "maxPerOrder", "name"]);
    assert.equal(meta.antes.capacity, 10);
    assert.equal(meta.depois.capacity, 50);
    assert.equal(meta.antes.limitPerCpf, null);
    assert.equal(meta.depois.endsAt, fim.toISOString());

    // limpar o limite e a data com null
    await ctx.catalog.updateLot(id, ctx.dono.id, { limitPerCpf: null, endsAt: null });
    const limpo = await lote(id);
    assert.equal(limpo.limitPerCpf, null);
    assert.equal(limpo.endsAt, null);

    // salvar de novo sem mudar nada não cria outro registro
    const antes = (await registros(id, "lot.update")).length;
    await ctx.catalog.updateLot(id, ctx.dono.id, { name: "Lote promocional", capacity: 50 });
    assert.equal((await registros(id, "lot.update")).length, antes);
  } finally {
    await desmontar(ctx);
  }
});

test("editar: preço só muda sem venda nem reserva; quantidade nunca abaixo de vendidos + reservados", async () => {
  const ctx = await montar(20);
  try {
    const id = ctx.fx.lot.id;
    // sem movimento: o preço muda e a taxa acompanha
    await ctx.catalog.updateLot(id, ctx.dono.id, { priceCents: 4000 });
    const novoPreco = await lote(id);
    assert.equal(novoPreco.priceCents, 4000);
    assert.notEqual(novoPreco.feeCents, 300, "a taxa é recalculada pelo servidor");

    // uma reserva em andamento já trava o preço (ela guardou o valor de agora)
    await reserveInventory(prisma, id, 2);
    await assert.rejects(ctx.catalog.updateLot(id, ctx.dono.id, { priceCents: 5000 }), /O preço não muda/);
    // mandar o MESMO preço não é mudança
    await ctx.catalog.updateLot(id, ctx.dono.id, { priceCents: 4000, name: "Mesmo preço" });

    await vender(id, 3); // 3 vendidos + 2 reservados = 5 saíram
    await assert.rejects(ctx.catalog.updateLot(id, ctx.dono.id, { capacity: 4 }), /Já saíram 5 ingressos/);
    await ctx.catalog.updateLot(id, ctx.dono.id, { capacity: 5 });
    assert.equal((await lote(id)).capacity, 5, "dá para baixar até exatamente o que saiu");
    // virar grátis depois de vender também é mudar o preço
    await assert.rejects(ctx.catalog.updateLot(id, ctx.dono.id, { priceCents: 0 }), /O preço não muda/);
  } finally {
    await desmontar(ctx);
  }
});

test("editar: 'quem pode pegar' — virar link gera código, sair de link mata o código; restrição dupla e balcão grátis recusados", async () => {
  const ctx = await montar();
  try {
    const id = ctx.fx.lot.id;
    await ctx.catalog.updateLot(id, ctx.dono.id, { inviteMode: "LINK" });
    const comLink = await lote(id);
    assert.equal(comLink.inviteMode, "LINK");
    assert.ok(comLink.inviteToken && comLink.inviteToken.length >= 20, "nasce um código como no createLot");
    const [virouLink] = await registros(id, "lot.update");
    assert.ok((virouLink.metadata as { campos: string[] }).campos.includes("inviteToken"));
    assert.ok(!JSON.stringify(virouLink.metadata).includes(comLink.inviteToken!), "o código não vai para o histórico");

    // editar outra coisa não troca o link que já foi mandado
    await ctx.catalog.updateLot(id, ctx.dono.id, { name: "Convidados VIP" });
    assert.equal((await lote(id)).inviteToken, comLink.inviteToken);

    await assert.rejects(ctx.catalog.updateLot(id, ctx.dono.id, { pdvOnly: true }), /só uma forma/);
    await assert.rejects(ctx.catalog.updateLot(id, ctx.dono.id, { promoterOnly: true }), /só uma forma/);

    await ctx.catalog.updateLot(id, ctx.dono.id, { inviteMode: "NONE", promoterOnly: true });
    const promoter = await lote(id);
    assert.equal(promoter.inviteToken, null, "deixou de ser link: o código antigo morre");
    assert.equal(promoter.promoterOnly, true);

    // voltar a ser link NÃO ressuscita o link antigo (pode ter vazado)
    await ctx.catalog.updateLot(id, ctx.dono.id, { inviteMode: "LINK", promoterOnly: false });
    const deNovo = await lote(id);
    assert.ok(deNovo.inviteToken);
    assert.notEqual(deNovo.inviteToken, comLink.inviteToken);

    // lote grátis só de balcão: recusado na edição como na criação, e nada muda
    await ctx.catalog.updateLot(id, ctx.dono.id, { inviteMode: "NONE" });
    await assert.rejects(ctx.catalog.updateLot(id, ctx.dono.id, { pdvOnly: true, priceCents: 0 }), /Lista de convidados/);
    const intacto = await lote(id);
    assert.equal(intacto.pdvOnly, false);
    assert.equal(intacto.priceCents, 3000);
  } finally {
    await desmontar(ctx);
  }
});

test("editar: lote grátis nunca fica com meia; mínimo do banco e janela conferidos no estado final", async () => {
  const ctx = await montar();
  try {
    const id = ctx.fx.lot.id;
    await ctx.catalog.updateLot(id, ctx.dono.id, { halfPriceEnabled: true });
    assert.equal((await lote(id)).halfPriceEnabled, true);
    await ctx.catalog.updateLot(id, ctx.dono.id, { priceCents: 0 });
    const gratis = await lote(id);
    assert.equal(gratis.priceCents, 0);
    assert.equal(gratis.feeCents, 0, "grátis não paga taxa");
    assert.equal(gratis.halfPriceEnabled, false, "metade de zero só faria a porta pedir documento à toa");
    await ctx.catalog.updateLot(id, ctx.dono.id, { halfPriceEnabled: true });
    assert.equal((await lote(id)).halfPriceEnabled, false);

    await assert.rejects(ctx.catalog.updateLot(id, ctx.dono.id, { priceCents: 300 }), /pelo menos R\$\s?5,00/);

    const inicio = new Date(Date.now() + 24 * 3_600_000);
    await ctx.catalog.updateLot(id, ctx.dono.id, { startsAt: inicio.toISOString() });
    // só o fim veio no pedido, mas a conta é com o início que já estava salvo
    await assert.rejects(
      ctx.catalog.updateLot(id, ctx.dono.id, { endsAt: new Date(inicio.getTime() - 3_600_000).toISOString() }),
      /fim das vendas do lote precisa ser depois do início/,
    );
  } finally {
    await desmontar(ctx);
  }
});

test("editar: lote encerrado não se edita; quem não pode criar lote não edita nem lista", async () => {
  const ctx = await montar();
  try {
    const id = ctx.fx.lot.id;
    const vendedor = await prisma.user.create({ data: { email: `vendedor-${rand()}@borafest.dev` } });
    ctx.usuarios.push(vendedor.id);
    const papel = await prisma.role.findUniqueOrThrow({ where: { key: "seller" } });
    await prisma.organizationMember.create({
      data: { organizationId: ctx.fx.organization.id, userId: vendedor.id, roleId: papel.id, status: "ACTIVE" },
    });
    await assert.rejects(ctx.catalog.updateLot(id, vendedor.id, { name: "Hackeado" }), /Sem permissão/);
    await assert.rejects(ctx.catalog.listEventLots(ctx.fx.event.id, vendedor.id), /Sem permissão/);
    assert.equal((await lote(id)).name, "Lote único");

    await ctx.catalog.closeLot(id, ctx.dono.id);
    await assert.rejects(ctx.catalog.updateLot(id, ctx.dono.id, { name: "Reaberto" }), /Lote encerrado não se edita/);
  } finally {
    await desmontar(ctx);
  }
});

test("lista do painel: traz código do convite, entradas por lote e o mínimo do banco", async () => {
  const ctx = await montar();
  try {
    const link = await criar(ctx, { inviteMode: "LINK", activateNow: true });
    const r = await ctx.catalog.listEventLots(ctx.fx.event.id, ctx.dono.id);
    assert.equal(r.minimoCobrancaCents, 500);
    const doLink = r.lots.find((l) => l.id === link.id);
    assert.ok(doLink);
    assert.equal(doLink.inviteToken, link.inviteToken);
    assert.equal(doLink.status, "ACTIVE", "activateNow já nasce à venda numa chamada só");
    assert.equal(doLink.checkedInCount, 0);
    assert.equal(doLink.typeName, "Pista");
  } finally {
    await desmontar(ctx);
  }
});

// ---------------------------------------------------------------------------
// Virada automática
// ---------------------------------------------------------------------------

test("virada: o 2º lote nasce guardado e abre na MESMA transação da venda que esgota o 1º", async () => {
  const ctx = await montar(3);
  try {
    const primeiro = ctx.fx.lot.id;
    const segundo = await criar(ctx, { name: "2º lote", activateAfterLotId: primeiro });
    assert.equal(segundo.status, "DRAFT", "com virada o lote nasce guardado");
    assert.equal(segundo.activateAfterLotId, primeiro);
    const [criou] = await registros(segundo.id, "lot.create");
    assert.equal((criou.metadata as Record<string, unknown>).activateAfterLotId, primeiro);

    await vender(primeiro, 2);
    assert.equal((await lote(segundo.id)).status, "DRAFT", "sobrou ingresso no 1º: o 2º espera");

    // venda que falha depois de esgotar desfaz a virada junto (mesma transação)
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await reserveInventory(tx, primeiro, 1);
        await confirmSaleInventory(tx, primeiro, 1);
        throw new Error("pagamento caiu");
      }),
      /pagamento caiu/,
    );
    assert.equal((await lote(segundo.id)).status, "DRAFT", "sem venda, sem virada");

    await vender(primeiro, 1);
    assert.equal((await lote(primeiro)).soldCount, 3);
    assert.equal((await lote(segundo.id)).status, "ACTIVE", "esgotou o 1º: o 2º abriu");

    const viradas = await registros(segundo.id, "lot.activate");
    assert.equal(viradas.length, 1);
    assert.equal(viradas[0].actorUserId, null, "foi o sistema, não uma pessoa");
    assert.equal(viradas[0].organizationId, ctx.fx.organization.id);
    const meta = viradas[0].metadata as Record<string, unknown>;
    assert.equal(meta.motivo, "virada automática");
    assert.equal(meta.anterior, primeiro);
    assert.equal(meta.gatilho, "esgotado");
    assert.equal(meta.de, "DRAFT");
    assert.equal(meta.para, "ACTIVE");
  } finally {
    await desmontar(ctx);
  }
});

test("virada: duas vendas do último ingresso ao mesmo tempo abrem o 2º lote uma vez só", async () => {
  const ctx = await montar(2);
  try {
    const primeiro = ctx.fx.lot.id;
    const segundo = await criar(ctx, { name: "2º lote", activateAfterLotId: primeiro });
    await Promise.all([vender(primeiro, 1), vender(primeiro, 1)]);
    assert.equal((await lote(primeiro)).soldCount, 2);
    assert.equal((await lote(segundo.id)).status, "ACTIVE");
    assert.equal((await registros(segundo.id, "lot.activate")).length, 1, "um registro só");

    // cortesia/estorno depois não reabrem nada nem sujam o histórico
    await confirmSaleInventory(prisma, primeiro, 0);
    assert.equal((await registros(segundo.id, "lot.activate")).length, 1);
  } finally {
    await desmontar(ctx);
  }
});

test("virada: encerrar o 1º abre o 2º; pular o 2º guardado faz o 3º esperar o 1º", async () => {
  const ctx = await montar(10);
  try {
    const primeiro = ctx.fx.lot.id;
    const segundo = await criar(ctx, { name: "2º lote", activateAfterLotId: primeiro });
    const terceiro = await criar(ctx, { name: "3º lote", activateAfterLotId: segundo.id });

    // o produtor desiste do 2º antes de ele abrir: o 3º NÃO abre com o 1º vendendo
    const r = await ctx.catalog.closeLot(segundo.id, ctx.dono.id);
    assert.deepEqual(r.openedLots, []);
    assert.deepEqual(r.requeuedLots.map((l) => l.id), [terceiro.id]);
    const t = await lote(terceiro.id);
    assert.equal(t.status, "DRAFT");
    assert.equal(t.activateAfterLotId, primeiro, "o 3º passa a esperar o 1º");
    const [repassou] = await registros(terceiro.id, "lot.update");
    assert.equal(repassou.actorUserId, ctx.dono.id);

    // encerrar o 1º (que está vendendo) abre quem espera por ele
    const fechou = await ctx.catalog.closeLot(primeiro, ctx.dono.id);
    assert.deepEqual(fechou.openedLots.map((l) => l.id), [terceiro.id]);
    assert.equal((await lote(terceiro.id)).status, "ACTIVE");
    const [abriu] = await registros(terceiro.id, "lot.activate");
    assert.equal(abriu.actorUserId, null);
    assert.equal((abriu.metadata as Record<string, unknown>).gatilho, "encerrado");

    // segundo clique em Encerrar: recusa clara, nada muda
    await assert.rejects(ctx.catalog.closeLot(primeiro, ctx.dono.id), /já está encerrado/);
    assert.equal((await registros(terceiro.id, "lot.activate")).length, 1);
  } finally {
    await desmontar(ctx);
  }
});

test("virada: baixar a quantidade até o que já vendeu esgota o lote e abre o seguinte", async () => {
  const ctx = await montar(10);
  try {
    const primeiro = ctx.fx.lot.id;
    const segundo = await criar(ctx, { name: "2º lote", activateAfterLotId: primeiro });
    await vender(primeiro, 4);
    const r = await ctx.catalog.updateLot(primeiro, ctx.dono.id, { capacity: 4 });
    assert.deepEqual(r.openedLots.map((l) => l.id), [segundo.id]);
    assert.equal((await lote(segundo.id)).status, "ACTIVE");
  } finally {
    await desmontar(ctx);
  }
});

test("virada: anterior encerrado, esgotado, de outro ingresso, círculo e 'abrir agora' junto são recusados", async () => {
  const ctx = await montar(2);
  try {
    const primeiro = ctx.fx.lot.id;
    await assert.rejects(criar(ctx, { activateAfterLotId: primeiro, activateNow: true }), /Escolha um só/);

    const outroTipo = await prisma.ticketType.create({ data: { eventId: ctx.fx.event.id, name: "VIP" } });
    const doVip = await ctx.catalog.createLot(outroTipo.id, ctx.dono.id, {
      name: "VIP 1º lote",
      priceCents: 8000,
      feeCents: 0,
      capacity: 5,
      maxPerOrder: 2,
    } as never);
    await assert.rejects(criar(ctx, { activateAfterLotId: doVip.id }), /mesmo ingresso/);

    // círculo: A espera B e B passaria a esperar A — nenhum abriria
    const a = await criar(ctx, { name: "A" });
    const b = await criar(ctx, { name: "B", activateAfterLotId: a.id });
    await assert.rejects(ctx.catalog.updateLot(a.id, ctx.dono.id, { activateAfterLotId: b.id }), /esperando um ao outro/);
    await assert.rejects(ctx.catalog.updateLot(a.id, ctx.dono.id, { activateAfterLotId: a.id }), /ele mesmo/);

    // lote já à venda não ganha virada
    await assert.rejects(
      ctx.catalog.updateLot(primeiro, ctx.dono.id, { activateAfterLotId: a.id }),
      /já está à venda/,
    );

    await vender(primeiro, 2);
    await assert.rejects(criar(ctx, { activateAfterLotId: primeiro }), /já esgotou/);
    await ctx.catalog.closeLot(doVip.id, ctx.dono.id);
    const outroVip = ctx.catalog.createLot(outroTipo.id, ctx.dono.id, {
      name: "VIP 2º lote",
      priceCents: 9000,
      feeCents: 0,
      capacity: 5,
      maxPerOrder: 2,
      activateAfterLotId: doVip.id,
    } as never);
    await assert.rejects(outroVip, /já foi encerrado/);
  } finally {
    await desmontar(ctx);
  }
});

test("virada: lote com outro esperando por ele não se apaga (o de trás ficaria guardado para sempre)", async () => {
  const ctx = await montar(10);
  try {
    const avulso = await criar(ctx, { name: "Lote sem venda" });
    const seguinte = await criar(ctx, { name: "Depois do avulso", activateAfterLotId: avulso.id });
    await assert.rejects(ctx.catalog.deleteLot(avulso.id, ctx.dono.id), /está esperando este esgotar/);
    assert.equal(await prisma.ticketLot.count({ where: { id: avulso.id } }), 1, "nada foi apagado");
    assert.equal((await registros(avulso.id, "lot.delete")).length, 0);

    // tirou a virada do de trás: agora apaga
    await ctx.catalog.updateLot(seguinte.id, ctx.dono.id, { activateAfterLotId: null });
    await ctx.catalog.deleteLot(avulso.id, ctx.dono.id);
    assert.equal(await prisma.ticketLot.count({ where: { id: avulso.id } }), 0);
  } finally {
    await desmontar(ctx);
  }
});

test("trocar o link de convite deixa rastro sem o código", async () => {
  const ctx = await montar();
  try {
    const link = await criar(ctx, { inviteMode: "LINK", activateNow: true });
    const r = await ctx.catalog.rotateInviteLink(link.id, ctx.dono.id);
    assert.notEqual(r.inviteToken, link.inviteToken);
    const [trocou] = await registros(link.id, "lot.invite_rotate");
    assert.ok(trocou, "'quem trocou o link?' fica na auditoria");
    assert.equal(trocou.actorUserId, ctx.dono.id);
    const texto = JSON.stringify(trocou.metadata);
    assert.ok(!texto.includes(r.inviteToken!) && !texto.includes(link.inviteToken!));
  } finally {
    await desmontar(ctx);
  }
});
