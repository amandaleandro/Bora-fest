import { randomBytes, randomUUID } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PERMISSIONS } from "@borafest/auth";
import { prisma } from "@borafest/database";
import type { DuplicateEventInput, NextEventEditionInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";
import { IdempotencyService } from "../common/idempotency.service";
import { SLUGS_RESERVADOS } from "../common/slugs-reservados";
import { abaixoDoMinimoOnline, emReais, minimoDaCobrancaCents } from "../common/minimo-cobranca";

function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}


async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title) || "evento";
  for (let n = 0; n < 100; n += 1) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    if (SLUGS_RESERVADOS.has(candidate)) continue;
    const exists = await prisma.event.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

function shiftDate(value: Date | null, deltaMs: number): Date | null {
  return value ? new Date(value.getTime() + deltaMs) : null;
}

/**
 * LOTE MORTO NÃO ATRAVESSA EDIÇÃO (2026-10-12): a cópia levava para a próxima
 * edição lote que o cadastro de lote hoje recusa — ninguém conseguiria
 * comprar. Mesmas regras do createLot (catalog.service):
 *  - só balcão de R$ 0: a porta não emite cortesia e o site não mostra;
 *  - pago abaixo do mínimo que o banco aceita (inteira ou meia), fora do balcão.
 * Devolve o motivo em português para a tela, ou null quando o lote vale.
 */
export function motivoParaNaoCopiarLote(lot: {
  priceCents: number;
  feeCents: number;
  feeMode: string;
  pdvOnly: boolean;
  halfPriceEnabled: boolean;
}): string | null {
  if (lot.pdvOnly && lot.priceCents === 0) {
    return "Lote só de balcão de R$ 0: a porta não emite cortesia. Para entrada grátis, use a Lista de convidados (ou uma Cortesia).";
  }
  if (lot.priceCents > 0 && !lot.pdvOnly) {
    const minimo = minimoDaCobrancaCents();
    const taxaDoComprador = lot.feeMode === "PRODUCER" ? 0 : lot.feeCents;
    const inteira = lot.priceCents + taxaDoComprador;
    if (abaixoDoMinimoOnline(inteira)) {
      return `Sairia por ${emReais(inteira)} para o comprador, abaixo do mínimo de ${emReais(minimo)} que o banco aceita.`;
    }
    // meia = metade do preço com a taxa cheia, a mesma conta da reserva
    const meia = Math.round(lot.priceCents / 2) + taxaDoComprador;
    if (lot.halfPriceEnabled && abaixoDoMinimoOnline(meia)) {
      return `A meia-entrada sairia por ${emReais(meia)}, abaixo do mínimo de ${emReais(minimo)} que o banco aceita.`;
    }
  }
  return null;
}

/** Lote que ficou de fora da nova edição, e por quê. */
export type LotePulado = { ticketTypeName: string; lotName: string; reason: string };

/**
 * VIRADA NA NOVA EDIÇÃO (2026-10-12): a cópia criava os lotes sem
 * `activateAfterLotId` — o "abrir quando o anterior esgotar" sumia e o 2º lote
 * da próxima edição ficava guardado para sempre. Aqui sai, para cada lote
 * NOVO que espera outro, o id do NOVO anterior (a fila da edição de origem,
 * com os ids da nova).
 *
 * Anterior que ficou de fora (lote morto) passa a vez para o anterior DELE —
 * a mesma regra do encerrar lote (catalog.service closeLot): pular o 2º lote
 * não deixa o 3º sem fila. Anterior que não está entre os lotes de origem, ou
 * fila que dá a volta só por lotes pulados, fica sem virada (null não entra
 * no mapa): melhor abrir à mão do que esperar um lote que não existe.
 *
 * `lotesDeOrigem` = todos os lotes do evento de origem (copiados e pulados);
 * `novoIdPorAntigo` = só os copiados.
 */
export function filaDaViradaNaCopia(
  lotesDeOrigem: ReadonlyArray<{ id: string; activateAfterLotId: string | null }>,
  novoIdPorAntigo: ReadonlyMap<string, string>,
): Map<string, string> {
  const anteriorDe = new Map(lotesDeOrigem.map((lote) => [lote.id, lote.activateAfterLotId] as const));
  const fila = new Map<string, string>();
  for (const lote of lotesDeOrigem) {
    const novoId = novoIdPorAntigo.get(lote.id);
    if (!novoId || !lote.activateAfterLotId) continue;
    const vistos = new Set<string>([lote.id]);
    let elo: string | null = lote.activateAfterLotId;
    while (elo && !vistos.has(elo)) {
      const novoAnterior = novoIdPorAntigo.get(elo);
      if (novoAnterior) {
        fila.set(novoId, novoAnterior);
        break;
      }
      if (!anteriorDe.has(elo)) break; // não é lote da edição de origem
      vistos.add(elo);
      elo = anteriorDe.get(elo) ?? null;
    }
  }
  return fila;
}

