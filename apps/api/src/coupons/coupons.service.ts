import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma, Prisma, type Coupon } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import type { CreateCouponInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";

@Injectable()
export class CouponsService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  async create(userId: string, eventId: string, input: CreateCouponInput) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    await this.orgAccess.assertPermission(event.organizationId, userId, PERMISSIONS.EVENT_CREATE);

    try {
      return await prisma.coupon.create({
        data: {
          eventId,
          code: input.code.toUpperCase(),
          discountType: input.discountType,
          discountValue: input.discountValue,
          maxRedemptions: input.maxRedemptions,
          expiresAt: input.expiresAt,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Já existe um cupom com este código no evento");
      }
      throw error;
    }
  }

  async list(userId: string, eventId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    await this.orgAccess.assertPermission(event.organizationId, userId, PERMISSIONS.EVENT_CREATE);
    return prisma.coupon.findMany({ where: { eventId }, orderBy: { createdAt: "desc" } });
  }

  async deactivate(userId: string, couponId: string) {
    const coupon = await prisma.coupon.findUnique({
      where: { id: couponId },
      include: { event: { select: { organizationId: true } } },
    });
    if (!coupon) throw new NotFoundException("Cupom não encontrado");
    await this.orgAccess.assertPermission(
      coupon.event.organizationId,
      userId,
      PERMISSIONS.EVENT_CREATE,
    );
    return prisma.coupon.update({ where: { id: couponId }, data: { active: false } });
  }

  /** Preview público para o checkout mostrar o desconto antes do pedido. */
  async check(eventSlug: string, code: string) {
    const event = await prisma.event.findUnique({ where: { slug: eventSlug } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    const coupon = await this.findUsable(event.id, code);
    return {
      valid: true,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
    };
  }

  /** Valida e retorna o cupom utilizável; lança 400 se inválido/esgotado. */
  async findUsable(eventId: string, code: string): Promise<Coupon> {
    const coupon = await prisma.coupon.findUnique({
      where: { eventId_code: { eventId, code: code.toUpperCase() } },
    });
    if (!coupon || !coupon.active) throw new BadRequestException("Cupom inválido");
    if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException("Cupom expirado");
    }
    if (coupon.maxRedemptions !== null && coupon.redeemedCount >= coupon.maxRedemptions) {
      throw new BadRequestException("Cupom esgotado");
    }
    return coupon;
  }

  static discountFor(coupon: Coupon, totalCents: number): number {
    const discount =
      coupon.discountType === "PERCENT"
        ? Math.round((totalCents * coupon.discountValue) / 100)
        : coupon.discountValue;
    return Math.min(discount, totalCents);
  }
}
