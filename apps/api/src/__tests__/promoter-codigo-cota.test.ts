import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { updatePromoterLinkSchema } from "@borafest/contracts";
import { OrganizationsService } from "../organizations/organizations.service";
import { OrgAccessService } from "../common/org-access.service";
import { GuestListService } from "../guest-list/guest-list.service";
import { InventoryService } from "../inventory/inventory.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// CÓDIGO E COTA DO PROMOTER (2026-10-12). A cota de convidados nascia 0 e não
// havia rota nem tela para liberar: o promoter tentava pôr alguém na lista e
// ouvia "peça para a produção liberar a sua cota", e a produção não tinha onde.
// O código pessoal só existia no convite feito pela API. Toda garantia é
// provada no banco, não na tela.

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);
const orgs = new OrganizationsService(new OrgAccessService());
const lista = new GuestListService(new OrgAccessService(), new InventoryService());

/** CPF válido aleatório (a lista exige CPF). */
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

/** status HTTP da exceção do Nest (409, 404…) */
const statusHttp = (err: unknown) => (err as { getStatus?: () => number }).getStatus?.();

/** código que ninguém mais tem (o unique é da plataforma inteira) */
const codigoNovo = () => `T${rand().toUpperCase().slice(0, 8)}`;

async function montar() {
  const fx = await createFixtureEvent({ lotCapacity: 10, priceCents: 0, feeCents: 0 });
  const usuarios: string[] = [];
  const novoUsuario = async (prefixo: string) => {
    const user = await prisma.user.create({ data: { email: `${prefixo}-${rand()}@borafest.dev` } });
    usuarios.push(user.id);
    return user;
  };
  const membro = async (organizationId: string, roleKey: string, status: "ACTIVE" | "INVITED" = "ACTIVE") => {
    const user = await novoUsuario(`membro-${roleKey}`);
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.organizationMember.create({
      data: { organizationId, userId: user.id, roleId: role.id, status },
    });
    return user;
  };
  const vinculo = async (
    organizationId: string,
    dados: { status?: "INVITED" | "ACTIVE"; eventId?: string; code?: string; guestQuota?: number } = {},
  ) => {
    const promoter = await novoUsuario("promoter");
    const link = await prisma.promoterLink.create({
      data: {
        organizationId,
        promoterUserId: promoter.id,
        status: dados.status ?? "ACTIVE",
        eventId: dados.eventId,
        code: dados.code,
        guestQuota: dados.guestQuota ?? 0,
        slug: `pr-cota-${rand()}`,
      },
    });
    return { promoter, link };
  };
  const dono = await membro(fx.organization.id, "owner");
  const { promoter, link } = await vinculo(fx.organization.id);
  return { fx, dono, promoter, link, usuarios, novoUsuario, membro, vinculo };
}
type Ctx = Awaited<ReturnType<typeof montar>>;

async function desmontar(ctx: Ctx, extras: Array<Awaited<ReturnType<typeof createFixtureEvent>>> = []) {
  for (const fx of [ctx.fx, ...extras]) {
    const pedidos = await prisma.order.findMany({ where: { eventId: fx.event.id }, select: { id: true } });
    const ids = pedidos.map((p) => p.id);
    await prisma.notification.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { organizationId: fx.organization.id } });
    await prisma.promoterLink.deleteMany({ where: { organizationId: fx.organization.id } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: fx.organization.id } });
    await cleanupFixtureEvent(fx.organization.id);
  }
  for (const id of ctx.usuarios) await prisma.user.delete({ where: { id } }).catch(() => undefined);
}

const rastros = (linkId: string) =>
  prisma.auditLog.findMany({
    where: { entityType: "promoter_link", entityId: linkId, action: "promoter.updated" },
    orderBy: { createdAt: "asc" },
  });

const cadastrarConvidado = (ctx: Ctx, nome: string) =>
  lista.create(ctx.promoter.id, ctx.fx.event.id, {
    ticketLotId: ctx.fx.lot.id,
    guestName: nome,
    guestDocument: geraCpf(),
  });

