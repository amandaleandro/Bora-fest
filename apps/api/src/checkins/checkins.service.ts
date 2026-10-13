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
import { ehGratuito, ehMeia } from "./etiquetas-porta";
import { ehOQrAtual } from "./qr-atual";

const log = withContext({ module: "checkins" });

export type CheckinOutcome = "VALID" | "ALREADY_USED" | "INVALID" | "CANCELED";

/**
 * Pedidos em que o ingresso ainda vale. Desfazer a entrada devolve o QR à vida,
 * então só acontece com o pedido num destes estados (ver `desfazerEntrada`).
 * Reembolso parcial mantém os ingressos válidos — por isso entra na lista.
 */
const PEDIDO_VALENDO = new Set(["PAID", "FULFILLED", "PARTIALLY_REFUNDED"]);

/** Quantas entradas a lista do painel devolve de uma vez (o resto, pela busca). */
const ENTRADAS_POR_PAGINA = 50;

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

  /**
   * QR ANTIGO APRESENTADO NA PORTA (2026-10-12) — o rastro da tentativa.
   *
   * Quem mostra o QR de antes da transferência é, quase sempre, quem passou o
   * ingresso adiante e guardou um print. A recusa sozinha some da tela no
   * próximo scan; o registro fica para o produtor responder ao novo dono ("tentaram
   * entrar com o meu ingresso?") com hora e aparelho. Só o caminho online
   * registra: offline o aparelho recusa sozinho e a fila não carrega recusas.
   */
  private async auditarQrAntigo(args: {
    ticket: { id: string; code: string; eventId: string };
    device: ValidatorDevice;
    scannedAt: Date;
  }) {
    try {
      const evento = await prisma.event.findUnique({
        where: { id: args.ticket.eventId },
        select: { organizationId: true },
      });
      await prisma.auditLog.create({
        data: {
          organizationId: evento?.organizationId ?? null,
          action: "checkin.qr_antigo",
          entityType: "ticket",
          entityId: args.ticket.id,
          metadata: {
            ticketCode: args.ticket.code,
            deviceId: args.device.id,
            deviceName: args.device.name,
            eventId: args.device.eventId,
            scannedAt: args.scannedAt.toISOString(),
          },
        },
      });
    } catch {
      // auditoria nunca muda a resposta da porta: a recusa já está decidida
    }
  }

  async create(device: ValidatorDevice, input: CreateCheckinInput) {
    const resolved = await this.resolveTicketWithReason(device.eventId, input);
    if (!resolved.ticket) {
      if (resolved.reason === "OLD_QR" && resolved.qrAntigoDe) {
        await this.auditarQrAntigo({
          ticket: resolved.qrAntigoDe,
          device,
          scannedAt: input.scannedAt ?? new Date(),
        });
      }
      // motivo específico para a portaria saber o que dizer ao portador (handoff v2).
      // QR antigo não devolve o ingresso: o nome do novo dono não vai para a
      // tela de quem apresentou o QR de antes
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
      // leitura por QR: o update só pega se o ingresso ainda tiver ESTE QR
      input.qrToken ? ticket.qrToken : undefined,
    );

    if (outcome.qrTrocado) {
      // transferência gravou um QR novo entre a conferência e a entrada
      await this.auditarQrAntigo({ ticket, device, scannedAt: input.scannedAt ?? new Date() });
      return { result: "INVALID" as CheckinOutcome, reason: "OLD_QR" as const };
    }

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
        // etiquetas da porta (2026-10-12), mesma regra do manifesto offline
        // (etiquetas-porta.ts): MEIA-ENTRADA pede o documento; GRATUITO é o R$ 0
        // que não é lista nem cortesia (lote grátis, cupom de 100%)
        meia: ehMeia(ticket.orderItem),
        gratuito: ehGratuito(ticket.order),
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

  /** Recusa o que não é uma entrada valendo, com o motivo em português claro. */
  private assertDesfazivel(status: string) {
    if (status === "REVERSED") throw new BadRequestException("Esta entrada já foi desfeita");
    if (status !== "CONFIRMED") {
      // CONFLICT: a leitura foi recusada na porta (já usado, cancelado...) —
      // não existe entrada a desfazer
      throw new BadRequestException("Esta leitura foi recusada na porta — não há entrada para desfazer");
    }
  }

  /**
   * NÚCLEO DO "DESFAZER ENTRADA" — o mesmo para o painel e para o aparelho.
   * Roda dentro da transação de quem chama (que grava o auditLog junto).
   *
   * PEDIDO MORTO NÃO RESSUSCITA (2026-10-12). Reembolso e cancelamento de grátis
   * deixam CHECKED_IN o ingresso de quem já entrou ("quem está dentro fica" —
   * refund-order.ts e cancelar-pedido-gratis.ts). Desfazer a entrada devolvia
   * esse ingresso para ACTIVE: o QR de um pedido REEMBOLSADO voltava a passar
   * na porta. Agora o pedido precisa estar valendo.
   *
   * O pedido é TRAVADO (FOR UPDATE) antes de tudo: um reembolso que chegue no
   * mesmo instante espera esta transação terminar e então cancela o ingresso,
   * que já está ACTIVE — ou chega antes, e aqui a recusa vem com o estado novo.
   * A trava também enfileira o clique duplo: o segundo encontra a entrada já
   * desfeita e recebe "Esta entrada já foi desfeita".
   */
  private async desfazerEntrada(
    tx: Prisma.TransactionClient,
    checkin: { id: string; ticketId: string },
    reversedBy: string | null,
  ): Promise<{ ingressoVoltouAValer: boolean }> {
    const ticket = await tx.ticket.findUniqueOrThrow({
      where: { id: checkin.ticketId },
      select: { orderId: true },
    });
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM orders WHERE id = ${ticket.orderId}::uuid FOR UPDATE
    `;
    const pedido = await tx.order.findUniqueOrThrow({
      where: { id: ticket.orderId },
      select: { status: true },
    });
    if (!PEDIDO_VALENDO.has(pedido.status)) {
      throw new BadRequestException(
        "O pedido deste ingresso foi cancelado ou reembolsado depois da entrada. Desfazer faria o QR voltar a valer — a entrada continua registrada.",
      );
    }

    const reversed = await tx.checkin.updateMany({
      where: { id: checkin.id, status: "CONFIRMED" },
      data: { status: "REVERSED", reversedAt: new Date(), ...(reversedBy ? { reversedBy } : {}) },
    });
    if (reversed.count === 0) throw new BadRequestException("Esta entrada já foi desfeita");

    // guarda de status: ingresso que não está mais CHECKED_IN (cancelado, por
    // exemplo) NÃO volta a valer — só a entrada sai do registro
    const voltou = await tx.ticket.updateMany({
      where: { id: checkin.ticketId, status: "CHECKED_IN" },
      data: { status: "ACTIVE", checkedInAt: null },
    });
    return { ingressoVoltouAValer: voltou.count > 0 };
  }

  /**
   * DESFAZER ENTRADA PELO PAINEL DO PRODUTOR (2026-10-12) — "entrada registrada
   * por engano". O aparelho só desfaz o que ele mesmo registrou, nos últimos 10
   * minutos (`reverseFromDevice`). Passado isso, ou de outro aparelho, quem
   * desfaz é o produtor, por aqui, sem janela de tempo.
   *
   * PERMISSÃO: dono/admin do evento (EVENT_CREATE — a mesma da configuração da
   * portaria). Antes bastava CHECKIN_PERFORM, que operador e vendedor da porta
   * também têm: a pessoa da porta que não pode desfazer a entrada de outro
   * aparelho (tranca de 2026-09-12) fazia isso pela conta, sem limite, e o QR
   * voltava a valer para um segundo portador. Nenhuma tela chamava esta rota
   * até o botão do painel — nada que funcionava deixou de funcionar.
   */
  async reverse(userId: string, checkinId: string) {
    const checkin = await prisma.checkin.findUnique({
      where: { id: checkinId },
      include: {
        ticket: {
          select: {
            code: true,
            attendeeName: true,
            event: { select: { organizationId: true } },
          },
        },
        device: { select: { name: true } },
        checkinPoint: { select: { name: true } },
      },
    });
    if (!checkin) throw new NotFoundException("Entrada não encontrada");

    const organizationId = checkin.ticket.event.organizationId;
    await this.orgAccess.assertPermission(organizationId, userId, PERMISSIONS.EVENT_CREATE);
    this.assertDesfazivel(checkin.status);

    const { ingressoVoltouAValer } = await prisma.$transaction(async (tx) => {
      const desfeito = await this.desfazerEntrada(tx, checkin, userId);
      // rastro (padrão das ações do produtor): quem desfez, de quem era a
      // entrada, onde e quando ela foi registrada — numa disputa ("como esse
      // QR entrou duas vezes?") é o que prova o que aconteceu
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          organizationId,
          action: "checkin.reverse",
          entityType: "checkin",
          entityId: checkinId,
          metadata: {
            ticketId: checkin.ticketId,
            eventId: checkin.eventId,
            ticketCode: checkin.ticket.code,
            attendeeName: checkin.ticket.attendeeName,
            deviceId: checkin.deviceId,
            deviceName: checkin.device.name,
            gateName: checkin.checkinPoint?.name ?? null,
            source: checkin.source,
            scannedAt: checkin.scannedAt.toISOString(),
            ingressoVoltouAValer: desfeito.ingressoVoltouAValer,
          },
        },
      });
      return desfeito;
    });

    // `reversed` mantém o formato de antes; `ticketActive` diz à tela se o
    // ingresso voltou mesmo a valer (não volta se já estava cancelado)
    return { reversed: true, ticketActive: ingressoVoltouAValer };
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
    if (!checkin) throw new NotFoundException("Entrada não encontrada neste evento");
    this.assertDesfazivel(checkin.status);
    // TRANCA (auditoria 2026-09-12, bloqueio nº 5): qualquer aparelho da portaria
    // desfazia QUALQUER check-in do evento, sem limite de tempo, e o mesmo QR
    // voltava a entrar verde em outro portão — fraude invisível no dinheiro.
    // Agora: só o aparelho que fez o check-in, só dentro de 10 minutos (o
    // tempo de um "errei de pessoa"), e o auditLog diz QUEM (credencial).
    // Fora disso o caminho existe e a mensagem diz qual é: o painel do produtor.
    if (checkin.deviceId !== device.id) {
      throw new ForbiddenException(
        "Esta entrada foi registrada em outro aparelho — só ele pode desfazer, ou o produtor pelo painel (aba Check-in)",
      );
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
      throw new BadRequestException(
        "Passaram mais de 10 minutos — agora só o produtor desfaz, pelo painel (aba Check-in)",
      );
    }

    await prisma.$transaction(async (tx) => {
      // mesmo núcleo do painel: trava o pedido e não ressuscita QR de pedido
      // reembolsado/cancelado (2026-10-12)
      await this.desfazerEntrada(tx, checkin, null);
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

  /**
   * ENTRADAS PARA O PRODUTOR DESFAZER (2026-10-12) — a lista do botão "Desfazer
   * entrada" do painel. Diferente da lista do aparelho (só as dele, só os
   * últimos 10 minutos): aqui é o evento inteiro, sem janela, e com busca por
   * nome ou código — numa festa de 2 mil pessoas a entrada errada de uma hora
   * atrás não está entre as 50 mais recentes. Mesma permissão do desfazer.
   *
   * ERRO NÃO VIRA LISTA VAZIA: sem permissão é 403 e evento inexistente é 404;
   * a tela mostra o erro, nunca "nenhuma entrada".
   */
  async recentEntries(userId: string, eventId: string, busca?: string) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, organizationId: true },
    });
    if (!event) throw new NotFoundException("Evento não encontrado");
    await this.orgAccess.assertPermission(event.organizationId, userId, PERMISSIONS.EVENT_CREATE);

    const termo = (busca ?? "").trim().slice(0, 80);
    // código é guardado em maiúsculas com hífen (BF-XXXX-XXXX)
    const codigo = termo.toUpperCase().replace(/\s+/g, "-");
    const doIngresso: Prisma.TicketWhereInput | undefined = termo
      ? {
          OR: [
            { attendeeName: { contains: termo, mode: "insensitive" } },
            // ingresso não nominal: quem a produção conhece é o comprador
            { order: { contactName: { contains: termo, mode: "insensitive" } } },
            { code: { contains: codigo } },
          ],
        }
      : undefined;

    const rows = await prisma.checkin.findMany({
      where: {
        eventId: event.id,
        status: "CONFIRMED",
        ...(doIngresso ? { ticket: doIngresso } : {}),
      },
      // a hora da PORTA: entrada feita offline aparece onde aconteceu, não na
      // hora em que o aparelho sincronizou
      orderBy: [{ scannedAt: "desc" }, { id: "desc" }],
      take: ENTRADAS_POR_PAGINA + 1,
      select: {
        id: true,
        scannedAt: true,
        source: true,
        device: { select: { name: true } },
        checkinPoint: { select: { name: true } },
        ticket: {
          select: {
            code: true,
            attendeeName: true,
            ticketLot: { select: { name: true, ticketType: { select: { name: true } } } },
            orderItem: { select: { halfPrice: true } },
            order: { select: { contactName: true, status: true } },
          },
        },
      },
    });

    return {
      entries: rows.slice(0, ENTRADAS_POR_PAGINA).map((r) => ({
        checkinId: r.id,
        at: r.scannedAt,
        gate: r.checkinPoint?.name ?? null,
        deviceName: r.device.name,
        offline: r.source === "OFFLINE_SYNC",
        code: r.ticket.code,
        name: r.ticket.attendeeName,
        buyerName: r.ticket.order.contactName,
        typeName: r.ticket.ticketLot.ticketType.name,
        lotName: r.ticket.ticketLot.name,
        meia: ehMeia(r.ticket.orderItem),
        // a tela não oferece o botão que o servidor vai recusar (mesma regra
        // de `desfazerEntrada`) e diz o porquê
        canUndo: PEDIDO_VALENDO.has(r.ticket.order.status),
      })),
      hasMore: rows.length > ENTRADAS_POR_PAGINA,
    };
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
   *
   * `qrTokenConferido` (leitura por QR, 2026-10-12): o QR que acabou de ser
   * comparado com o do ingresso entra na MESMA guarda do update. Uma
   * transferência que grave o QR novo entre a comparação e esta transação faz
   * o update não pegar nada — e a leitura sai como QR antigo (`qrTrocado`), em
   * vez de deixar entrar quem tinha o QR de um milissegundo atrás.
   */
  private async attemptCheckin(
    ticketId: string,
    device: ValidatorDevice,
    checkinPointId: string | undefined,
    scannedAt: Date,
    source: "ONLINE" | "OFFLINE_SYNC",
    localSeq: number | null,
    qrTokenConferido?: string,
  ): Promise<{
    result: CheckinOutcome;
    ticketStatus: string;
    checkinId?: string;
    firstCheckin?: { at: Date | null; deviceName?: string };
    qrTrocado?: boolean;
  }> {
    return prisma.$transaction(async (tx) => {
      const won = await tx.ticket.updateMany({
        where: {
          id: ticketId,
          eventId: device.eventId,
          status: { in: ["ISSUED", "ACTIVE"] },
          ...(qrTokenConferido ? { qrToken: qrTokenConferido } : {}),
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
      if (qrTokenConferido && ticket.qrToken !== qrTokenConferido) {
        // o QR mudou no meio da leitura: é QR antigo agora — quem decide o que
        // registrar é `create` (mesmo rastro da recusa normal de QR antigo)
        return { result: "INVALID" as CheckinOutcome, ticketStatus: ticket.status, qrTrocado: true };
      }
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

    // SÓ O QR ATUAL VALE (2026-10-12). A assinatura confere também no QR de
    // antes da transferência — ele foi assinado pela mesma chave do evento. Sem
    // esta comparação, o print guardado por quem passou o ingresso adiante
    // entrava antes do novo dono. Vem ANTES de "já utilizado"/"cancelado": QR
    // antigo nunca vale, qualquer que seja o estado do ingresso.
    if (input.qrToken && !ehOQrAtual(input.qrToken, found.qrToken)) {
      return { ticket: null, reason: "OLD_QR" as const, qrAntigoDe: found };
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
        // etiqueta MEIA-ENTRADA: a meia é gravada no item do pedido
        orderItem: { select: { halfPrice: true } },
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