@Injectable()
export class EventRecurrenceService {
  constructor(
    private readonly orgAccess: OrgAccessService,
    // DEFAULT de propósito, como no OrdersService: testes e labs constroem este
    // serviço à mão, sem DI — a proteção fica ligada em todo lugar
    private readonly idempotency: IdempotencyService = new IdempotencyService(),
  ) {}

  /**
   * CLIQUE DUPLO (2026-10-12): cada clique em "Duplicar" criava uma edição
   * nova — dois toques, dois rascunhos com o mesmo nome. Com o cabeçalho
   * Idempotency-Key (o mesmo padrão da venda na porta), repetir a chamada com
   * a mesma chave e o mesmo corpo devolve a MESMA edição; a 2ª chamada que
   * chega enquanto a 1ª ainda copia recebe "ainda em processamento"; falha
   * libera a chave para tentar de novo. Sem cabeçalho, segue como antes.
   */
  async duplicate(
    eventId: string,
    actorUserId: string,
    input: DuplicateEventInput,
    idempotencyKey?: string,
  ) {
    return this.idempotency.run(idempotencyKey, `event-duplicate:${eventId}:${actorUserId}`, input, () =>
      this.copiarEdicao(eventId, actorUserId, input),
    );
  }

  private async copiarEdicao(eventId: string, actorUserId: string, input: DuplicateEventInput) {
    const source = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        ticketTypes: {
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          include: { lots: { orderBy: { createdAt: "asc" } } },
        },
        addOns: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!source) throw new NotFoundException("Evento não encontrado");

    await this.orgAccess.assertPermission(source.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
      throw new BadRequestException("A nova edição precisa terminar depois do início");
    }

    const title = input.title?.trim() || source.title;
    const slug = await uniqueSlug(title);
    const deltaMs = startsAt.getTime() - source.startsAt.getTime();

    // separa antes da transação o que vai e o que fica (lote morto), para a
    // resposta dizer ao produtor quais ficaram de fora e por quê
    const skippedLots: LotePulado[] = [];
    const lotesPorTipo = new Map(
      (input.copyTicketCatalog ? source.ticketTypes : []).map((type) => {
        const vivos = type.lots.filter((lot) => {
          const motivo = motivoParaNaoCopiarLote(lot);
          if (motivo) skippedLots.push({ ticketTypeName: type.name, lotName: lot.name, reason: motivo });
          return !motivo;
        });
        return [type.id, vivos] as const;
      }),
    );

    // VIRADA (2026-10-12): cada lote copiado já nasce com o id escolhido aqui,
    // para a fila "abrir quando o anterior esgotar" ser refeita com os ids novos
    const novoIdPorAntigo = new Map(
      [...lotesPorTipo.values()].flat().map((lot) => [lot.id, randomUUID()] as const),
    );
    const filaDaVirada = filaDaViradaNaCopia(
      source.ticketTypes.flatMap((type) => type.lots),
      novoIdPorAntigo,
    );

