import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";

@Injectable()
export class PublicVipStatusService {
  async get(publicToken: string) {
    const reservation = await prisma.vipReservation.findUnique({
      where: { publicToken },
      select: {
        publicToken: true,
        status: true,
        units: true,
        partySize: true,
        unitPriceCents: true,
        totalCents: true,
        resolutionNote: true,
        respondedAt: true,
        createdAt: true,
        inventory: {
          select: {
            name: true,
            kind: true,
            event: {
              select: {
                title: true,
                slug: true,
                startsAt: true,
              },
            },
          },
        },
      },
    });
    if (!reservation) throw new NotFoundException("Reserva VIP não encontrada");
    return reservation;
  }
}