test("a Casa libera a cota e o promoter passa a cadastrar convidado — até o número liberado", async () => {
  const ctx = await montar();
  try {
    await assert.rejects(cadastrarConvidado(ctx, "Convidado Um"), /não tem cortesias liberadas/, "cota 0 de nascença");

    const editado = await orgs.updatePromoterLink(ctx.fx.organization.id, ctx.link.id, ctx.dono.id, { guestQuota: 1 });
    assert.equal(editado.guestQuota, 1);
    assert.equal((await prisma.promoterLink.findUniqueOrThrow({ where: { id: ctx.link.id } })).guestQuota, 1);

    const entrada = await cadastrarConvidado(ctx, "Convidado Um");
    assert.ok(entrada.id, "com cota, o convidado entra na lista");
    await assert.rejects(cadastrarConvidado(ctx, "Convidado Dois"), /cota de cortesias acabou/, "nem um a mais");

    const [rastro] = await rastros(ctx.link.id);
    assert.ok(rastro, "a mudança deixa rastro");
    assert.equal(rastro.actorUserId, ctx.dono.id);
    assert.equal(rastro.organizationId, ctx.fx.organization.id);
    assert.deepEqual(rastro.metadata, {
      promoterUserId: ctx.promoter.id,
      antes: { guestQuota: 0 },
      depois: { guestQuota: 1 },
    });
  } finally {
    await desmontar(ctx);
  }
});

test("código pessoal: grava em MAIÚSCULAS, é único na plataforma e null tira", async () => {
  const ctx = await montar();
  const outraCasa = await createFixtureEvent({ lotCapacity: 5 });
  try {
    const codigo = codigoNovo();
    const editado = await orgs.updatePromoterLink(ctx.fx.organization.id, ctx.link.id, ctx.dono.id, {
      code: codigo.toLowerCase(),
    });
    assert.equal(editado.code, codigo, "o comprador digita como quiser; o banco guarda em maiúsculas");

    // outra Casa tentando usar o mesmo código
    const donoDeLa = await ctx.membro(outraCasa.organization.id, "owner");
    const { link: linkDeLa } = await ctx.vinculo(outraCasa.organization.id);
    await assert.rejects(
      orgs.updatePromoterLink(outraCasa.organization.id, linkDeLa.id, donoDeLa.id, { code: codigo }),
      (err: Error) => /já está em uso/.test(err.message) && statusHttp(err) === 409,
    );
    assert.equal((await prisma.promoterLink.findUniqueOrThrow({ where: { id: linkDeLa.id } })).code, null);

    await assert.rejects(
      orgs.updatePromoterLink(ctx.fx.organization.id, ctx.link.id, ctx.dono.id, { code: "AB" }),
      /3 a 16 letras ou números/,
    );
    await assert.rejects(
      orgs.updatePromoterLink(ctx.fx.organization.id, ctx.link.id, ctx.dono.id, { code: "BIA-10" }),
      /3 a 16 letras ou números/,
    );

    const semCodigo = await orgs.updatePromoterLink(ctx.fx.organization.id, ctx.link.id, ctx.dono.id, { code: null });
    assert.equal(semCodigo.code, null, "null tira o código");
    // o código liberado pode ir para outro promoter
    const deLa = await orgs.updatePromoterLink(outraCasa.organization.id, linkDeLa.id, donoDeLa.id, { code: codigo });
    assert.equal(deLa.code, codigo);

    const historico = await rastros(ctx.link.id);
    assert.equal(historico.length, 2, "pôr e tirar: duas mudanças, dois registros");
    assert.deepEqual(historico[1].metadata, {
      promoterUserId: ctx.promoter.id,
      antes: { code: codigo },
      depois: { code: null },
    });
  } finally {
    await desmontar(ctx, [outraCasa]);
  }
});

test("contrato: código 3–16 letras/números vira maiúsculas, cota 0–1000 e pelo menos um campo", () => {
  const ok = updatePromoterLinkSchema.safeParse({ code: " bia10 " });
  assert.ok(ok.success);
  assert.equal(ok.success && ok.data.code, "BIA10");
  assert.ok(updatePromoterLinkSchema.safeParse({ code: null }).success, "null tira o código");
  assert.ok(updatePromoterLinkSchema.safeParse({ guestQuota: 0 }).success);
  assert.ok(updatePromoterLinkSchema.safeParse({ guestQuota: 1000, code: "JOAO" }).success);

  assert.equal(updatePromoterLinkSchema.safeParse({}).success, false, "nada para mudar");
  assert.equal(updatePromoterLinkSchema.safeParse({ code: "AB" }).success, false);
  assert.equal(updatePromoterLinkSchema.safeParse({ code: "" }).success, false, "vazio não é 'sem código': use null");
  assert.equal(updatePromoterLinkSchema.safeParse({ code: "BIA-10" }).success, false);
  assert.equal(updatePromoterLinkSchema.safeParse({ code: "A".repeat(17) }).success, false);
  assert.equal(updatePromoterLinkSchema.safeParse({ guestQuota: -1 }).success, false);
  assert.equal(updatePromoterLinkSchema.safeParse({ guestQuota: 1001 }).success, false);
  assert.equal(updatePromoterLinkSchema.safeParse({ guestQuota: 2.5 }).success, false);
});

