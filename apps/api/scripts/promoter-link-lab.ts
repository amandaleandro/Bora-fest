/**
 * CÓDIGO PESSOAL + LOTE EXCLUSIVO DO PROMOTER (2026-09-08).
 *
 * Dois gaps que o benchmark apontou contra Sympla/Shotgun/Fatsoma:
 *
 *  - CÓDIGO PESSOAL: nosso link dependia de localStorage de 7 dias, que se
 *    perde ao trocar de aparelho ou abrir no navegador do Instagram. A própria
 *    fornecedora da Sympla recomenda o código como salvaguarda. Agora o
 *    comprador digita "BIA10" no checkout e a comissão vai pro dono.
 *
 *  - LOTE EXCLUSIVO: preço especial só para quem compra "com o fulano".
 *    Shotgun e Fatsoma têm; nós não tínhamos.
 *
 * Roda: npx tsx scripts/promoter-link-lab.ts
 */
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { CatalogService } from "../src/catalog/catalog.service";
import { OrgAccessService } from "../src/common/org-access.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { OrdersService } from "../src/orders/orders.service";
import { CouponsService } from "../src/coupons/coupons.service";
import { ReservationsService } from "../src/reservations/reservations.service";
import { WaitingRoomService } from "../src/waiting-room/waiting-room.service";
import { createFixtureEvent, cleanupFixtureEvent } from "../src/__tests__/helpers";

