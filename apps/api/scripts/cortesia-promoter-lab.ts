/**
 * COTA DE CORTESIA DO PROMOTER (2026-09-08).
 *
 * Gap apontado no benchmark de mercado: Shotgun e Fatsoma dão teto de cortesia
 * por promoter; a BoraFest não tinha nenhum — o limite era a capacidade do lote,
 * COMPARTILHADA, então um promoter sozinho podia consumir a cota inteira da casa.
 * Pior: o promoter (que não é membro da organização) nem alcançava a lista.
 *
 * Este lab prova a regra nova ponta a ponta:
 *   - promoter SEM cota não cadastra;
 *   - promoter COM cota cadastra até o teto e o teto barra de verdade;
 *   - cancelar devolve a vaga da cota;
 *   - a produção segue SEM teto próprio;
 *   - a etiqueta sai CORTESIA com o NOME de quem convidou (não "da produção");
 *   - estranho não cadastra nada.
 *
 * Roda: npx tsx scripts/cortesia-promoter-lab.ts
 */
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { OrgAccessService } from "../src/common/org-access.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { GuestListService } from "../src/guest-list/guest-list.service";
import { TicketsService } from "../src/tickets/tickets.service";
import { createFixtureEvent, cleanupFixtureEvent } from "../src/__tests__/helpers";

