import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { registerEmailSender, type EmailMessage } from "@borafest/notifications";
import { OrganizationsService } from "../organizations/organizations.service";
import { OrgAccessService } from "../common/org-access.service";
import { EventsService } from "../events/events.service";
import { ReviewsService } from "../reviews/reviews.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

const sentEmails: EmailMessage[] = [];
registerEmailSender({
  provider: "capture",
  async send(message) {
    sentEmails.push(message);
  },
});
process.env.EMAIL_PROVIDER = "capture";

test("seguir produtor: toggle e notificação por e-mail ao publicar evento", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5 });

  try {
    const follower = await prisma.user.create({
      data: { email: `follower-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
    });

    const organizations = new OrganizationsService(new OrgAccessService());

    assert.equal((await organizations.isFollowing(fixture.organization.id, follower.id)).following, false);
    await organizations.follow(fixture.organization.id, follower.id);
    assert.equal((await organizations.isFollowing(fixture.organization.id, follower.id)).following, true);

    // idempotente
    await organizations.follow(fixture.organization.id, follower.id);
    assert.equal(await prisma.organizationFollow.count({ where: { organizationId: fixture.organization.id } }), 1);

    // publicar um evento DRAFT novo dispara e-mail pro seguidor
    const owner = await prisma.user.create({
      data: { email: `owner-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
    });
    await prisma.organizationMember.create({
      data: { organizationId: fixture.organization.id, userId: owner.id, roleId: fixture.ownerRoleId, status: "ACTIVE" },
    });
    const events = new EventsService(new OrgAccessService());
    const draft = await events.create(fixture.organization.id, owner.id, {
      title: "Segundo Evento",
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 90_000_000).toISOString(),
      timezone: "America/Sao_Paulo",
    } as any);

    const before = sentEmails.length;
    await events.publish(draft.id, owner.id);
    // notifyFollowers roda best-effort (não bloqueia o publish) — espera o fire-and-forget terminar
    for (let i = 0; i < 50 && sentEmails.length === before; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(sentEmails.length > before, "e-mail de novo evento foi enviado ao seguidor");
    assert.equal(sentEmails[sentEmails.length - 1].to, follower.email);

    await organizations.unfollow(fixture.organization.id, follower.id);
    assert.equal((await organizations.isFollowing(fixture.organization.id, follower.id)).following, false);

    await prisma.event.delete({ where: { id: draft.id } });
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("avaliação pós-evento: exige compra paga e evento encerrado, sem duplicar review", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5 });

  try {
    const buyer = await prisma.user.create({
      data: { email: `buyer-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
    });
    const reviews = new ReviewsService();

    // evento ainda não terminou → rejeitado
    await assert.rejects(
      reviews.create(fixture.event.id, buyer.id, { rating: 5 }),
      (error: any) => error.status === 400,
    );

    // evento encerrado, mas sem pedido pago → proibido
    await prisma.event.update({ where: { id: fixture.event.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    await assert.rejects(
      reviews.create(fixture.event.id, buyer.id, { rating: 5 }),
      (error: any) => error.status === 403,
    );

    // com pedido pago → aceita e é idempotente (upsert, não duplica)
    const reservation = await prisma.reservation.create({
      data: { eventId: fixture.event.id, status: "CONVERTED", expiresAt: new Date() },
    });
    await prisma.order.create({
      data: {
        eventId: fixture.event.id,
        reservationId: reservation.id,
        userId: buyer.id,
        contactEmail: buyer.email!,
        status: "PAID",
        totalCents: 10_000,
      },
    });

    await reviews.create(fixture.event.id, buyer.id, { rating: 4, comment: "Muito bom!" });
    await reviews.create(fixture.event.id, buyer.id, { rating: 5, comment: "Reconsiderei, foi ótimo" });

    assert.equal(await prisma.eventReview.count({ where: { eventId: fixture.event.id } }), 1);
    const mine = await reviews.getMine(fixture.event.id, buyer.id);
    assert.equal(mine?.rating, 5);

    const summary = await reviews.summaryForEvent(fixture.event.id);
    assert.equal(summary.count, 1);
    assert.equal(summary.average, 5);
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