let pass = 0, fail = 0;
function ok(nome: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  PASS ${nome}`); }
  else { fail++; console.log(`  FAIL ${nome}`, extra ?? ""); }
}

async function main() {
  const orgAccess = new OrgAccessService();
  const catalog = new CatalogService(orgAccess, new InventoryService());
  const orders = new OrdersService(new CouponsService(orgAccess), orgAccess);
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const suf = Math.random().toString(36).slice(2, 8);

  const f = await createFixtureEvent({ lotCapacity: 50, priceCents: 5000, feeCents: 0 });
  const ev = f.event;
  const dono = await prisma.user.create({ data: { email: `dono-${suf}@lab.test`, emailVerifiedAt: new Date() } });
  await prisma.organizationMember.create({
    data: { organizationId: f.organization.id, userId: dono.id, roleId: f.ownerRoleId, status: "ACTIVE" },
  });
  const bia = await prisma.user.create({ data: { email: `bia-${suf}@lab.test`, name: "Bia", emailVerifiedAt: new Date() } });
  const link = await prisma.promoterLink.create({
    data: {
      organizationId: f.organization.id, promoterUserId: bia.id, status: "ACTIVE",
      slug: `bia-${suf}`, code: `BIA${suf.toUpperCase().slice(0, 3)}`,
      commissionType: "PERCENT", commissionBps: 1000, // 10%
    },
  });

  async function comprar(extra: Record<string, unknown>) {
    const r = await reservations.create(undefined, { eventId: ev.id, items: [{ ticketLotId: f.lot.id, quantity: 1 }] } as never);
    const o = await orders.createFromReservation(undefined, {
      reservationId: r.id, contactEmail: `c-${Math.random().toString(36).slice(2, 8)}@lab.test`, ...extra,
    } as never);
    return prisma.order.findUniqueOrThrow({ where: { id: o.id } });
  }

  try {
    console.log("\n1) CÓDIGO PESSOAL atribui a comissão mesmo SEM o link (cookie perdido)");
    const porCodigo = await comprar({ promoterCode: link.code });
    ok("pedido foi atribuído ao promoter", porCodigo.promoterLinkId === link.id);
    ok("comissão de 10% calculada", porCodigo.promoterCommissionCents === 500, porCodigo.promoterCommissionCents);

    console.log("\n2) O código é indiferente a maiúscula/minúscula e a espaço");
    const bagunçado = await comprar({ promoterCode: `  ${link.code!.toLowerCase()} ` });
    ok("digitou torto e mesmo assim atribuiu", bagunçado.promoterLinkId === link.id);

    console.log("\n3) O LINK continua vencendo o código (last-click manda)");
    const outro = await prisma.user.create({ data: { email: `outro-${suf}@lab.test`, emailVerifiedAt: new Date() } });
    const linkOutro = await prisma.promoterLink.create({
      data: {
        organizationId: f.organization.id, promoterUserId: outro.id, status: "ACTIVE",
        slug: `outro-${suf}`, code: `OUT${suf.toUpperCase().slice(0, 3)}`,
        commissionType: "PERCENT", commissionBps: 1000,
      },
    });
    const conflito = await comprar({ promoterSlug: linkOutro.slug, promoterCode: link.code });
    ok("veio pelo link do OUTRO: a comissão é dele", conflito.promoterLinkId === linkOutro.id);

    console.log("\n4) Código inválido não quebra a compra nem inventa comissão");
    const invalido = await comprar({ promoterCode: "NAOEXISTE" });
    ok("compra concluída normalmente", !!invalido.id);
    ok("sem promoter atribuído", invalido.promoterLinkId === null);
    ok("sem comissão", invalido.promoterCommissionCents === 0);

    console.log("\n5) LOTE EXCLUSIVO: invisível no hotsite público");
    const exclusivo = await catalog.createLot(f.ticketType.id, dono.id, {
      name: "Lote da Bia", priceCents: 3000, feeCents: 0, capacity: 10, maxPerOrder: 4, promoterOnly: true,
    } as never);
    await prisma.ticketLot.update({ where: { id: exclusivo.id }, data: { status: "ACTIVE" } });
    const publico = await catalog.getPublicEvent(ev.slug);
    const nomesPublicos = publico.ticketTypes.flatMap((t: any) => t.lots.map((l: any) => l.name));
    ok("hotsite público NÃO mostra o lote exclusivo", !nomesPublicos.includes("Lote da Bia"), JSON.stringify(nomesPublicos));

    console.log("\n6) LOTE EXCLUSIVO: aparece para quem chegou pelo link da Bia");
    const comLink = await catalog.getPublicEvent(ev.slug, link.slug);
    const nomesBia = comLink.ticketTypes.flatMap((t: any) => t.lots.map((l: any) => l.name));
    ok("com ?pr= da Bia o lote aparece", nomesBia.includes("Lote da Bia"), JSON.stringify(nomesBia));

    console.log("\n7) SEGURANÇA: slug inexistente ou de outra casa não revela o lote");
    const chute = await catalog.getPublicEvent(ev.slug, "slug-que-nao-existe");
    const nomesChute = chute.ticketTypes.flatMap((t: any) => t.lots.map((l: any) => l.name));
    ok("slug inválido não revela (falha fechada)", !nomesChute.includes("Lote da Bia"), JSON.stringify(nomesChute));

    console.log("\n8) SEGURANÇA: promoter REMOVIDO deixa de revelar o lote");
    await prisma.promoterLink.update({ where: { id: link.id }, data: { status: "REMOVED" } });
    const removido = await catalog.getPublicEvent(ev.slug, link.slug);
    const nomesRemovido = removido.ticketTypes.flatMap((t: any) => t.lots.map((l: any) => l.name));
    ok("promoter inativo não revela mais", !nomesRemovido.includes("Lote da Bia"), JSON.stringify(nomesRemovido));
    await prisma.promoterLink.update({ where: { id: link.id }, data: { status: "ACTIVE" } });

    console.log("\n9) SEGURANÇA: o código de um promoter REMOVIDO não atribui comissão");
    await prisma.promoterLink.update({ where: { id: link.id }, data: { status: "REMOVED" } });
    const semDireito = await comprar({ promoterCode: link.code });
    ok("promoter inativo não recebe", semDireito.promoterLinkId === null);
  } finally {
    await cleanupFixtureEvent(f.organization.id).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    await closeRedisConnection();
  }

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