let pass = 0, fail = 0;
function ok(nome: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  PASS ${nome}`); }
  else { fail++; console.log(`  FAIL ${nome}`, extra ?? ""); }
}
async function recusa(fn: () => Promise<unknown>, trecho: string) {
  try { await fn(); return null; } catch (e) { const m = (e as Error).message; return m.includes(trecho) ? m : `MENSAGEM INESPERADA: ${m}`; }
}

async function main() {
  const orgAccess = new OrgAccessService();
  const inventory = new InventoryService();
  const guest = new GuestListService(orgAccess, inventory);
  const tickets = new TicketsService();
  const suf = Math.random().toString(36).slice(2, 8);

  const f = await createFixtureEvent({ lotCapacity: 50, priceCents: 0, feeCents: 0 });
  const ev = f.event;

  const dono = await prisma.user.create({ data: { email: `dono-${suf}@lab.test`, emailVerifiedAt: new Date() } });
  await prisma.organizationMember.create({
    data: { organizationId: f.organization.id, userId: dono.id, roleId: f.ownerRoleId, status: "ACTIVE" },
  });
  const promoter = await prisma.user.create({ data: { email: `promoter-${suf}@lab.test`, name: "Bia Promoter", emailVerifiedAt: new Date() } });
  const estranho = await prisma.user.create({ data: { email: `estranho-${suf}@lab.test`, emailVerifiedAt: new Date() } });

  try {
    console.log("\n1) ESTRANHO não cadastra convidado");
    const rEstranho = await recusa(
      () => guest.create(estranho.id, ev.id, { ticketLotId: f.lot.id, guestName: "Penetra" } as never),
      "não pode cadastrar",
    );
    ok("estranho recusado", rEstranho !== null && !rEstranho.startsWith("MENSAGEM"), rEstranho);

    console.log("\n2) PROMOTER SEM COTA também não — 0 é o padrão");
    const vinculo = await prisma.promoterLink.create({
      data: {
        organizationId: f.organization.id, promoterUserId: promoter.id, status: "ACTIVE",
        slug: `bia-${suf}`, commissionType: "NONE", guestQuota: 0,
      },
    });
    const rSemCota = await recusa(
      () => guest.create(promoter.id, ev.id, { ticketLotId: f.lot.id, guestName: "Amigo 1" } as never),
      "não tem cortesias liberadas",
    );
    ok("promoter sem cota recusado, com o motivo certo", rSemCota !== null && !rSemCota.startsWith("MENSAGEM"), rSemCota);

    console.log("\n3) A CASA libera 2 cortesias: ele cadastra 2 e a 3ª é barrada");
    await prisma.promoterLink.update({ where: { id: vinculo.id }, data: { guestQuota: 2 } });
    const e1 = await guest.create(promoter.id, ev.id, { ticketLotId: f.lot.id, guestName: "Amigo 1" } as never);
    const e2 = await guest.create(promoter.id, ev.id, { ticketLotId: f.lot.id, guestName: "Amigo 2" } as never);
    ok("1ª cortesia cadastrada", !!e1);
    ok("2ª cortesia cadastrada", !!e2);
    const rTeto = await recusa(
      () => guest.create(promoter.id, ev.id, { ticketLotId: f.lot.id, guestName: "Amigo 3" } as never),
      "cota de cortesias acabou",
    );
    ok("3ª barrada pelo TETO (não pela capacidade do lote)", rTeto !== null && !rTeto.startsWith("MENSAGEM"), rTeto);
    ok("a mensagem diz quanto ele usou", (rTeto ?? "").includes("2 de 2"), rTeto);

    console.log("\n4) A vaga da cota VOLTA quando o convite é cancelado");
    const entradas = await prisma.guestListEntry.findMany({ where: { eventId: ev.id, addedByUserId: promoter.id } });
    await prisma.guestListEntry.update({ where: { id: entradas[0].id }, data: { status: "CANCELED" } });
    const e3 = await guest.create(promoter.id, ev.id, { ticketLotId: f.lot.id, guestName: "Amigo 3" } as never);
    ok("cancelou um, conseguiu cadastrar outro", !!e3);

    console.log("\n5) A PRODUÇÃO segue sem teto próprio (limite é a capacidade do lote)");
    for (let i = 0; i < 5; i++) {
      await guest.create(dono.id, ev.id, { ticketLotId: f.lot.id, guestName: `VIP ${i}` } as never);
    }
    const daProducao = await prisma.guestListEntry.count({ where: { eventId: ev.id, addedByUserId: dono.id } });
    ok("produção cadastrou 5 sem esbarrar em cota", daProducao === 5, daProducao);

    console.log("\n6) ETIQUETA: cortesia do promoter sai CORTESIA com o NOME dele");
    const pedidoPromoter = await prisma.order.findFirstOrThrow({
      where: { eventId: ev.id, promoterLinkId: vinculo.id }, orderBy: { createdAt: "desc" },
    });
    const carteira = await tickets.findByOrderPublicToken(pedidoPromoter.publicToken);
    ok("kind = CORTESIA", (carteira as any).cortesia?.kind === "CORTESIA", JSON.stringify((carteira as any).cortesia));
    ok("por = nome do promoter", (carteira as any).cortesia?.por === "Bia Promoter", JSON.stringify((carteira as any).cortesia));

    console.log("\n7) ETIQUETA: convidado da produção continua CONVIDADO");
    const pedidoProducao = await prisma.order.findFirstOrThrow({
      where: { eventId: ev.id, soldByUserId: dono.id, promoterLinkId: null }, orderBy: { createdAt: "desc" },
    });
    const carteiraVip = await tickets.findByOrderPublicToken(pedidoProducao.publicToken);
    ok("kind = CONVIDADO", (carteiraVip as any).cortesia?.kind === "CONVIDADO", JSON.stringify((carteiraVip as any).cortesia));
    ok("por = produção", (carteiraVip as any).cortesia?.por === "produção");

    console.log("\n8) A lista continua fechando quando o evento começa");
    await prisma.event.update({ where: { id: ev.id }, data: { startsAt: new Date(Date.now() - 3600e3) } });
    const rFechada = await recusa(
      () => guest.create(promoter.id, ev.id, { ticketLotId: f.lot.id, guestName: "Atrasado" } as never),
      "fecha quando o evento começa",
    );
    ok("lista fechada barra até quem tem cota", rFechada !== null && !rFechada.startsWith("MENSAGEM"), rFechada);
  } finally {
    await cleanupFixtureEvent(f.organization.id).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    await closeRedisConnection();
  }

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
