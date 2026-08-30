import { createSessionToken } from "@borafest/auth";
import { addBusinessDays } from "@borafest/payments";
import { executarReembolso } from "../common/refund-order";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  confirmSaleInventory,
  reserveInventory,
  returnSaleInventory,
  InsufficientStockError,
  prisma,
} from "@borafest/database";
import { createReservationExpirationQueue } from "@borafest/queues";
import { applyGatewayStatus, computePlatformFeeCents, getGateway } from "@borafest/payments";
import { PERMISSIONS } from "@borafest/auth";
import type { CreateOrderInput, PdvOrderInput, RefundOrderInput } from "@borafest/contracts";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";

/**
 * Janela para pagar depois de criar o pedido. O estoque permanece em
 * `reserved_count` até o pagamento aprovar (aí vira `sold_count`) ou a janela
 * expirar (aí é liberado pelo worker de expiração de pedidos).
 */
const ORDER_PAYMENT_WINDOW_MINUTES = 15;

@Injectable()
export class OrdersService {
  private readonly expirationQueue = createReservationExpirationQueue();

  constructor(
    private readonly coupons: CouponsService,
    private readonly orgAccess: OrgAccessService,
  ) {}

  async createFromReservation(userId: string | undefined, input: CreateOrderInput) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: input.reservationId },
      include: { items: true },
    });

    if (!reservation) throw new NotFoundException("Reserva não encontrada");
    if (reservation.status !== "ACTIVE") {
      throw new BadRequestException("Reserva não está mais ativa");
    }
    if (reservation.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("Reserva expirada");
    }

    // quem paga a taxa (handoff v2 §3): BUYER soma a taxa ao comprador;
    // PRODUCER absorve — o comprador paga só o preço e o repasse é descontado.
    const lots = await prisma.ticketLot.findMany({
      where: { id: { in: reservation.items.map((i) => i.ticketLotId) } },
      select: { id: true, feeMode: true, nominal: true, requiresCpf: true },
    });
    const lotById = new Map(lots.map((l) => [l.id, l]));

    const itemsTotalCents = reservation.items.reduce((sum, item) => {
      const producerAbsorbs = lotById.get(item.ticketLotId)?.feeMode === "PRODUCER";
      const unit = item.priceCents + (producerAbsorbs ? 0 : item.feeCents);
      return sum + unit * item.quantity;
    }, 0);

    // ingressos nominais exigem um participante por unidade
    const nominalItems = reservation.items.filter((i) => lotById.get(i.ticketLotId)?.nominal);
    if (nominalItems.length > 0) {
      for (const item of nominalItems) {
        const provided = (input.attendees ?? []).filter((a) => a.ticketLotId === item.ticketLotId);
        if (provided.length < item.quantity) {
          throw new BadRequestException(
            "Informe o nome de cada participante dos ingressos nominais",
          );
        }
        if (lotById.get(item.ticketLotId)?.requiresCpf && provided.some((a) => !a.cpf)) {
          throw new BadRequestException("CPF obrigatório para os ingressos deste setor");
        }
      }
    }

    const coupon = input.couponCode
      ? await this.coupons.findUsable(reservation.eventId, input.couponCode)
      : null;
    const discountCents = coupon ? CouponsService.discountFor(coupon, itemsTotalCents) : 0;
    const ticketTotalCents = itemsTotalCents - discountCents;

    // itens adicionais (upsell) — não entram na base de comissão do parceiro, só na venda
    const addOnSelections = input.addOns ?? [];
    let addOns: { id: string; priceCents: number }[] = [];
    if (addOnSelections.length > 0) {
      addOns = await prisma.eventAddOn.findMany({
        where: { id: { in: addOnSelections.map((a) => a.addOnId) }, eventId: reservation.eventId, active: true },
        select: { id: true, priceCents: true },
      });
      if (addOns.length !== new Set(addOnSelections.map((a) => a.addOnId)).size) {
        throw new BadRequestException("Item adicional inválido para este evento");
      }
    }
    const addOnById = new Map(addOns.map((a) => [a.id, a]));
    const addOnsTotalCents = addOnSelections.reduce(
      (sum, sel) => sum + (addOnById.get(sel.addOnId)?.priceCents ?? 0) * sel.quantity,
      0,
    );

    const totalCents = ticketTotalCents + addOnsTotalCents;

    // atribuição de PROMOTER/VENDEDOR (Promoter v3). Link de vendedor (?vd=)
    // implica o promoter dele; link de promoter (?pr=) atribui só o promoter.
    // A comissão (NONE/PERCENT/FIXED) vem do promoter e vai para a carteira
    // DELE — o vendedor nunca recebe pela plataforma, só contabiliza. Promoter
    // vence a atlética antiga (?p=): nunca comissão dupla.
    let promoterLinkId: string | undefined;
    let promoterSellerId: string | undefined;
    let promoterCommissionCents = 0;
    const eventOrg = await prisma.event.findUnique({
      where: { id: reservation.eventId },
      select: { organizationId: true },
    });
    let promoterLink:
      | { id: string; commissionType: string; commissionBps: number; commissionFixedCents: number }
      | null = null;
    if (input.sellerSlug && eventOrg) {
      const seller = await prisma.promoterSeller.findFirst({
        where: {
          slug: input.sellerSlug,
          status: "ACTIVE",
          promoterLink: {
            organizationId: eventOrg.organizationId,
            status: "ACTIVE",
            // escopo por evento: link de outro evento NÃO atribui aqui
            OR: [{ eventId: null }, { eventId: reservation.eventId }],
          },
        },
        select: {
          id: true,
          promoterLink: {
            select: { id: true, commissionType: true, commissionBps: true, commissionFixedCents: true },
          },
        },
      });
      if (seller) {
        promoterSellerId = seller.id;
        promoterLink = seller.promoterLink;
      }
    }
    if (!promoterLink && input.promoterSlug && eventOrg) {
      promoterLink = await prisma.promoterLink.findFirst({
        where: {
          organizationId: eventOrg.organizationId,
          slug: input.promoterSlug,
          status: "ACTIVE",
          // escopo por evento: ?pr= de outro evento é ignorado (sem comissão)
          OR: [{ eventId: null }, { eventId: reservation.eventId }],
        },
        select: { id: true, commissionType: true, commissionBps: true, commissionFixedCents: true },
      });
    }
    if (promoterLink) {
      promoterLinkId = promoterLink.id;
      const totalTickets = reservation.items.reduce((sum, it) => sum + it.quantity, 0);
      if (promoterLink.commissionType === "PERCENT") {
        promoterCommissionCents = Math.floor((ticketTotalCents * promoterLink.commissionBps) / 10_000);
      } else if (promoterLink.commissionType === "FIXED") {
        promoterCommissionCents = promoterLink.commissionFixedCents * totalTickets;
      }
      // teto: comissão NUNCA passa do que a casa recebeu pelos ingressos
      // (cupom agressivo + comissão fixa deixavam a casa no negativo —
      // revisão adversarial 2026-08-11)
      promoterCommissionCents = Math.max(0, Math.min(promoterCommissionCents, ticketTotalCents));
    }

    // atribuição por link público (?p=slug no hotsite) — comissão calculada igual ao PDV, só sobre ingressos
    let salesPartnerId: string | undefined;
    let partnerCommissionCents = 0;
    if (!promoterLinkId && input.partnerSlug) {
      const event = await prisma.event.findUnique({ where: { id: reservation.eventId }, select: { organizationId: true } });
      const partner = event
        ? await prisma.salesPartner.findFirst({
            where: { organizationId: event.organizationId, slug: input.partnerSlug, active: true },
            select: { id: true, commissionBps: true },
          })
        : null;
      if (partner) {
        salesPartnerId = partner.id;
        partnerCommissionCents = Math.floor((ticketTotalCents * partner.commissionBps) / 10_000);
      }
    }

    // Conta no checkout (decisão 2026-08-10): convidado foi extinto. Sem
    // sessão, a conta nasce INVISÍVEL dos próprios dados da compra (e-mail
    // existente = pedido anexa à conta). CPF/telefone só entram se ainda
    // livres (são únicos); e-mail verificado é o portão do 1º ingresso.
    let effectiveUserId = userId;
    let accountCreatedByOrder = false;
    if (!effectiveUserId && input.contactEmail) {
      const email = input.contactEmail.trim().toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        // INCIDENTE 2026-08-10: anexar o pedido à conta de um e-mail informado
        // sem prova de posse dava acesso a pedidos alheios (e abria a correção
        // de e-mail como sequestro de conta). Sem sessão, o pedido nasce SEM
        // dono — o verifyOtp reivindica quando a pessoa provar o e-mail dela.
        effectiveUserId = undefined;
      } else {
        const cpf = input.contactCpf?.replace(/\D/g, "") || undefined;
        const phone = input.contactPhone?.replace(/\D/g, "") || undefined;
        const [cpfLivre, phoneLivre] = await Promise.all([
          cpf ? prisma.user.findUnique({ where: { cpf } }).then((u) => !u) : Promise.resolve(false),
          phone ? prisma.user.findUnique({ where: { phone } }).then((u) => !u) : Promise.resolve(false),
        ]);
        const created = await prisma.user.create({
          data: {
            email,
            name: input.contactName ?? undefined,
            ...(cpf && cpfLivre ? { cpf } : {}),
            ...(phone && phoneLivre ? { phone } : {}),
            termsAcceptedAt: new Date(),
          },
        });
        effectiveUserId = created.id;
        accountCreatedByOrder = true;
      }
    }
    // CPF na conta só quando a sessão é do próprio dono ou a conta nasceu
    // deste pedido — nunca escrevendo em conta de terceiro
    if (effectiveUserId && input.contactCpf) {
      const cpf = input.contactCpf.replace(/\D/g, "");
      const dono = await prisma.user.findUnique({ where: { cpf } });
      if (!dono) {
        await prisma.user.updateMany({
          where: { id: effectiveUserId, cpf: null },
          data: { cpf },
        });
      }
    }

    const expiresAt = new Date(Date.now() + ORDER_PAYMENT_WINDOW_MINUTES * 60 * 1000);

    const order = await prisma.$transaction(async (tx) => {
      // guarda de corrida contra o worker de expiração: só converte se ainda ACTIVE
      const converted = await tx.reservation.updateMany({
        where: { id: reservation.id, status: "ACTIVE" },
        data: { status: "CONVERTED" },
      });
      if (converted.count === 0) {
        throw new BadRequestException("Reserva não está mais ativa");
      }

      // o estoque já está seguro em reserved_count; a venda (sold_count) só se
      // confirma quando o pagamento aprovar — nunca na criação do pedido
      const created = await tx.order.create({
        data: {
          eventId: reservation.eventId,
          reservationId: reservation.id,
          userId: effectiveUserId ?? reservation.userId,
          accountCreatedByOrder,
          contactEmail: input.contactEmail,
          contactName: input.contactName,
          contactPhone: input.contactPhone?.replace(/\D/g, ""),
          status: "PAYMENT_PENDING",
          totalCents,
          discountCents,
          expiresAt,
          salesPartnerId,
          partnerCommissionCents,
          promoterLinkId,
          promoterSellerId,
          promoterCommissionCents,
          attributionSource: salesPartnerId ? "LINK" : undefined,
          items: {
            create: reservation.items.map((item) => ({
              ticketLotId: item.ticketLotId,
              quantity: item.quantity,
              priceCents: item.priceCents,
              feeCents: item.feeCents,
              halfPrice: item.halfPrice,
            })),
          },
        },
        include: { items: true },
      });

      if (addOnSelections.length > 0) {
        await tx.orderAddOnItem.createMany({
          data: addOnSelections.map((sel) => ({
            orderId: created.id,
            addOnId: sel.addOnId,
            quantity: sel.quantity,
            priceCents: addOnById.get(sel.addOnId)!.priceCents,
          })),
        });
      }

      if (input.attendees?.length) {
        await tx.orderAttendee.createMany({
          data: input.attendees.map((a) => ({
            orderId: created.id,
            ticketLotId: a.ticketLotId,
            name: a.name,
            cpf: a.cpf?.replace(/\D/g, ""),
          })),
        });
      }

      if (input.consent) {
        // LGPD: aceite versionado e provável em auditoria
        await tx.consent.createMany({
          data: [
            { orderId: created.id, userId: effectiveUserId ?? null, document: "terms", version: input.consent.version },
            { orderId: created.id, userId: effectiveUserId ?? null, document: "privacy", version: input.consent.version },
          ],
        });
      }

      if (coupon) {
        // resgate atômico: só conta se ainda houver saldo de usos
        const redeemed = await tx.coupon.updateMany({
          where: {
            id: coupon.id,
            active: true,
            OR: [
              { maxRedemptions: null },
              { redeemedCount: { lt: coupon.maxRedemptions ?? undefined } },
            ],
          },
          data: { redeemedCount: { increment: 1 } },
        });
        if (redeemed.count === 0) {
          throw new BadRequestException("Cupom esgotado");
        }
        await tx.couponRedemption.create({
          data: { couponId: coupon.id, orderId: created.id, amountCents: discountCents },
        });
      }

      // InitiateCheckout para a Meta (2026-08-26): sai pelo outbox, junto da
      // transação, para o worker mandar server-side. É o evento que alimenta
      // remarketing de carrinho abandonado — aqui já temos e-mail e telefone,
      // então a correspondência fica alta.
      await tx.outboxEvent.create({
        data: {
          aggregateType: "order",
          aggregateId: created.id,
          eventType: "order.created",
          payload: { orderId: created.id },
        },
      });

      return created;
    });

    // a reserva virou pedido: o job de expiração da reserva não é mais necessário
    await this.expirationQueue.remove(reservation.id);

    return order;
  }

  async findByPublicToken(publicToken: string) {
    const order = await prisma.order.findUnique({
      where: { publicToken },
      include: {
        items: true,
        payments: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            method: true,
            status: true,
            amountCents: true,
            pixQrCodeText: true,
            installments: true,
            failReason: true,
            expiresAt: true,
            paidAt: true,
          },
        },
        tickets: { select: { id: true, code: true, status: true } },
        user: { select: { emailVerifiedAt: true } },
      },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado");
    // portão do 1º ingresso: sem verificar, o /status não entrega nem os ids
    // dos ingressos (eram a porta de entrada para o PNG do QR)
    const locked = Boolean(order.user && !order.user.emailVerifiedAt);
    const { user: _user, ...rest } = order;
    return { ...rest, tickets: locked ? [] : order.tickets, requiresVerification: locked };
  }

  /** Detalhe de um pedido para o painel do produtor (tela Vendas). */
  async getOrderDetailForProducer(orderId: string, actorUserId: string): Promise<any> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        event: { select: { id: true, title: true, organizationId: true } },
        items: { include: { ticketLot: { include: { ticketType: true } } } },
        // só o que a tela de Vendas usa (auditoria 2026-08-29): o Payment cru
        // trazia CPF do pagador em metadata, pixQrCodeText e ids do gateway
        payments: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true, provider: true, method: true, status: true,
            amountCents: true, createdAt: true, paidAt: true,
          },
        },
        tickets: { select: { id: true, code: true, status: true, attendeeName: true } },
      },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado");
    await this.orgAccess.assertPermission(order.event.organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);
    return order;
  }

  /**
   * PDV (venda presencial): sem checkout/reserva prévia — reserva e confirma o
   * estoque na mesma transação, cria o pedido já `PAID` e credita o ledger da
   * organização como uma venda normal. Reusa o outbox `order.paid` para que o
   * worker emita os ingressos exatamente como numa compra online (mesmo
   * caminho de cortesias, mas com valor real).
   */
  async createManualSale(eventId: string, actorUserId: string, input: PdvOrderInput) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    const membership = await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.SALES_PERFORM);

    const partnerId = membership.role.key === "seller"
      ? membership.salesPartnerId ?? undefined
      : input.salesPartnerId ?? undefined;
    if (membership.role.key === "seller" && !partnerId) {
      throw new ForbiddenException("Vendedor sem atlética/parceiro vinculado");
    }
    if (partnerId) {
      const partner = await prisma.salesPartner.findFirst({ where: { id: partnerId, organizationId: event.organizationId, active: true } });
      if (!partner) throw new ForbiddenException("Parceiro de vendas inválido para esta organização");
    }

    const lot = await prisma.ticketLot.findFirst({
      where: { id: input.ticketLotId, ticketType: { eventId } },
    });
    if (!lot) throw new BadRequestException("Lote não pertence a este evento");
    // PDV não pode vender lote em rascunho/pausado/encerrado (auditoria
    // 2026-08-12): só ACTIVE. Sem isto, uma venda presencial furava a mesma
    // regra que o checkout online já respeita.
    if (lot.status !== "ACTIVE") {
      throw new BadRequestException("Este lote não está ativo para venda");
    }

    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: event.organizationId } });
    const unitCents = lot.priceCents + lot.feeCents;
    const totalCents = unitCents * input.quantity;
    const partner = partnerId
      ? await prisma.salesPartner.findUnique({ where: { id: partnerId }, select: { commissionBps: true } })
      : null;
    const partnerCommissionCents = partner ? Math.floor((totalCents * partner.commissionBps) / 10_000) : 0;
    // venda no PDV não passa por gateway; a comissão da plataforma segue a
    // tabela do Pix (menor custo) por não haver taxa de adquirente envolvida
    const feeCents = computePlatformFeeCents("PIX", totalCents, organization);
    const buyerEmail = input.buyerEmail ?? `pdv-${Date.now()}@borafest.local`;

    const order = await prisma
      .$transaction(async (tx) => {
        await reserveInventory(tx, lot.id, input.quantity);
        await confirmSaleInventory(tx, lot.id, input.quantity);

        const reservation = await tx.reservation.create({
          data: {
            eventId,
            status: "CONVERTED",
            expiresAt: new Date(),
            items: {
              create: [{ ticketLotId: lot.id, quantity: input.quantity, priceCents: lot.priceCents, feeCents: lot.feeCents }],
            },
          },
        });

        const created = await tx.order.create({
          data: {
            eventId,
            reservationId: reservation.id,
            salesPartnerId: partnerId,
            soldByUserId: actorUserId,
            partnerCommissionCents,
            contactEmail: buyerEmail,
            contactName: input.buyerName,
            status: "PAID",
            paidAt: new Date(),
            totalCents,
            items: {
              create: [{ ticketLotId: lot.id, quantity: input.quantity, priceCents: lot.priceCents, feeCents: lot.feeCents }],
            },
          },
        });

        const ledgerAccount = await tx.ledgerAccount.upsert({
          where: { organizationId: event.organizationId },
          update: {},
          create: { organizationId: event.organizationId },
        });

        await tx.ledgerEntry.createMany({
          data: [
            {
              ledgerAccountId: ledgerAccount.id,
              type: "SALE_CREDIT",
              amountCents: totalCents,
              referenceType: "order",
              referenceId: created.id,
              // venda no PDV segue a MESMA janela do online (D+N úteis após o
              // evento) — sem isso o crédito nascia maduro e furava a regra de
              // saque (revisão adversarial 2026-08-11)
              availableAt: addBusinessDays(
                event.endsAt,
                Number(process.env.RELEASE_BUSINESS_DAYS_AFTER_EVENT ?? 2),
              ),
            },
            {
              ledgerAccountId: ledgerAccount.id,
              type: "PLATFORM_FEE",
              amountCents: -feeCents,
              referenceType: "order",
              referenceId: created.id,
              // taxa matura junto com o crédito (correção 2026-08-19)
              availableAt: addBusinessDays(
                event.endsAt,
                Number(process.env.RELEASE_BUSINESS_DAYS_AFTER_EVENT ?? 2),
              ),
            },
          ],
        });

        await tx.outboxEvent.create({
          data: {
            aggregateType: "order",
            aggregateId: created.id,
            eventType: "order.paid",
            payload: { orderId: created.id, pdv: true },
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            organizationId: event.organizationId,
            action: "order.pdv_sale",
            entityType: "order",
            entityId: created.id,
            metadata: {
              ticketLotId: lot.id,
              quantity: input.quantity,
              buyerName: input.buyerName,
              buyerDocument: input.buyerDocument,
              totalCents,
            },
          },
        });

        return created;
      })
      .catch((error) => {
        if (error instanceof InsufficientStockError) {
          throw new BadRequestException("Estoque insuficiente para esta venda");
        }
        throw error;
      });

    return { orderId: order.id, publicToken: order.publicToken };
  }

  /**
   * VENDA NA PORTA — modo Pix (2026-08-12): igual ao createManualSale, MAS o
   * pedido nasce PAYMENT_PENDING (não pago) e RESERVA o estoque sem confirmar —
   * a confirmação (sold_count + ledger + emissão + push) só acontece quando o
   * webhook do Pix aprova, pelo mesmo caminho do online. Grava `soldByUserId`
   * (a casa cobra o repasse de quem vendeu) e NÃO cria conta para o comprador
   * (userId nulo → sem portão de verificação: o ingresso já aparece ao pagar,
   * o vendedor mostra na porta). O QR do Pix é gerado pelo controller via
   * PaymentsService. Se não pagar na janela, o worker de expiração devolve o
   * estoque.
   */
  async createManualPixSale(eventId: string, actorUserId: string, input: PdvOrderInput) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    const membership = await this.orgAccess.assertPermission(
      event.organizationId,
      actorUserId,
      PERMISSIONS.SALES_PERFORM,
    );

    const partnerId =
      membership.role.key === "seller"
        ? membership.salesPartnerId ?? undefined
        : input.salesPartnerId ?? undefined;
    if (membership.role.key === "seller" && !partnerId) {
      throw new ForbiddenException("Vendedor sem atlética/parceiro vinculado");
    }
    if (partnerId) {
      const partner = await prisma.salesPartner.findFirst({
        where: { id: partnerId, organizationId: event.organizationId, active: true },
      });
      if (!partner) throw new ForbiddenException("Parceiro de vendas inválido para esta organização");
    }

    const lot = await prisma.ticketLot.findFirst({
      where: { id: input.ticketLotId, ticketType: { eventId } },
    });
    if (!lot) throw new BadRequestException("Lote não pertence a este evento");
    if (lot.status !== "ACTIVE") throw new BadRequestException("Este lote não está ativo para venda");

    const unitCents = lot.priceCents + lot.feeCents;
    const totalCents = unitCents * input.quantity;
    const partner = partnerId
      ? await prisma.salesPartner.findUnique({ where: { id: partnerId }, select: { commissionBps: true } })
      : null;
    const partnerCommissionCents = partner ? Math.floor((totalCents * partner.commissionBps) / 10_000) : 0;
    const expiresAt = new Date(Date.now() + ORDER_PAYMENT_WINDOW_MINUTES * 60 * 1000);

    const order = await prisma
      .$transaction(async (tx) => {
        // RESERVA (sem confirmar): o estoque vira sold_count só quando o Pix aprova
        await reserveInventory(tx, lot.id, input.quantity);

        const reservation = await tx.reservation.create({
          data: {
            eventId,
            status: "CONVERTED",
            expiresAt,
            items: {
              create: [{ ticketLotId: lot.id, quantity: input.quantity, priceCents: lot.priceCents, feeCents: lot.feeCents }],
            },
          },
        });

        const created = await tx.order.create({
          data: {
            eventId,
            reservationId: reservation.id,
            salesPartnerId: partnerId,
            soldByUserId: actorUserId,
            partnerCommissionCents,
            contactEmail: input.buyerEmail ?? `pdv-${Date.now()}@borafest.local`,
            contactName: input.buyerName,
            status: "PAYMENT_PENDING",
            expiresAt,
            totalCents,
            items: {
              create: [{ ticketLotId: lot.id, quantity: input.quantity, priceCents: lot.priceCents, feeCents: lot.feeCents }],
            },
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            organizationId: event.organizationId,
            action: "order.pdv_pix_sale",
            entityType: "order",
            entityId: created.id,
            metadata: { ticketLotId: lot.id, quantity: input.quantity, buyerName: input.buyerName, totalCents },
          },
        });

        return created;
      })
      .catch((error) => {
        if (error instanceof InsufficientStockError) {
          throw new BadRequestException("Estoque insuficiente para esta venda");
        }
        throw error;
      });

    return { orderId: order.id, publicToken: order.publicToken };
  }

  /**
   * Reembolso pelo painel do produtor (org-scoped, equivalente ao
   * `admin.refundOrder` mas exigindo permissão na organização em vez de
   * `platformRole=ADMIN`). Pedidos com pagamento real (Pix/cartão) disparam
   * o estorno no gateway; pedidos do PDV (sem `Payment`, pagos em dinheiro)
   * são estornados manualmente no ledger.
   */
  async refundOrder(orderId: string, actorUserId: string, input: RefundOrderInput): Promise<any> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, event: { select: { organizationId: true } } },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado");
    await this.orgAccess.assertPermission(order.event.organizationId, actorUserId, PERMISSIONS.ORDER_REFUND);

    await executarReembolso(order.id, actorUserId, input);
    // não devolver o Payment cru (auditoria 2026-08-30): traz CPF do pagador em
    // metadata, pixQrCodeText e ids do gateway. Só o resumo que a tela usa.
    return prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        payments: {
          orderBy: { createdAt: "desc" },
          select: { id: true, provider: true, method: true, status: true, amountCents: true, createdAt: true, paidAt: true },
        },
      },
    });
  }

  /**
   * Corrige o e-mail digitado errado — só enquanto a conta criada no checkout
   * ainda não foi verificada (depois disso, e-mail é identidade). A posse do
   * publicToken é a prova de que quem pede é a sessão que pagou.
   */
  async correctEmail(publicToken: string, newEmail: string) {
    const email = newEmail.trim().toLowerCase();
    if (!email.includes("@")) throw new BadRequestException("E-mail inválido");

    const order = await prisma.order.findUnique({
      where: { publicToken },
      include: {
        user: { select: { id: true, emailVerifiedAt: true, passwordHash: true } },
        event: { select: { title: true } },
      },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado");
    // conta com senha = conta de produtor real; jamais tocável por aqui
    if (order.user?.passwordHash) {
      throw new BadRequestException("Não é possível alterar o e-mail deste pedido");
    }
    // Só corrige o e-mail quando a conta NASCEU deste pedido e ainda não foi
    // verificada. Sem isso, informar o e-mail de terceiro no checkout viraria
    // sequestro de conta (incidente 2026-08-10).
    if (!order.user || !order.accountCreatedByOrder || order.user.emailVerifiedAt) {
      throw new BadRequestException(
        "Não é possível alterar o e-mail deste pedido — fale com o suporte",
      );
    }
    const ocupado = await prisma.user.findUnique({ where: { email } });
    if (ocupado) {
      throw new BadRequestException(
        "Este e-mail já tem conta BoraFest — entre com o código enviado a ele",
      );
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: order.user.id }, data: { email } }),
      prisma.order.update({ where: { id: order.id }, data: { contactEmail: email } }),
    ]);

    // reenvia o aviso com link mágico para o e-mail corrigido
    const claimToken = await createSessionToken(
      { sub: order.user.id, purpose: "email-verify", orderToken: order.publicToken },
      "7d",
    );
    const base = process.env.WEB_BASE_URL ?? "https://borafest.com.br";
    await prisma.notification.create({
      data: {
        channel: "EMAIL",
        recipient: email,
        template: "account_claim",
        payload: {
          contactName: order.contactName,
          eventTitle: order.event.title,
          claimUrl: `${base}/acesso?token=${encodeURIComponent(claimToken)}`,
        },
        orderId: order.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "order.email_corrected",
        entityType: "order",
        entityId: order.id,
        metadata: { newEmail: email },
      },
    });
    return { ok: true, contactEmail: email };
  }
}
