import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import type { CreateReviewInput } from "@borafest/contracts";

const PAID_ORDER_STATUSES = ["PAID", "FULFILLED"] as const;

@Injectable()
export class ReviewsService {
  /** Só quem teve pedido pago no evento pode avaliar, e só depois que o evento termina. */
  async create(eventId: string, userId: string, input: CreateReviewInput) {
    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, endsAt: true } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    if (event.endsAt.getTime() > Date.now()) {
      throw new BadRequestException("O evento ainda não terminou");
    }

    const hasPaidOrder = await prisma.order.findFirst({
      where: { eventId, userId, status: { in: [...PAID_ORDER_STATUSES] } },
      select: { id: true },
    });
    if (!hasPaidOrder) {
      throw new ForbiddenException("Só quem comprou ingresso pode avaliar este evento");
    }

    return prisma.eventReview.upsert({
      where: { eventId_userId: { eventId, userId } },
      create: { eventId, userId, rating: input.rating, comment: input.comment },
      update: { rating: input.rating, comment: input.comment },
    });
  }

  async getMine(eventId: string, userId: string) {
    return prisma.eventReview.findUnique({ where: { eventId_userId: { eventId, userId } } });
  }

  async summaryForEventSlug(slug: string) {
    const event = await prisma.event.findUnique({ where: { slug }, select: { id: true } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    return this.summaryForEvent(event.id);
  }

  async summaryForEvent(eventId: string) {
    const [aggregate, recent] = await Promise.all([
      prisma.eventReview.aggregate({ where: { eventId }, _avg: { rating: true }, _count: { _all: true } }),
      prisma.eventReview.findMany({
        where: { eventId, comment: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { rating: true, comment: true, createdAt: true, user: { select: { name: true } } },
      }),
    ]);
    return {
      average: aggregate._avg.rating,
      count: aggregate._count._all,
      recent,
    };
  }
}
