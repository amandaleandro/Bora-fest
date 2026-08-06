"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFixtureEvent = createFixtureEvent;
exports.cleanupFixtureEvent = cleanupFixtureEvent;
const database_1 = require("@borafest/database");
/**
 * Fixtures de integração: cada teste cria sua própria organização/evento/lote
 * e limpa tudo no fim (`cleanup()`), pra rodar contra o Postgres de dev sem
 * sujar dados nem colidir entre execuções (nomes com sufixo aleatório).
 */
async function createFixtureEvent(options) {
    const suffix = Math.random().toString(36).slice(2, 10);
    const ownerRole = await database_1.prisma.role.findUniqueOrThrow({ where: { key: "owner" } });
    const organization = await database_1.prisma.organization.create({
        data: {
            name: `Teste Integração ${suffix}`,
            slug: `teste-integracao-${suffix}`,
            kind: "COMPANY",
            document: `${Math.floor(Math.random() * 1e14)}`,
            status: "ACTIVE",
        },
    });
    const event = await database_1.prisma.event.create({
        data: {
            organizationId: organization.id,
            title: `Evento Teste ${suffix}`,
            slug: `evento-teste-${suffix}`,
            status: "PUBLISHED",
            startsAt: new Date(Date.now() + 86_400_000),
            endsAt: new Date(Date.now() + 90_000_000),
            publishedAt: new Date(),
        },
    });
    const ticketType = await database_1.prisma.ticketType.create({
        data: { eventId: event.id, name: "Pista" },
    });
    const lot = await database_1.prisma.ticketLot.create({
        data: {
            ticketTypeId: ticketType.id,
            name: "Lote único",
            priceCents: options.priceCents ?? 5000,
            feeCents: options.feeCents ?? 500,
            capacity: options.lotCapacity,
            status: "ACTIVE",
        },
    });
    return { organization, event, ticketType, lot, ownerRoleId: ownerRole.id };
}
async function cleanupFixtureEvent(organizationId) {
    const event = await database_1.prisma.event.findFirst({ where: { organizationId } });
    if (event) {
        await database_1.prisma.checkin.deleteMany({ where: { eventId: event.id } });
        await database_1.prisma.checkinSyncBatch.deleteMany({
            where: { device: { eventId: event.id } },
        });
        await database_1.prisma.validatorDevice.deleteMany({ where: { eventId: event.id } });
        await database_1.prisma.validatorCredential.deleteMany({ where: { eventId: event.id } });
        await database_1.prisma.ticket.deleteMany({ where: { eventId: event.id } });
        await database_1.prisma.refundRequest.deleteMany({ where: { order: { eventId: event.id } } });
        await database_1.prisma.pushToken.deleteMany({ where: { order: { eventId: event.id } } });
        await database_1.prisma.orderAttendee.deleteMany({ where: { order: { eventId: event.id } } });
        await database_1.prisma.consent.deleteMany({ where: { order: { eventId: event.id } } });
        await database_1.prisma.orderItem.deleteMany({ where: { order: { eventId: event.id } } });
        await database_1.prisma.payment.deleteMany({ where: { order: { eventId: event.id } } });
        await database_1.prisma.order.deleteMany({ where: { eventId: event.id } });
        await database_1.prisma.reservationItem.deleteMany({ where: { reservation: { eventId: event.id } } });
        await database_1.prisma.reservation.deleteMany({ where: { eventId: event.id } });
        await database_1.prisma.ticketLot.deleteMany({ where: { ticketType: { eventId: event.id } } });
        await database_1.prisma.ticketType.deleteMany({ where: { eventId: event.id } });
    }
    await database_1.prisma.payoutRequest.deleteMany({ where: { organizationId } });
    await database_1.prisma.ledgerEntry.deleteMany({
        where: { ledgerAccount: { organizationId } },
    });
    await database_1.prisma.ledgerAccount.deleteMany({ where: { organizationId } });
    await database_1.prisma.event.deleteMany({ where: { organizationId } });
    await database_1.prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
}
