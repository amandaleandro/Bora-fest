import { BadRequestException, NotFoundException } from "@nestjs/common";
import { prisma, returnSaleInventory } from "@borafest/database";
import { semEmailReal } from "@borafest/contracts";

/**
 * CANCELAR PEDIDO GRÁTIS — a operação única (2026-10-11).
 *
 * Pedido de R$ 0 (lote grátis, cupom de 100%, cortesia, lista de convidados)
 * não tem dinheiro a devolver, então "reembolsar" não serve: o painel mostrava
 * o botão e o servidor respondia "Valor do estorno inválido" (ou "venda de
 * porta não tem reembolso", na lista) sem mudar nada — vaga presa e ingresso
 * valendo na porta. Decisão do Arthur: pedido grátis se CANCELA, não se
 * reembolsa.
 *
 * Uma peça só, usada pelo botão "Cancelar ingresso" do produtor, pelo
 * cancelamento do evento e, depois, pelo "Não vou mais" do comprador. As regras
 * vêm de lugares que já funcionam, para não reescrever o que está certo:
 *  - estorno de porta (refund-order.ts): só ingresso NÃO usado é cancelado e só
 *    ele devolve vaga — quem já entrou fica dentro;
 *  - cancelar da lista (guest-list.service.ts): a entrada da lista vira
 *    CANCELED, e é isso que devolve a cota do promoter (a cota conta entradas
 *    que não estão canceladas);
 *  - expiração (worker expire-orders.ts): o uso do cupom volta.
 *
 * O CPF fica livre sozinho: o limite por CPF só conta pedidos vivos.
 */

/** O que o comprador recebe por e-mail. */
export type AvisoDoCancelamentoGratis =
  /** "Seu ingresso foi cancelado" — botão do produtor (e o futuro "Não vou mais") */
  | { tipo: "ingresso" }
  /** "O evento X foi cancelado" — cancelamento do evento, com o motivo que o produtor escreveu */
  | { tipo: "evento"; motivo: string }
  | { tipo: "nenhum" };

export interface CancelarGratisOpcoes {
  /** quem pediu: vai para a auditoria e muda o texto do e-mail */
  origem?: "produtor" | "evento_cancelado" | "comprador";
  aviso?: AvisoDoCancelamentoGratis;
}

export interface CancelamentoGratis {
  orderId: string;
  organizationId: string;
  /** ingressos emitidos que deixaram de valer agora */
  ingressosCancelados: number;
  /** ingressos que ainda não tinham saído — com o pedido cancelado, não saem mais */
  naoEmitidos: number;
  /** ingressos já usados na entrada: ficam como estão e a vaga deles não volta */
  ingressosUsados: number;
  vagasDevolvidas: number;
}

/** Templates do worker (deliver-notifications.ts). */
const TEMPLATE_INGRESSO = "free_ticket_canceled";
const TEMPLATE_EVENTO = "free_event_canceled";

/** Situações em que o pedido grátis ainda vale (o ingresso saiu ou vai sair). */
const VALENDO = ["PAID", "FULFILLED"] as const;

/**
 * Cancela um pedido de R$ 0, SEM checagem de permissão — quem chama já checou
 * (mesmo contrato do `executarReembolso`).
 *
 * @param motivo vai para a auditoria; NÃO vai para o comprador (pode ser nota
 *   interna). No cancelamento do evento, o texto para o comprador vem em
 *   `aviso.motivo`.
 */