test("só dono ou administrador ATIVO da Casa edita — financeiro, vendedor e o próprio promoter não", async () => {
  const ctx = await montar();
  try {
    const admin = await ctx.membro(ctx.fx.organization.id, "admin");
    const editado = await orgs.updatePromoterLink(ctx.fx.organization.id, ctx.link.id, admin.id, { guestQuota: 3 });
    assert.equal(editado.guestQuota, 3, "administrador edita");

    const financeiro = await ctx.membro(ctx.fx.organization.id, "finance");
    const vendedor = await ctx.membro(ctx.fx.organization.id, "seller");
    const adminConvidado = await ctx.membro(ctx.fx.organization.id, "admin", "INVITED");
    for (const [quem, id] of [
      ["financeiro", financeiro.id],
      ["vendedor", vendedor.id],
      ["admin que ainda não aceitou", adminConvidado.id],
      ["o próprio promoter", ctx.promoter.id],
    ] as const) {
      await assert.rejects(
        orgs.updatePromoterLink(ctx.fx.organization.id, ctx.link.id, id, { guestQuota: 50 }),
        /Sem permissão/,
        `${quem} não muda a cota`,
      );
    }
    assert.equal((await prisma.promoterLink.findUniqueOrThrow({ where: { id: ctx.link.id } })).guestQuota, 3);
    assert.equal((await rastros(ctx.link.id)).length, 1, "só a mudança do administrador ficou registrada");
  } finally {
    await desmontar(ctx);
  }
});

test("vínculo de outra Casa responde como inexistente, mesmo para quem é dono de uma Casa", async () => {
  const ctx = await montar();
  const outraCasa = await createFixtureEvent({ lotCapacity: 5 });
  try {
    await ctx.membro(outraCasa.organization.id, "owner");
    const { link: linkDeLa } = await ctx.vinculo(outraCasa.organization.id);

    // pela rota da PRÓPRIA Casa, apontando o vínculo da outra
    await assert.rejects(
      orgs.updatePromoterLink(ctx.fx.organization.id, linkDeLa.id, ctx.dono.id, { guestQuota: 99 }),
      (err: unknown) => statusHttp(err) === 404,
    );
    // pela rota da outra Casa, de que ele não é membro
    await assert.rejects(
      orgs.updatePromoterLink(outraCasa.organization.id, linkDeLa.id, ctx.dono.id, { guestQuota: 99 }),
      /Sem permissão/,
    );
    // id que não existe e id torto: 404, nunca erro do banco
    await assert.rejects(
      orgs.updatePromoterLink(ctx.fx.organization.id, randomUUID(), ctx.dono.id, { guestQuota: 1 }),
      (err: unknown) => statusHttp(err) === 404,
    );
    await assert.rejects(
      orgs.updatePromoterLink(ctx.fx.organization.id, "nao-e-uuid", ctx.dono.id, { guestQuota: 1 }),
      (err: unknown) => statusHttp(err) === 404,
    );
    assert.equal((await prisma.promoterLink.findUniqueOrThrow({ where: { id: linkDeLa.id } })).guestQuota, 0);
  } finally {
    await desmontar(ctx, [outraCasa]);
  }
});

test("promoter removido não se edita: convide de novo", async () => {
  const ctx = await montar();
  try {
    await orgs.revokePromoter(ctx.link.id, ctx.dono.id);
    await assert.rejects(
      orgs.updatePromoterLink(ctx.fx.organization.id, ctx.link.id, ctx.dono.id, { guestQuota: 5 }),
      /não faz mais parte da Casa/,
    );
    assert.equal((await prisma.promoterLink.findUniqueOrThrow({ where: { id: ctx.link.id } })).guestQuota, 0);
  } finally {
    await desmontar(ctx);
  }
});

test("convite ainda não aceito já pode ter código e cota (a Casa deixa pronto)", async () => {
  const ctx = await montar();
  try {
    const { link } = await ctx.vinculo(ctx.fx.organization.id, { status: "INVITED" });
    const codigo = codigoNovo();
    const editado = await orgs.updatePromoterLink(ctx.fx.organization.id, link.id, ctx.dono.id, {
      code: codigo,
      guestQuota: 10,
    });
    assert.equal(editado.code, codigo);
    assert.equal(editado.guestQuota, 10);
    assert.equal(editado.status, "INVITED");
  } finally {
    await desmontar(ctx);
  }
});

