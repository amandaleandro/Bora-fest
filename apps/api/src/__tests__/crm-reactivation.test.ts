import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { renderCrmReactivationEmail } from "@borafest/notifications";
import { IdempotencyService } from "../common/idempotency.service";
import { OrgAccessService } from "../common/org-access.service";
import { CustomerCrmService } from "../customer-crm/customer-crm.service";
import { CrmReactivationService } from "../customer-crm/crm-reactivation.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

let fixture: Awaited<ReturnType<typeof createFixtureEvent>>;
let ownerId = "";
const userIds: string[] = [];

const customerCrm = new CustomerCrmService(new OrgAccessService());
const reactivation = new CrmReactivationService(customerCrm, new IdempotencyService());

async function createPaidOrder(userId: string, email: string, name: string) {
  const reservation = await prisma.reservation.create({
    data: {
      eventId: fixture.event.id,
      userId,
      status: "CONVERTED",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await prisma.order.create({
    data: {
      eventId: fixture.event.id,
      reservationId: reservation.id,
      userId,
      contactEmail: email,
      contactName: name,
      status: "PAID",
      totalCents: 7000,
      paidAt: new Date(),
    },
  });
}

describe("N6 — reativação do CRM", () => {
  before(async () => {
    fixture = await createFixtureEvent({ lotCapacity: 100, priceCents: 7000, feeCents: 700 });

    const owner = await prisma.user.create({ data: { email: `n6-owner-${Date.now()}@example.com` } });
    ownerId = owner.id;
    userIds.push(owner.id);
    await prisma.organizationMember.create({
      data: {
        organizationId: fixture.organization.id,
        userId: owner.id,
        roleId: fixture.ownerRoleId,
        status: "ACTIVE",
      },
    });

    const optedIn = await prisma.user.create({
      data: {
        email: `n6-optin-${Date.now()}@example.com`,
        name: "Cliente Opt-in",
        notifyEmailOffers: true,
      },
    });
    const optedOut = await prisma.user.create({
      data: {
        email: `n6-optout-${Date.now()}@example.com`,
        name: "Cliente Sem Opt-in",
        notifyEmailOffers: false,
      },
    });
    userIds.push(optedIn.id, optedOut.id);
    await createPaidOrder(optedIn.id, optedIn.email!, optedIn.name!);
    await createPaidOrder(optedOut.id, optedOut.email!, optedOut.name!);
  });

  after(async () => {
    await cleanupFixtureEvent(fixture.organization.id);
    for (const id of userIds.reverse()) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
  });

  it("nunca inclui cliente sem opt-in no público de reativação", async () => {
    const preview = await reactivation.preview(fixture.organization.id, ownerId, { segment: "ALL" });
    assert.equal(preview.eligibleCount, 1);
    assert.equal(preview.sample[0]?.name, "Cliente Opt-in");
    assert.equal(preview.sample.some((item) => item.name === "Cliente Sem Opt-in"), false);
  });

  it("escapa HTML digitado pelo produtor antes de renderizar o e-mail", () => {
    const email = renderCrmReactivationEmail("cliente@example.com", {
      campaignId: "crm-test",
      organizationId: fixture.organization.id,
      houseName: "Casa <Teste>",
      customerName: "Ana <b>",
      subject: "Volta pra festa",
      message: "Oi <script>alert('x')</script>\nTem rolê novo.",
      ctaLabel: "Ver <evento>",
      ctaUrl: "https://borafest.com.br/evento/teste",
    });

    assert.ok(email.html);
    assert.equal(email.html?.includes("<script>"), false);
    assert.ok(email.html?.includes("&lt;script&gt;"));
    assert.ok(email.html?.includes("Casa &lt;Teste&gt;"));
    assert.ok(email.html?.includes("Ver &lt;evento&gt;"));
  });
});