export async function cancelarPedidoGratis(
  orderId: string,
  actorUserId: string | null,
  motivo: string,
  opcoes: CancelarGratisOpcoes = {},
): Promise<CancelamentoGratis> {
  const origem = opcoes.origem ?? "produtor";
  const aviso: AvisoDoCancelamentoGratis = opcoes.aviso ?? { tipo: "ingresso" };

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      eventId: true,
      status: true,
      totalCents: true,
      contactEmail: true,
      contactName: true,
      payments: { select: { status: true } },
      items: { select: { id: true, ticketLotId: true, quantity: true } },
      event: {
        select: {
          organizationId: true,
          title: true,
          startsAt: true,
          timezone: true,
          organization: { select: { name: true, displayName: true } },
        },
      },
    },
  });
  if (!order) throw new NotFoundException("Pedido não encontrado");

  if (order.totalCents !== 0) {
    throw new BadRequestException("Este pedido foi pago — para devolver o dinheiro, use Reembolsar.");
  }
  // R$ 0 com pagamento aprovado não deveria existir. Se existir é anomalia, e
  // anomalia não se resolve no chute (mesma postura do refund-order.ts)
  if (order.payments.some((p) => ["PAID", "AUTHORIZED", "REFUND_PENDING"].includes(p.status))) {
    throw new BadRequestException(
      "Este pedido tem pagamento registrado — fale com o suporte antes de cancelar.",
    );
  }
  if (["CANCELED", "EXPIRED", "REFUNDED"].includes(order.status)) {
    throw new BadRequestException("Este ingresso já está cancelado.");
  }
  if (!(VALENDO as readonly string[]).includes(order.status)) {
    throw new BadRequestException("Este pedido não está confirmado — não há ingresso para cancelar.");
  }

  // data do evento no fuso dele, como no e-mail do ingresso (issue-tickets.ts).
  // Fora da transação: fuso inválido não pode impedir o cancelamento.
  let dataDoEvento: string | null = null;
  try {
    dataDoEvento = new Intl.DateTimeFormat("pt-BR", {
      timeZone: order.event.timezone,
      dateStyle: "short",
      timeStyle: "short",
    }).format(order.event.startsAt);
  } catch {
    dataDoEvento = null;
  }
  const casa = order.event.organization.displayName ?? order.event.organization.name;

  return prisma.$transaction(async (tx) => {
    // A TROCA DE STATUS É A TRAVA: dois cliques (ou o painel e o cancelamento
    // do evento ao mesmo tempo) chegam aqui juntos, mas só um vira o pedido
    // para CANCELED. O outro encontra count 0 e para ANTES de mexer no estoque
    // — sem isto a vaga voltava em dobro e o lote vendia além da capacidade.
    const trocou = await tx.order.updateMany({
      where: { id: order.id, totalCents: 0, status: { in: [...VALENDO] } },
      data: { status: "CANCELED" },
    });
    if (trocou.count === 0) {
      throw new BadRequestException("Este ingresso já está cancelado.");
    }

    const ingressos = await tx.ticket.findMany({
      where: { orderId: order.id },
      select: { id: true, orderItemId: true, ticketLotId: true, status: true },
    });

    const vagasPorLote = new Map<string, number>();
    const somarVaga = (lotId: string, qtd: number) => {
      if (qtd > 0) vagasPorLote.set(lotId, (vagasPorLote.get(lotId) ?? 0) + qtd);
    };

    // INGRESSO NÃO USADO: deixa de valer e devolve a vaga. Um por um, com o
    // status repetido no where: se a pessoa passar pela porta neste instante,
    // o check-in vence, ela fica CHECKED_IN e a vaga dela não volta (mesma
    // regra do estorno de porta — devolver vaga de quem está dentro é overbooking)
    const canceladosIds: string[] = [];
    for (const t of ingressos) {
      if (t.status !== "ISSUED" && t.status !== "ACTIVE") continue;
      const r = await tx.ticket.updateMany({
        where: { id: t.id, status: { in: ["ISSUED", "ACTIVE"] } },
        data: { status: "CANCELED", canceledAt: new Date() },
      });
      if (r.count === 1) {
        canceladosIds.push(t.id);
        somarVaga(t.ticketLotId, 1);
      }
    }

    // AINDA NÃO EMITIDO: o worker só emite pedido PAID (issue-tickets.ts), então
    // com o pedido CANCELED este ingresso não sai mais — e a vaga dele volta
    let naoEmitidos = 0;
    for (const item of order.items) {
      const emitidos = ingressos.filter((t) => t.orderItemId === item.id).length;
      const faltam = Math.max(item.quantity - emitidos, 0);
      naoEmitidos += faltam;
      somarVaga(item.ticketLotId, faltam);
    }

    if (canceladosIds.length + naoEmitidos === 0) {
      // todo mundo já entrou: não há o que cancelar, e virar o pedido para
      // CANCELED tiraria do relatório gente que passou pela porta. O throw
      // desfaz a troca de status lá de cima.
      throw new BadRequestException(
        "Todos os ingressos deste pedido já foram usados na entrada — não há o que cancelar.",
      );
    }

    // mesma função de estoque do estorno (sold_count − qtd)
    for (const [lotId, qtd] of vagasPorLote) await returnSaleInventory(tx, lotId, qtd);

    const ingressosUsados = ingressos.filter(
      (t) => !canceladosIds.includes(t.id) && t.status !== "CANCELED" && t.status !== "REFUNDED",
    ).length;

    // CANCELAMENTO PARCIAL (revisão 2026-10-11): alguém do pedido já entrou. O
    // pedido NÃO vira cancelado — tem gente dentro, ele segue no relatório e em
    // "Minhas compras", segue contando no limite por CPF (senão o mesmo CPF
    // pegaria mais ingressos do que o lote permite) e o cupom continua usado.
    // Só os ingressos não usados caíram, logo acima. A troca de status serviu de
    // trava; volta ao que era, dentro da mesma transação.
    const parcial = ingressosUsados > 0;
    if (parcial) {
      await tx.order.update({ where: { id: order.id }, data: { status: order.status } });
    }

    // LISTA DE CONVIDADOS: a entrada acompanha o ingresso. CANCELED na entrada
    // tira o nome da portaria e devolve a cota do promoter (a cota conta as
    // entradas não canceladas — guest-list.service.ts). A vaga NÃO é devolvida
    // aqui de novo: já voltou pelo ingresso, logo acima.
    const lista = await tx.guestListEntry.updateMany({
      where: {
        orderId: order.id,
        status: "CONFIRMED",
        OR: [{ ticketId: null }, { ticketId: { in: canceladosIds } }],
      },
      data: { status: "CANCELED" },
    });

    // DEVOLVE O CUPOM, como a expiração faz: o uso volta para a próxima pessoa
    // (só quando o pedido inteiro caiu — no parcial o cupom foi usado de verdade)
    const resgate = parcial ? null : await tx.couponRedemption.findUnique({ where: { orderId: order.id } });
    if (resgate) {
      await tx.coupon.updateMany({
        where: { id: resgate.couponId, redeemedCount: { gt: 0 } },
        data: { redeemedCount: { decrement: 1 } },
      });
      await tx.couponRedemption.delete({ where: { id: resgate.id } });
    }

    // CONVITE POR E-MAIL (2026-10-12): o pedido inteiro caiu, então o convite
    // volta a valer — a pessoa pode pegar de novo pelo mesmo link; para tirar
    // de vez, o produtor revoga na tela de convites. No parcial alguém entrou
    // com ele: segue usado.
    const convitesDevolvidos = parcial
      ? { count: 0 }
      : await tx.lotEmailInvite.updateMany({
          where: { orderId: order.id, status: "CLAIMED" },
          data: { status: "SENT", orderId: null, claimedAt: null },
        });

    const vagasDevolvidas = [...vagasPorLote.values()].reduce((soma, v) => soma + v, 0);

    await tx.auditLog.create({
      data: {
        actorUserId,
        organizationId: order.event.organizationId,
        action: "order.free_cancel",
        entityType: "order",
        entityId: order.id,
        metadata: {
          origem,
          motivo,
          ingressosCancelados: canceladosIds.length,
          naoEmitidos,
          ingressosUsados,
          parcial,
          vagasDevolvidas,
          entradasDaListaCanceladas: lista.count,
          cupomDevolvido: Boolean(resgate),
          convitesDevolvidos: convitesDevolvidos.count,
        },
      },
    });

    // AVISO AO COMPRADOR na mesma transação: só sai se o cancelamento valeu.
    // E-mail sintético (lista, porta) não tem caixa — enviar seria bounce.
    const email = order.contactEmail;
    if (aviso.tipo !== "nenhum" && !semEmailReal(email)) {
      if (aviso.tipo === "ingresso") {
        await tx.notification.create({
          data: {
            channel: "EMAIL",
            recipient: email,
            template: TEMPLATE_INGRESSO,
            orderId: order.id,
            payload: {
              contactName: order.contactName,
              eventTitle: order.event.title,
              eventStartsAt: dataDoEvento,
              casa,
              quantidade: canceladosIds.length + naoEmitidos,
              pedidoPeloComprador: origem === "comprador",
            },
          },
        });
      } else {
        // um e-mail por pessoa por evento: quem pegou dois pedidos grátis não
        // recebe "o evento foi cancelado" duas vezes. Procura pelos outros
        // pedidos dela neste evento (índices de contactEmail e de orderId) em
        // vez de varrer a tabela de notificações inteira
        const outrosPedidos = await tx.order.findMany({
          where: { eventId: order.eventId, contactEmail: email, id: { not: order.id } },
          select: { id: true },
        });
        const jaAvisado =
          outrosPedidos.length > 0 &&
          (await tx.notification.findFirst({
            where: { template: TEMPLATE_EVENTO, orderId: { in: outrosPedidos.map((p) => p.id) } },
            select: { id: true },
          }));
        if (!jaAvisado) {
          await tx.notification.create({
            data: {
              channel: "EMAIL",
              recipient: email,
              template: TEMPLATE_EVENTO,
              orderId: order.id,
              payload: {
                eventId: order.eventId,
                contactName: order.contactName,
                eventTitle: order.event.title,
                casa,
                motivo: aviso.motivo.trim(),
              },
            },
          });
        }
      }
    }

    return {
      orderId: order.id,
      organizationId: order.event.organizationId,
      ingressosCancelados: canceladosIds.length,
      naoEmitidos,
      ingressosUsados,
      vagasDevolvidas,
    };
  });
}