test("dois cliques em Salvar: grava uma vez e o histórico registra uma mudança só", async () => {
  const ctx = await montar();
  try {
    const resultados = await Promise.all([
      orgs.updatePromoterLink(ctx.fx.organization.id, ctx.link.id, ctx.dono.id, { guestQuota: 5 }),
      orgs.updatePromoterLink(ctx.fx.organization.id, ctx.link.id, ctx.dono.id, { guestQuota: 5 }),
    ]);
    for (const r of resultados) assert.equal(r.guestQuota, 5, "os dois cliques veem o valor gravado");
    assert.equal((await rastros(ctx.link.id)).length, 1, "o segundo clique não tinha nada a mudar");

    // salvar de novo sem mudar nada não suja o histórico
    await orgs.updatePromoterLink(ctx.fx.organization.id, ctx.link.id, ctx.dono.id, { guestQuota: 5 });
    assert.equal((await rastros(ctx.link.id)).length, 1);
  } finally {
    await desmontar(ctx);
  }
});

test("dois promoters disputando o mesmo código ao mesmo tempo: um fica com ele, o outro ouve 'já está em uso'", async () => {
  const ctx = await montar();
  try {
    const { link: outro } = await ctx.vinculo(ctx.fx.organization.id);
    const codigo = codigoNovo();
    const resultados = await Promise.allSettled([
      orgs.updatePromoterLink(ctx.fx.organization.id, ctx.link.id, ctx.dono.id, { code: codigo }),
      orgs.updatePromoterLink(ctx.fx.organization.id, outro.id, ctx.dono.id, { code: codigo }),
    ]);
    const ok = resultados.filter((r) => r.status === "fulfilled");
    const recusados = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.equal(ok.length, 1, "só um fica com o código");
    assert.equal(recusados.length, 1);
    assert.match(String(recusados[0].reason?.message), /já está em uso/, "recusa com a frase certa, nunca erro 500");
    assert.equal(await prisma.promoterLink.count({ where: { code: codigo } }), 1);
  } finally {
    await desmontar(ctx);
  }
});

test("lista da Casa traz código, cota e escopo; a agenda do promoter não mostra evento privado", async () => {
  const ctx = await montar();
  try {
    const codigo = codigoNovo();
    await orgs.updatePromoterLink(ctx.fx.organization.id, ctx.link.id, ctx.dono.id, { code: codigo, guestQuota: 7 });
    const { promoter: doEvento, link: linkDoEvento } = await ctx.vinculo(ctx.fx.organization.id, {
      eventId: ctx.fx.event.id,
    });

    const daCasa = await orgs.listPromoters(ctx.fx.organization.id, ctx.dono.id);
    const daCasaInteira = daCasa.find((p) => p.id === ctx.link.id);
    assert.ok(daCasaInteira);
    assert.equal(daCasaInteira.code, codigo);
    assert.equal(daCasaInteira.guestQuota, 7);
    assert.equal(daCasaInteira.eventId, null, "vale para todos os eventos");
    assert.equal(daCasaInteira.eventSlug, null);
    const soDoEvento = daCasa.find((p) => p.id === linkDoEvento.id);
    assert.equal(soDoEvento?.eventId, ctx.fx.event.id);
    assert.equal(soDoEvento?.eventSlug, ctx.fx.event.slug, "o 'Copiar link' leva direto à festa");

    // público: aparece na agenda do promoter da Casa inteira
    const antes = await orgs.listMyPromoterEngagements(ctx.promoter.id);
    assert.ok(antes[0].events.some((e) => e.id === ctx.fx.event.id));

    // privado: some da agenda (regra de 2026-10-11) — o produtor manda o link
    await prisma.event.update({ where: { id: ctx.fx.event.id }, data: { isPrivate: true } });
    const depois = await orgs.listMyPromoterEngagements(ctx.promoter.id);
    assert.equal(depois[0].events.some((e) => e.id === ctx.fx.event.id), false);

    // promoter só deste evento continua vendo o evento dele, mesmo privado
    const [dele] = await orgs.listMyPromoterEngagements(doEvento.id);
    assert.equal(dele.event?.slug, ctx.fx.event.slug);
  } finally {
    await desmontar(ctx);
  }
});
