import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";

@Injectable()
export class MeService {
  async profile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true, createdAt: true },
    });
    if (!user) throw new NotFoundException("Usuário não encontrado");
    return user;
  }

  async orders(userId: string) {
    return prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        publicToken: true,
        status: true,
        totalCents: true,
        discountCents: true,
        createdAt: true,
        event: { select: { title: true, slug: true, startsAt: true, endsAt: true } },
        items: { select: { quantity: true, ticketLot: { select: { name: true } } } },
      },
    });
  }

  /** LGPD: portabilidade — tudo que temos sobre o titular, em JSON. */
  async dataExport(userId: string) {
    const [user, orders, tickets] = await Promise.all([
      this.profile(userId),
      this.orders(userId),
      prisma.ticket.findMany({
        where: { order: { userId } },
        select: { id: true, code: true, status: true, issuedAt: true, attendeeName: true },
      }),
    ]);
    return { exportedAt: new Date(), user, orders, tickets };
  }

  /**
   * LGPD/Apple 5.1.1(v): exclusão de conta — anonimização imediata dos dados
   * pessoais; registros financeiros/auditoria são mantidos sem identificação
   * (política pública: remoção completa em até 30 dias).
   */
  async deleteAccount(userId: string) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          name: null,
          email: `apagado-${userId.slice(0, 8)}@anon.borafest.invalid`,
          phone: null,
          cpf: null,
          passwordHash: null,
        },
      }),
      prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: "account.delete",
          entityType: "user",
          entityId: userId,
        },
      }),
    ]);
    return { deleted: true };
  }
}
