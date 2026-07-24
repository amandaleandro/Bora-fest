import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  confirmSaleInventory,
  prisma,
  reserveInventory,
  InsufficientStockError,
} from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import type { IssueComplimentaryInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";

@Injectable()
export class ComplimentaryService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  /**
   * Cortesia (protótipo: painel Ingressos > Cortesias): consome estoque do
   * lote normalmente e reusa TODA a máquina de emissão — pedido de R$ 0 já
   * PAID + outbox `order.paid` → o worker emite o QR assinado e envia o
   * e-mail exatamente como numa venda. Nenhum caminho paralelo de emissão.
   */
  async issue(userId: string, eventId: string, input: IssueComplimentaryInput) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    await this.orgAccess.assertPermission(event.organizationId, userId, PERMISSIONS.EVENT_CREATE);

    const lot = await prisma.ticketLot.findFirst({
      where: { id: input.ticketLotId, ticketType: { eventId } },
    });
    if (!lot) throw new BadRequestException("Lote não pertence a este evento");

    const order = await prisma
      .$transaction(async (tx) => {
        // segura e confirma na mesma transação: líquido = sold_count + qty,
        // com a checagem de capacidade do reserve garantindo sem overselling
        await reserveInventory(tx, lot.id, input.quantity);
        await confirmSaleInventory(tx, lot.id, input.quantity);

        const reservation = await tx.reservation.create({
          data: {
            eventId,
            status: "CONVERTED",
            expiresAt: new Date(),
            items: {
              create: [
                {
                  ticketLotId: lot.id,
                  quantity: input.quantity,
                  priceCents: 0,
                  feeCents: 0,
                },
              ],
            },
          },
        });

        const created = await tx.order.create({
          data: {
            eventId,
            reservationId: reservation.id,
            contactEmail: input.attendeeEmail,
            contactName: input.attendeeName,
            status: "PAID",
            paidAt: new Date(),
            totalCents: 0,
            items: {
              create: [
                {
                  ticketLotId: lot.id,
                  quantity: input.quantity,
                  priceCents: 0,
                  feeCents: 0,
                },
              ],
            },
          },
        });

        await tx.outboxEvent.create({
          data: {
            aggregateType: "order",
            aggregateId: created.id,
            eventType: "order.paid",
            payload: { orderId: created.id, complimentary: true },
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            organizationId: event.organizationId,
            action: "complimentary.issue",
            entityType: "order",
            entityId: created.id,
            metadata: {
              ticketLotId: lot.id,
              quantity: input.quantity,
              attendeeEmail: input.attendeeEmail,
            },
          },
        });

        return created;
      })
      .catch((error) => {
        if (error instanceof InsufficientStockError) {
          throw new BadRequestException("Estoque insuficiente para a cortesia");
        }
        throw error;
      });

    return { orderId: order.id, publicToken: order.publicToken };
  }

  async list(userId: string, eventId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    await this.orgAccess.assertPermission(event.organizationId, userId, PERMISSIONS.EVENT_CREATE);

    return prisma.order.findMany({
      where: { eventId, totalCents: 0, status: { in: ["PAID", "FULFILLED"] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        publicToken: true,
        contactName: true,
        contactEmail: true,
        status: true,
        createdAt: true,
        items: { select: { quantity: true, ticketLot: { select: { name: true } } } },
      },
    });
  }
}