    const created = await prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
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
          status: "DRAFT",
          startsAt,
          endsAt,
          timezone: source.timezone,
          waitingRoomEnabled: source.waitingRoomEnabled,
          isPrivate: source.isPrivate,
          waitingRoomConcurrency: source.waitingRoomConcurrency,
          ...(source.pixelSettings === null ? {} : { pixelSettings: source.pixelSettings as any }),
        },
      });

      if (input.copyTicketCatalog) {
        for (const type of source.ticketTypes) {
          const newType = await tx.ticketType.create({
            data: {
              eventId: event.id,
              name: type.name,
              description: type.description,
              position: type.position,
            },
          });

          const lotesACopiar = lotesPorTipo.get(type.id) ?? [];
          if (lotesACopiar.length > 0) {
            await tx.ticketLot.createMany({
              data: lotesACopiar.map((lot) => ({
                id: novoIdPorAntigo.get(lot.id),
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
                // a nova edição herda a restrição, mas com link NOVO: o convite
                // da edição passada não abre a próxima
                inviteMode: lot.inviteMode,
                inviteToken: lot.inviteMode === "LINK" ? randomBytes(16).toString("base64url") : null,
                limitPerCpf: lot.limitPerCpf,
                status: "DRAFT" as const,
                startsAt: shiftDate(lot.startsAt, deltaMs),
                endsAt: shiftDate(lot.endsAt, deltaMs),
              })),
            });
          }
        }

        // VIRADA (2026-10-12): depois de todos os lotes criados, refaz a fila
        // com os ids novos — uma instrução por lote anterior. Tudo nasce
        // guardado (DRAFT): o produtor abre o 1º e o resto vira sozinho, como
        // na edição de origem. Na mesma transação: ou a edição sai com a fila
        // inteira, ou não sai.
        const esperamPor = new Map<string, string[]>();
        for (const [novoId, novoAnterior] of filaDaVirada) {
          esperamPor.set(novoAnterior, [...(esperamPor.get(novoAnterior) ?? []), novoId]);
        }
        for (const [novoAnterior, ids] of esperamPor) {
          const ligados = await tx.ticketLot.updateMany({
            where: { id: { in: ids }, ticketType: { eventId: event.id } },
            data: { activateAfterLotId: novoAnterior },
          });
          if (ligados.count !== ids.length) {
            throw new Error(
              `virada da nova edição: ${ligados.count} de ${ids.length} lotes ligados ao anterior ${novoAnterior}`,
            );
          }
        }
      }

      if (source.addOns.length > 0) {
        await tx.eventAddOn.createMany({
          data: source.addOns.map((addOn) => ({
            eventId: event.id,
            name: addOn.name,
            description: addOn.description,
            priceCents: addOn.priceCents,
            active: addOn.active,
          })),
        });
      }

      // rastro (2026-10-12): "quem criou esta edição, a partir de qual?" — na
      // mesma transação da cópia (sai a edição e o registro, ou nenhum)
      await tx.auditLog.create({
        data: {
          actorUserId,
          organizationId: source.organizationId,
          action: "event.duplicate",
          entityType: "event",
          entityId: event.id,
          metadata: {
            copiedFromEventId: source.id,
            title,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            copyTicketCatalog: Boolean(input.copyTicketCatalog),
            copiedLots: novoIdPorAntigo.size,
            lotesComVirada: filaDaVirada.size,
            skippedLots: skippedLots.map((s) => `${s.ticketTypeName} · ${s.lotName}`),
          },
        },
      });

      return event;
    });

    return {
      ...created,
      copiedFromEventId: source.id,
      copiedTicketTypes: input.copyTicketCatalog ? source.ticketTypes.length : 0,
      // só os lotes que de fato foram copiados (2026-10-12): os mortos vão em skippedLots
      copiedLots: [...lotesPorTipo.values()].reduce((sum, lotes) => sum + lotes.length, 0),
      copiedAddOns: source.addOns.length,
      skippedLots,
    };
  }

  /** Próxima edição — mesma proteção contra clique duplo do duplicate(). */
  async nextEdition(
    eventId: string,
    actorUserId: string,
    input: NextEventEditionInput,
    idempotencyKey?: string,
  ) {
    return this.idempotency.run(idempotencyKey, `event-next-edition:${eventId}:${actorUserId}`, input, () =>
      this.criarProximaEdicao(eventId, actorUserId, input),
    );
  }

  private async criarProximaEdicao(eventId: string, actorUserId: string, input: NextEventEditionInput) {
    const source = await prisma.event.findUnique({
      where: { id: eventId },
      select: { startsAt: true, endsAt: true },
    });
    if (!source) throw new NotFoundException("Evento não encontrado");

    const cadenceMs = input.cadenceDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let nextStartMs = source.startsAt.getTime() + cadenceMs;
    let nextEndMs = source.endsAt.getTime() + cadenceMs;

    while (nextStartMs <= now) {
      nextStartMs += cadenceMs;
      nextEndMs += cadenceMs;
    }

    // direto na cópia: a chave desta chamada já está guardando a operação inteira
    return this.copiarEdicao(eventId, actorUserId, {
      title: input.title,
      copyTicketCatalog: input.copyTicketCatalog,
      startsAt: new Date(nextStartMs).toISOString(),
      endsAt: new Date(nextEndMs).toISOString(),
    });
  }
}
