import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma, Prisma, type ValidatorDevice } from "@borafest/database";
import { verifyTicketToken, InvalidTicketTokenError } from "@borafest/tickets";
import { PERMISSIONS } from "@borafest/auth";
import type { CreateCheckinInput, SyncCheckinsInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";
import { withContext } from "@borafest/observability";
import { origemGratis } from "../common/origem-gratis";

const log = withContext({ module: "checkins" });

export type CheckinOutcome = "VALID" | "ALREADY_USED" | "INVALID" | "CANCELED";

@Injectable()
export class CheckinsService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  /**
   * Check-in online (§10/§12): a transição do ingresso é atômica
   * (`updateMany` com guarda de status) — sob concorrência de vários portões,
   * exatamente um aparelho recebe VALID; os demais, ALREADY_USED.
   */
  /**
   * LIBERADO SEM CONFERIR O CPF — o rastro da válvula de escape (2026-09-15).
   *
   * A tela oferece "liberar mesmo assim" porque CPF que não bate pode ser
   * digitação errada no cadastro ou documento esquecido em casa: trancar a porta
   * de quem tem convite de verdade é pior. Mas a saída não pode ser invisível.
   *
   * Mora aqui, num lugar só, porque a portaria entra pelos DOIS caminhos —
   * online (`create`) e fila offline (`sync`). A primeira versão registrava só
   * no online, ou seja, a garantia existia justamente onde ela menos importa: a
   * portaria foi desenhada para rodar offline, então o uso mais provável da
   * válvula era o que não deixava rastro nenhum.
   */
  private async auditarSemConferirCpf(args: {
    ticket: { id: string; code: string; attendeeName: string | null };
    device: ValidatorDevice;
    checkinId: string | null;
    origem: "ONLINE" | "OFFLINE_SYNC";
    scannedAt: Date;
  }) {
    await prisma.auditLog
      .create({
        data: {
          action: "checkin.sem_conferir_cpf",
          entityType: "ticket",
          entityId: args.ticket.id,
          metadata: {
            ticketCode: args.ticket.code,
            attendeeName: args.ticket.attendeeName,
            deviceId: args.device.id,
            deviceName: args.device.name,
            checkinId: args.checkinId,
            origem: args.origem,
            // no offline a hora do servidor não é a hora da porta, e é a da
            // porta que o produtor vai querer cruzar no dia seguinte
            scannedAt: args.scannedAt.toISOString(),
          },
        },
      })
      .catch(() => undefined); // auditoria nunca derruba a entrada de ninguém
  }

  async create(device: ValidatorDevice, input: CreateCheckinInput) {
    const resolved = await this.resolveTicketWithReason(device.eventId, input);
    if (!resolved.ticket) {
      // motivo específico para a portaria saber o que dizer ao portador (handoff v2)
      return { result: "INVALID" as CheckinOutcome, reason: resolved.reason };
    }
    const ticket = resolved.ticket;

    if (input.checkinPointId) {
      await this.assertCheckinPoint(device.eventId, input.checkinPointId);
    }

    const outcome = await this.attemptCheckin(
      ticket.id,
      device,
      input.checkinPointId,
      input.scannedAt ?? new Date(),
      "ONLINE",
      null,
    );

    if (input.semConferirCpf && outcome.result === "VALID") {
      await this.auditarSemConferirCpf({
        ticket,
        device,
        checkinId: outcome.checkinId ?? null,
        origem: "ONLINE",
        scannedAt: input.scannedAt ?? new Date(),
      });
    }

    return {
      result: outcome.result,
      ticket: {
        id: ticket.id,
        code: ticket.code,
        status: outcome.ticketStatus,
        attendeeName: ticket.attendeeName,
        lotName: ticket.ticketLot.name,
        typeName: ticket.ticketLot.ticketType.name,
        // etiqueta do portão: staff sabe que a entrada é grátis. A REGRA mora
        // em common/origem-gratis.ts — antes estava copiada aqui e na carteira,
        // e as duas metades já tinham começado a divergir.
        tipo: ticket.order ? (origemGratis(ticket.order)?.kind ?? null) : null,
      },
      checkinId: outcome.checkinId,
      firstCheckin: outcome.firstCheckin,
    };
  }

  /**
   * Sincronização de lote offline (§12): idempotente por (device, batchKey) —
   * reenviar o mesmo lote devolve o MESMO resultado sem duplicar efeito.
   * O servidor aceita o primeiro check-in de cada ingresso e marca os demais
   * como CONFLICT (trilha de auditoria).
   */
  async sync(device: ValidatorDevice, input: SyncCheckinsInput) {
    const existing = await prisma.checkinSyncBatch.findUnique({
      where: { deviceId_batchKey: { deviceId: device.id, batchKey: input.batchKey } },
    });
    if (existing) {
      return existing.result as object;
    }

    const items: Array<{
      localSeq: number;
      ticketId: string;
      status: "CONFIRMED" | "CONFLICT" | "INVALID";
      checkinId?: string;
    }> = [];
    let conflictCount = 0;

    for (const item of input.items) {
      const ticket = await prisma.ticket.findFirst({
        where: { id: item.ticketId, eventId: device.eventId },
        // code/attendeeName entram por causa da auditoria do "sem conferir CPF":
        // sem eles o registro offline nasceria sem código nem nome, pior que o
        // online e inútil para o produtor cruzar depois
        select: { id: true, code: true, attendeeName: true },
      });
      if (!ticket) {
        items.push({ localSeq: item.localSeq, ticketId: item.ticketId, status: "INVALID" });
        continue;
      }

      try {
        const outcome = await this.attemptCheckin(
          item.ticketId,
          device,
          item.checkinPointId,
          item.scannedAt,
          "OFFLINE_SYNC",
          item.localSeq,
        );
        const status = outcome.result === "VALID" ? "CONFIRMED" : "CONFLICT";
        if (status === "CONFLICT") conflictCount++;
        // mesmo rastro do caminho online. NÃO auditamos no ramo de recuperação
        // P2002 abaixo: aquele item já foi aplicado por um sync anterior, que já
        // registrou — auditar de novo duplicaria a mesma entrada.
        if (item.semConferirCpf && status === "CONFIRMED") {
          await this.auditarSemConferirCpf({
            ticket,
            device,
            checkinId: outcome.checkinId ?? null,
            origem: "OFFLINE_SYNC",
            scannedAt: item.scannedAt,
          });
        }
        items.push({
          localSeq: item.localSeq,
          ticketId: item.ticketId,
          status,
          checkinId: outcome.checkinId,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          // (deviceId, localSeq) já aplicado por sync anterior interrompido
          const applied = await prisma.checkin.findUnique({
            where: { deviceId_localSeq: { deviceId: device.id, localSeq: item.localSeq } },
            select: { id: true, status: true },
          });
          items.push({
            localSeq: item.localSeq,
            ticketId: item.ticketId,
            status: applied?.status === "CONFIRMED" ? "CONFIRMED" : "CONFLICT",
            checkinId: applied?.id,
          });
          continue;
        }
        throw error;
      }
    }

    const result = {
      batchKey: input.batchKey,
      received: input.items.length,
      confirmed: items.filter((i) => i.status === "CONFIRMED").length,
      conflicts: conflictCount,
      invalid: items.filter((i) => i.status === "INVALID").length,
      items,
    };

    try {
      await prisma.checkinSyncBatch.create({
        data: {
          deviceId: device.id,
          batchKey: input.batchKey,
          itemCount: input.items.length,
          conflictCount,
          result: result as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await prisma.checkinSyncBatch.findUniqueOrThrow({
          where: { deviceId_batchKey: { deviceId: device.id, batchKey: input.batchKey } },
        });
        return raced.result as object;
      }
      throw error;
    }

    await prisma.validatorDevice.update({
      where: { id: device.id },
      data: { lastSyncAt: new Date() },
    });

    log.info(
      { deviceId: device.id, ...result, items: undefined },
      "lote de check-ins sincronizado",
    );
    return result;
  }

  /** Reversão com permissão e auditoria (§12). */
  async reverse(userId: string, checkinId: string) {
    const checkin = await prisma.checkin.findUnique({
      where: { id: checkinId },
      include: { ticket: { include: { event: { select: { organizationId: true } } } } },
    });
    if (!checkin) throw new NotFoundException("Check-in não encontrado");

    await this.orgAccess.assertPermission(
      checkin.ticket.event.organizationId,
      userId,
      PERMISSIONS.CHECKIN_PERFORM,
    );

    if (checkin.status !== "CONFIRMED") {
      throw new BadRequestException("Só check-ins confirmados podem ser revertidos");
    }

    await prisma.$transaction(async (tx) => {
      const reversed = await tx.checkin.updateMany({
        where: { id: checkinId, status: "CONFIRMED" },
        data: { status: "REVERSED", reversedAt: new Date(), reversedBy: userId },
      });
      if (reversed.count === 0) {
        throw new BadRequestException("Check-in já revertido");
      }
      await tx.ticket.updateMany({
        where: { id: checkin.ticketId, status: "CHECKED_IN" },
        data: { status: "ACTIVE", checkedInAt: null },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          organizationId: checkin.ticket.event.organizationId,
          action: "checkin.reverse",
          entityType: "checkin",
          entityId: checkinId,
          metadata: { ticketId: checkin.ticketId, eventId: checkin.eventId },
        },
      });
    });

    return { reversed: true };
  }

  /**
   * Reversão PELO APARELHO da portaria (protótipo: Resumo → Reverter).
   * Só check-ins do próprio evento do dispositivo; auditada com o deviceId.
   */
  async reverseFromDevice(
    device: ValidatorDevice & { credential?: { id: string; label: string } },
    checkinId: string,
  ) {
    const checkin = await prisma.checkin.findFirst({
      where: { id: checkinId, eventId: device.eventId },
      include: { ticket: { include: { event: { select: { organizationId: true } } } } },
    });
    if (!checkin) throw new NotFoundException("Check-in não encontrado neste evento");
    if (checkin.status !== "CONFIRMED") {
      throw new BadRequestException("Só check-ins confirmados podem ser revertidos");
    }
    // TRANCA (auditoria 2026-09-12, bloqueio nº 5): qualquer aparelho da portaria
    // desfazia QUALQUER check-in do evento, sem limite de tempo, e o mesmo QR
    // voltava a entrar verde em outro portão — fraude invisível no dinheiro.
    // Agora: só o aparelho que fez o check-in, só dentro de 10 minutos (o
    // tempo de um "errei de pessoa"), e o auditLog diz QUEM (credencial).
    if (checkin.deviceId !== device.id) {
      throw new ForbiddenException("Este check-in foi feito em outro aparelho — só ele pode reverter");
    }
    // OS DOIS RELÓGIOS (2026-09-15). Só `receivedAt` reabria a janela inteira
    // no instante do sync: 4h offline, 150 check-ins, e ao voltar a rede todos
    // ficavam reversíveis por 10 min — o QR de quem entrou às 22h voltava a
    // valer às 02h. Só `scannedAt` seria pior: é carimbado pelo aparelho, sem
    // teto, e um valor no futuro tornaria a reversão ilimitada. Os dois juntos.
    const JANELA_MS = 10 * 60 * 1000;
    const agora = Date.now();
    const naPorta = agora - checkin.scannedAt.getTime();
    const noServidor = agora - checkin.receivedAt.getTime();
    if (naPorta > JANELA_MS || noServidor > JANELA_MS) {
      throw new BadRequestException("Passaram mais de 10 minutos — reversão só pelo painel do produtor");
    }

    await prisma.$transaction(async (tx) => {
      const reversed = await tx.checkin.updateMany({
        where: { id: checkinId, status: "CONFIRMED" },
        data: { status: "REVERSED", reversedAt: new Date() },
      });
      if (reversed.count === 0) throw new BadRequestException("Check-in já revertido");
      await tx.ticket.updateMany({
        where: { id: checkin.ticketId, status: "CHECKED_IN" },
        data: { status: "ACTIVE", checkedInAt: null },
      });
      await tx.auditLog.create({
        data: {
          organizationId: checkin.ticket.event.organizationId,
          action: "checkin.reverse.device",
          entityType: "checkin",
          entityId: checkinId,
          metadata: {
            deviceId: device.id,
            deviceName: device.name,
            eventId: device.eventId,
            credentialId: device.credentialId,
            credentialLabel: device.credential?.label ?? null,
          },
        },
      });
    });

    return { reversed: true };
  }

  /** Painel ao vivo do produtor (§13): totais e ritmo de entrada. */
  async live(userId: string, eventId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    // painel ao vivo é acompanhamento: quem opera a portaria E quem gere o
    // evento (dono/admin) veem — auditoria 2026-08-10: admin tomava 403
    try {
      await this.orgAccess.assertPermission(
        event.organizationId,
        userId,
        PERMISSIONS.CHECKIN_PERFORM,
      );
    } catch {
      await this.orgAccess.assertPermission(
        event.organizationId,
        userId,
        PERMISSIONS.EVENT_CREATE,
      );
    }

    const oneMinuteAgo = new Date(Date.now() - 60_000);
    const [totalValid, checkedIn, lastMinute, byPoint, curve] = await Promise.all([
      prisma.ticket.count({
        where: { eventId, status: { in: ["ISSUED", "ACTIVE", "CHECKED_IN"] } },
      }),
      prisma.ticket.count({ where: { eventId, status: "CHECKED_IN" } }),
      prisma.checkin.count({
        where: { eventId, status: "CONFIRMED", receivedAt: { gt: oneMinuteAgo } },
      }),
      prisma.checkin.groupBy({
        by: ["checkinPointId"],
        where: { eventId, status: "CONFIRMED" },
        _count: { _all: true },
      }),
      this.checkinCurve(eventId),
    ]);

    return {
      eventId,
      totalTickets: totalValid,
      checkedIn,
      remaining: Math.max(totalValid - checkedIn, 0),
      perMinute: lastMinute,
      byCheckinPoint: byPoint.map((p) => ({
        checkinPointId: p.checkinPointId,
        count: p._count._all,
      })),
      curve,
      generatedAt: new Date(),
    };
  }

  private readonly CURVE_BUCKET_MS = 5 * 60 * 1000;

  /**
   * Curva de entrada em buckets de 5 min, por portão — traz o histórico
   * completo do evento (volume esperado é de milhares de check-ins, não
   * milhões; bucketing em memória evita SQL específico de banco).
   */
  private async checkinCurve(eventId: string) {
    const checkins = await prisma.checkin.findMany({
      where: { eventId, status: "CONFIRMED" },
      select: { receivedAt: true, checkinPointId: true },
    });

    const buckets = new Map<number, Map<string, number>>();
    for (const c of checkins) {
      const bucketStart = Math.floor(c.receivedAt.getTime() / this.CURVE_BUCKET_MS) * this.CURVE_BUCKET_MS;
      const gateKey = c.checkinPointId ?? "SEM_PORTAO";
      const byGate = buckets.get(bucketStart) ?? new Map<string, number>();
      byGate.set(gateKey, (byGate.get(gateKey) ?? 0) + 1);
      buckets.set(bucketStart, byGate);
    }

    return [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([bucketStart, byGate]) => ({
        bucketStart: new Date(bucketStart),
        byCheckinPoint: [...byGate.entries()].map(([checkinPointId, count]) => ({
          checkinPointId: checkinPointId === "SEM_PORTAO" ? null : checkinPointId,
          count,
        })),
        total: [...byGate.values()].reduce((sum, n) => sum + n, 0),
      }));
  }

  // -------------------------------------------------------------------------

  /**
   * Núcleo da concorrência: só marca CHECKED_IN se o ingresso ainda está
   * ISSUED/ACTIVE — quem chegar primeiro vence; o Checkin registra o resto.
   */
  private async attemptCheckin(
    ticketId: string,
    device: ValidatorDevice,
    checkinPointId: string | undefined,
    scannedAt: Date,
    source: "ONLINE" | "OFFLINE_SYNC",
    localSeq: number | null,
  ): Promise<{
    result: CheckinOutcome;
    ticketStatus: string;
    checkinId?: string;
    firstCheckin?: { at: Date | null; deviceName?: string };
  }> {
    return prisma.$transaction(async (tx) => {
      const won = await tx.ticket.updateMany({
        where: {
          id: ticketId,
          eventId: device.eventId,
          status: { in: ["ISSUED", "ACTIVE"] },
        },
        data: { status: "CHECKED_IN", checkedInAt: scannedAt },
      });

      if (won.count > 0) {
        const checkin = await tx.checkin.create({
          data: {
            ticketId,
            eventId: device.eventId,
            deviceId: device.id,
            checkinPointId,
            source,
            status: "CONFIRMED",
            localSeq,
            scannedAt,
          },
        });
        return { result: "VALID" as CheckinOutcome, ticketStatus: "CHECKED_IN", checkinId: checkin.id };
      }

      // não venceu: classifica e registra conflito p/ auditoria
      const ticket = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId } });
      const result: CheckinOutcome =
        ticket.status === "CHECKED_IN"
          ? "ALREADY_USED"
          : ticket.status === "CANCELED" || ticket.status === "REFUNDED"
            ? "CANCELED"
            : "INVALID";

      const conflict = await tx.checkin.create({
        data: {
          ticketId,
          eventId: device.eventId,
          deviceId: device.id,
          checkinPointId,
          source,
          status: "CONFLICT",
          localSeq,
          scannedAt,
        },
      });

      let firstCheckin;
      if (result === "ALREADY_USED") {
        const first = await tx.checkin.findFirst({
          where: { ticketId, status: "CONFIRMED" },
          orderBy: { receivedAt: "asc" },
          include: { device: { select: { name: true } }, checkinPoint: { select: { name: true } } },
        });
        firstCheckin = {
          at: first?.scannedAt ?? ticket.checkedInAt,
          deviceName: first?.device.name,
          gateName: first?.checkinPoint?.name ?? null,
        };
      }

      return { result, ticketStatus: ticket.status, checkinId: conflict.id, firstCheckin };
    });
  }

  private async resolveTicketWithReason(eventId: string, input: CreateCheckinInput) {
    let ticketId: string | undefined;

    if (input.qrToken) {
      const signingKey = await prisma.eventSigningKey.findUnique({
        where: { eventId },
        select: { publicKeyPem: true },
      });
      if (!signingKey) return { ticket: null, reason: "EVENT_WITHOUT_KEY" as const };
      try {
        const payload = verifyTicketToken(input.qrToken, signingKey.publicKeyPem);
        if (payload.eid !== eventId) return { ticket: null, reason: "OTHER_EVENT" as const };
        ticketId = payload.tid;
      } catch (error) {
        if (error instanceof InvalidTicketTokenError) {
          return { ticket: null, reason: "BAD_SIGNATURE" as const };
        }
        throw error;
      }
    }

    const found = await this.findTicket(eventId, ticketId, input.code);
    if (!found) return { ticket: null, reason: "NOT_FOUND" as const };

    // Transferência/reemissão reassina o mesmo ticketId com nonce novo. A
    // assinatura antiga continua matematicamente válida, então é obrigatório
    // comparar com o token ATUAL salvo no ingresso.
    if (input.qrToken && found.qrToken !== input.qrToken) {
      return { ticket: null, reason: "REVOKED_QR" as const };
    }

    return { ticket: found, reason: null };
  }

  private async findTicket(eventId: string, ticketId?: string, code?: string) {
    return prisma.ticket.findFirst({
      where: {
        eventId,
        ...(ticketId ? { id: ticketId } : { code: (code ?? "").toUpperCase() }),
      },
      include: {
        ticketLot: { select: { name: true, ticketType: { select: { name: true } } } },
        order: {
          select: { totalCents: true, soldByUserId: true, salesPartnerId: true, promoterLinkId: true, guestListEntries: { select: { id: true }, take: 1 } },
        },
      },
    });
  }

  private async assertCheckinPoint(eventId: string, checkinPointId: string) {
    const point = await prisma.checkinPoint.findFirst({
      where: { id: checkinPointId, eventId, active: true },
      select: { id: true },
    });
    if (!point) throw new ForbiddenException("Portão inválido para este evento");
  }
}
