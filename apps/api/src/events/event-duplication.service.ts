import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PERMISSIONS } from "@borafest/auth";
import { prisma, type LotStatus, type Prisma } from "@borafest/database";
import type { DuplicateEventCadence, DuplicateEventInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";
import { semSegredoDoEvento } from "../common/event-public";

const SLUGS_RESERVADOS = new Set([
  "acesso",
  "checkout",
  "evento",
  "explorar",
  "favoritos",
  "legal",
  "minhas-compras",
  "offline",
  "pedido",
  "perfil",
  "portaria",
  "api",
  "admin",
  "painel",
  "sitemap.xml",
  "robots.txt",
  "_next",
]);

function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function gerarSlugUnico(tx: Prisma.TransactionClient, title: string): Promise<string> {
  const base = slugify(title) || "evento";
  for (let n = 0; n < 100; n += 1) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    if (SLUGS_RESERVADOS.has(candidate)) continue;
    const exists = await tx.event.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function advanceCadence(
  date: Date,
  cadence: Exclude<DuplicateEventCadence, "CUSTOM">,
  monthlyAnchorDay: number,
): Date {
  const next = new Date(date.getTime());
  if (cadence === "WEEKLY") {
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  if (cadence === "BIWEEKLY") {
    next.setUTCDate(next.getUTCDate() + 14);
    return next;
  }

  // Dia 31 não pode virar "3 de março" ao somar um mês. Mantemos o dia da
  // série quando existe e usamos o último dia do mês quando não existe.
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  next.setUTCDate(Math.min(monthlyAnchorDay, daysInUtcMonth(next.getUTCFullYear(), next.getUTCMonth())));
  return next;
}

/**
 * Uma edição antiga pode ter ficado 2–3 ciclos para trás. Para recorrência,
 * encontramos a PRIMEIRA ocorrência futura, em vez de criar a semana seguinte
 * já vencida e obrigar o produtor a fazer conta manual.
 */
function nextStartFromCadence(source: Date, cadence: DuplicateEventCadence): Date {
  if (cadence === "CUSTOM") return new Date(source.getTime());
  const monthlyAnchorDay = source.getUTCDate();
  let next = advanceCadence(source, cadence, monthlyAnchorDay);
  let guard = 0;
  while (next.getTime() <= Date.now() && guard < 520) {
    next = advanceCadence(next, cadence, monthlyAnchorDay);
    guard += 1;
  }
  return next;
}

function shifted(date: Date | null, deltaMs: number): Date | null {
  return date ? new Date(date.getTime() + deltaMs) : null;
}

/**
 * A próxima edição nunca herda um estado comercial que dependa de automação
 * inexistente ou de uma janela que já venceu.
 *
 * - ACTIVE/SOLD_OUT podem renascer ACTIVE com estoque zerado se a janela ainda
 *   é válida.
 * - SCHEDULED sempre volta DRAFT: hoje o BoraFest não possui autoativação por
 *   relógio, então manter SCHEDULED daria uma falsa sensação de operação pronta.
 * - qualquer janela deslocada cujo endsAt já passou volta DRAFT.
 * - lote promoterOnly sem promoter GLOBAL ativo volta DRAFT.
 */
function freshLotStatus(
  status: LotStatus,
  promoterOnly: boolean,
  hasGlobalPromoter: boolean,
  shiftedEndsAt: Date | null,
): LotStatus {
  if (promoterOnly && !hasGlobalPromoter) return "DRAFT";
  if (shiftedEndsAt && shiftedEndsAt.getTime() <= Date.now()) return "DRAFT";
  if (status === "ACTIVE" || status === "SOLD_OUT") return "ACTIVE";
  return "DRAFT";
}

@Injectable()
export class EventDuplicationService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  async duplicate(eventId: string, actorUserId: string, input: DuplicateEventInput) {
    return prisma.$transaction(
      async (tx) => {
        // Fonte, permissão e estado dos promoters pertencem ao MESMO snapshot.
        // Assim não misturamos um lote de antes com promoters de depois em caso
        // de edição concorrente enquanto a nova versão está sendo criada.
        const source = await tx.event.findUnique({
          where: { id: eventId },
          include: {
            ticketTypes: {
              orderBy: { position: "asc" },
              include: { lots: { orderBy: { createdAt: "asc" } } },
            },
            addOns: { orderBy: { createdAt: "asc" } },
            salesPartners: { select: { partnerId: true } },
            checkinPoints: { select: { name: true, active: true } },
          },
        });
        if (!source) throw new NotFoundException("Evento não encontrado");

        await this.orgAccess.assertPermission(
          source.organizationId,
          actorUserId,
          PERMISSIONS.EVENT_CREATE,
          tx,
        );

        // Defesa em profundidade: mesmo que alguém chame o service sem passar
        // pelo Zod do controller, datas manuais só valem para CUSTOM.
        const nextStart =
          input.cadence === "CUSTOM" && input.startsAt
            ? new Date(input.startsAt)
            : nextStartFromCadence(source.startsAt, input.cadence);
        if (!Number.isFinite(nextStart.getTime())) {
          throw new BadRequestException("Data da nova edição inválida");
        }
        if (nextStart.getTime() <= Date.now()) {
          throw new BadRequestException("A nova edição precisa começar no futuro");
        }

        const originalDurationMs = Math.max(source.endsAt.getTime() - source.startsAt.getTime(), 1);
        const nextEnd =
          input.cadence === "CUSTOM" && input.endsAt
            ? new Date(input.endsAt)
            : new Date(nextStart.getTime() + originalDurationMs);
        if (!Number.isFinite(nextEnd.getTime()) || nextEnd.getTime() <= nextStart.getTime()) {
          throw new BadRequestException("O término precisa ser depois do início");
        }

        const title = input.title?.trim() || source.title;
        const deltaMs = nextStart.getTime() - source.startsAt.getTime();
        const hasGlobalPromoter =
          (await tx.promoterLink.count({
            where: { organizationId: source.organizationId, status: "ACTIVE", eventId: null },
          })) > 0;

        const sourceLots = source.ticketTypes.flatMap((type) => type.lots);
        const promoterOnlyNeedsReview =
          input.copyTickets && !hasGlobalPromoter && sourceLots.some((lot) => lot.promoterOnly);
        const scheduledLotsNeedReview =
          input.copyTickets && sourceLots.some((lot) => lot.status === "SCHEDULED");
        const expiredShiftedWindowNeedsReview =
          input.copyTickets &&
          sourceLots.some((lot) => {
            const nextLotEnd = shifted(lot.endsAt, deltaMs);
            return nextLotEnd !== null && nextLotEnd.getTime() <= Date.now();
          });

        const warnings: string[] = [];
        if (promoterOnlyNeedsReview) {
          warnings.push(
            "Lotes exclusivos de promoter foram mantidos em rascunho: vínculos exclusivos da edição anterior não são copiados.",
          );
        }
        if (scheduledLotsNeedReview) {
          warnings.push(
            "Lotes agendados foram mantidos em rascunho para você revisar as novas janelas de venda antes de ativá-los.",
          );
        }
        if (expiredShiftedWindowNeedsReview) {
          warnings.push(
            "Algumas janelas de lote já ficaram para trás na nova data e foram mantidas em rascunho para revisão.",
          );
        }

        const slug = await gerarSlugUnico(tx, title);
        const created = await tx.event.create({
          data: {
            organizationId: source.organizationId,
            venueId: source.venueId,
            title,
            slug,
            description: source.description,
            lineup: source.lineup,
            amenities: source.amenities,
            minAge: source.minAge,
            bannerUrl: source.bannerUrl,
            category: source.category,
            startsAt: nextStart,
            endsAt: nextEnd,
            timezone: source.timezone,
            waitingRoomEnabled: source.waitingRoomEnabled,
            waitingRoomConcurrency: source.waitingRoomConcurrency,
            pixelSettings:
              input.copyMarketing && source.pixelSettings
                ? (source.pixelSettings as Prisma.InputJsonValue)
                : undefined,
            metaCapiToken: input.copyMarketing ? source.metaCapiToken : undefined,
            // status/publishedAt/canceledAt ficam nos defaults limpos: DRAFT/null/null.
          },
        });

        let copiedTicketTypes = 0;
        let copiedLots = 0;
        if (input.copyTickets) {
          for (const type of source.ticketTypes) {
            const newType = await tx.ticketType.create({
              data: {
                eventId: created.id,
                name: type.name,
                description: type.description,
                position: type.position,
              },
            });
            copiedTicketTypes += 1;

            if (type.lots.length > 0) {
              await tx.ticketLot.createMany({
                data: type.lots.map((lot) => {
                  const nextLotStart = shifted(lot.startsAt, deltaMs);
                  const nextLotEnd = shifted(lot.endsAt, deltaMs);
                  return {
                    ticketTypeId: newType.id,
                    name: lot.name,
                    priceCents: lot.priceCents,
                    feeCents: lot.feeCents,
                    capacity: lot.capacity,
                    maxPerOrder: lot.maxPerOrder,
                    feeMode: lot.feeMode,
                    nominal: lot.nominal,
                    requiresCpf: lot.requiresCpf,
                    halfPriceEnabled: lot.halfPriceEnabled,
                    pdvOnly: lot.pdvOnly,
                    promoterOnly: lot.promoterOnly,
                    status: freshLotStatus(
                      lot.status,
                      lot.promoterOnly,
                      hasGlobalPromoter,
                      nextLotEnd,
                    ),
                    startsAt: nextLotStart,
                    endsAt: nextLotEnd,
                    // soldCount/reservedCount não são enviados: defaults = 0.
                  };
                }),
              });
              copiedLots += type.lots.length;
            }
          }
        }

        if (input.copyAddOns && source.addOns.length > 0) {
          await tx.eventAddOn.createMany({
            data: source.addOns.map((item) => ({
              eventId: created.id,
              name: item.name,
              description: item.description,
              priceCents: item.priceCents,
              active: item.active,
            })),
          });
        }

        if (input.copySalesPartners && source.salesPartners.length > 0) {
          await tx.eventSalesPartner.createMany({
            data: source.salesPartners.map(({ partnerId }) => ({ eventId: created.id, partnerId })),
            skipDuplicates: true,
          });
        }

        if (input.copyCheckinPoints && source.checkinPoints.length > 0) {
          await tx.checkinPoint.createMany({
            data: source.checkinPoints.map((point) => ({
              eventId: created.id,
              name: point.name,
              active: point.active,
            })),
            skipDuplicates: true,
          });
        }

        return {
          event: semSegredoDoEvento(created),
          sourceEventId: source.id,
          cadence: input.cadence,
          copied: {
            ticketTypes: copiedTicketTypes,
            lots: copiedLots,
            addOns: input.copyAddOns ? source.addOns.length : 0,
            salesPartners: input.copySalesPartners ? source.salesPartners.length : 0,
            checkinPoints: input.copyCheckinPoints ? source.checkinPoints.length : 0,
            marketing: input.copyMarketing,
          },
          warnings,
          intentionallyNotCopied: [
            "orders",
            "tickets",
            "reservations",
            "guestListEntries",
            "checkins",
            "validatorCredentials",
            "validatorDevices",
            "reviews",
            "promoterLinks",
          ],
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
  }
}
