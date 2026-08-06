import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

test("link de parceiro: slug gerado no cadastro, atribuído no checkout e comissão calculada", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 10_000, feeCents: 0 });

  try {
    const owner = await prisma.user.create({
      data: { email: `owner-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
    });
    await prisma.organizationMember.create({
      data: { organizationId: fixture.organization.id, userId: owner.id, roleId: fixture.ownerRoleId, status: "ACTIVE" },
    });

    const organizations = new OrganizationsService(new OrgAccessService());
    const partner = await organizations.createSalesPartner(fixture.organization.id, owner.id, {
      name: "Atlética Teste",
      commissionBps: 1000, // 10%
    });
    assert.equal(partner.slug, "atletica-teste");

    // segundo parceiro com nome diferente mas que gera o mesmo slug base → deduplicado
    const partner2 = await organizations.createSalesPartner(fixture.organization.id, owner.id, {
      name: "Atlética, Teste!",
      commissionBps: 500,
    });
    assert.equal(partner2.slug, "atletica-teste-2");

    const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
    const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());

    // pedido sem partnerSlug: não atribui parceiro
    const reservationSemLink = await reservations.create(undefined, {
      eventId: fixture.event.id,
      items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
    });
    const orderSemLink = await orders.createFromReservation(undefined, {
      reservationId: reservationSemLink.id,
      contactEmail: "sem-link@test.dev",
    });
    assert.equal(orderSemLink.salesPartnerId, null);
    assert.equal(orderSemLink.partnerCommissionCents, 0);

    // pedido com ?p=atletica-teste: atribui o parceiro e calcula 10% do total
    const reservationComLink = await reservations.create(undefined, {
      eventId: fixture.event.id,
      items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
    });
    const orderComLink = await orders.createFromReservation(undefined, {
      reservationId: reservationComLink.id,
      contactEmail: "com-link@test.dev",
      partnerSlug: partner.slug,
    } as any);
    assert.equal(orderComLink.salesPartnerId, partner.id);
    assert.equal(orderComLink.attributionSource, "LINK");
    assert.equal(orderComLink.partnerCommissionCents, 1000); // 10% de 10.000

    // slug de outra organização (ou inexistente) não atribui nada
    const reservationSlugInvalido = await reservations.create(undefined, {
      eventId: fixture.event.id,
      items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
    });
    const orderSlugInvalido = await orders.createFromReservation(undefined, {
      reservationId: reservationSlugInvalido.id,
      contactEmail: "slug-invalido@test.dev",
      partnerSlug: "nao-existe",
    } as any);
    assert.equal(orderSlugInvalido.salesPartnerId, null);
  } finally {
    await prisma.salesPartner.deleteMany({ where: { organizationId: fixture.organization.id } });
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
