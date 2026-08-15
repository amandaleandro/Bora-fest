import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { isValidCpf } from "@borafest/auth";

@Injectable()
export class MeService {
  async profile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        cpf: true,
        notifyWhatsapp: true,
        notifyEmailOffers: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException("Usuário não encontrado");
    // conta VERIFICADA = tem CPF (recebe/transfere ingresso nominal)
    return { ...user, verified: Boolean(user.cpf) };
  }

  /**
   * Verificação da conta (decisão 2026-08-15): quem loga sem nunca ter
   * comprado pode informar o CPF aqui e ficar apto a RECEBER transferências.
   * CPF é definido UMA vez (trocar depois = suporte, anti-fraude) e é único.
   */
  async updateMe(
    userId: string,
    input: { name?: string; cpf?: string; notifyWhatsapp?: boolean; notifyEmailOffers?: boolean },
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Usuário não encontrado");

    let cpf: string | undefined;
    if (input.cpf !== undefined) {
      const digits = input.cpf.replace(/\D/g, "");
      if (digits.length !== 11) throw new BadRequestException("CPF inválido — são 11 dígitos");
      // dígitos verificadores: pega praticamente qualquer erro de digitação
      if (!isValidCpf(digits)) {
        throw new BadRequestException("CPF inválido — confira os números digitados");
      }
      if (user.cpf && user.cpf !== digits) {
        throw new BadRequestException("CPF já definido nesta conta — para trocar, fale com o suporte");
      }
      if (!user.cpf) {
        const dono = await prisma.user.findUnique({ where: { cpf: digits } });
        if (dono && dono.id !== userId) {
          throw new BadRequestException("Este CPF já está em outra conta BoraFest");
        }
        cpf = digits;
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(cpf ? { cpf } : {}),
        ...(input.notifyWhatsapp !== undefined ? { notifyWhatsapp: input.notifyWhatsapp } : {}),
        ...(input.notifyEmailOffers !== undefined ? { notifyEmailOffers: input.notifyEmailOffers } : {}),
      },
      select: { id: true, name: true, email: true, phone: true, cpf: true, notifyWhatsapp: true, notifyEmailOffers: true },
    });

    // trilha de segurança (2026-08-15): CPF recém-definido gera aviso por
    // e-mail — "se não foi você, fale com o suporte". Best-effort.
    if (cpf && updated.email) {
      await prisma.notification
        .create({
          data: {
            channel: "EMAIL",
            recipient: updated.email,
            template: "cpf_defined",
            payload: { cpfMasked: `${cpf.slice(0, 3)}.***.***-${cpf.slice(9)}`, name: updated.name },
          },
        })
        .catch(() => undefined);
    }
    return { ...updated, verified: Boolean(updated.cpf) };
  }

  async orders(userId: string) {
    const orders = await prisma.order.findMany({
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
        refundRequests: { where: { status: "PENDING" }, select: { id: true } },
      },
    });
    // o app mostra "reembolso em análise" e trava o botão com esta flag
    return orders.map(({ refundRequests, ...order }) => ({
      ...order,
      refundRequested: refundRequests.length > 0,
    }));
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

  /**
   * Salva a inscrição de Web Push do navegador/PWA (gamificação de vendas). O
   * endpoint é único: o MESMO aparelho re-inscrevendo apenas atualiza as chaves
   * e o dono (upsert por endpoint).
   */
  async savePushSubscription(
    userId: string,
    input: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; userAgent?: string },
  ) {
    const endpoint = input.endpoint?.trim();
    const p256dh = input.keys?.p256dh;
    const auth = input.keys?.auth;
    if (!endpoint || !p256dh || !auth) {
      throw new BadRequestException("Inscrição de push inválida");
    }
    await prisma.webPushSubscription.upsert({
      where: { endpoint },
      update: { userId, p256dh, auth, userAgent: input.userAgent ?? null },
      create: { userId, endpoint, p256dh, auth, userAgent: input.userAgent ?? null },
    });
    return { subscribed: true };
  }

  async removePushSubscription(userId: string, endpoint: string) {
    if (!endpoint) return { removed: false };
    // só remove a inscrição do PRÓPRIO usuário (não apaga a de outra conta)
    await prisma.webPushSubscription.deleteMany({ where: { endpoint, userId } });
    return { removed: true };
  }
}
