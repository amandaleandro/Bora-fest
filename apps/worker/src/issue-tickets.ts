import { semEmailReal } from "@borafest/contracts";
import { createSessionToken } from "@borafest/auth";
import { prisma, Prisma } from "@borafest/database";
import {
  abrirChavePrivada,
  conferirChaveMestra,
  generateEventKeyPair,
  generateTicketCode,
  protegerChavePrivada,
  signTicketToken,
} from "@borafest/tickets";
import { withContext } from "@borafest/observability";
import { publishRankingUpdate } from "@borafest/queues";
import { randomBytes } from "crypto";

const log = withContext({ module: "ticket-issuance" });

// CHAVE DO QR CIFRADA EM REPOUSO (2026-10-12): este módulo carrega no boot do
// worker (via process-outbox). Sem TICKET_KEY_ENCRYPTION_KEY avisa que a chave
// de cada evento fica em texto puro; mal formada, derruba o boot aqui — melhor
// que falhar a emissão pedido a pedido com a compra já paga.
const estadoChaveDoQr = conferirChaveMestra();
if (estadoChaveDoQr.aviso) log.warn(estadoChaveDoQr.aviso);

/**
 * Emissão exatamente-uma-vez (arquitetura §10/§11):
 * - guarda de status: só emite se o pedido está PAID; FULFILLED = já emitido;
 * - unique(order_item_id, seq) no banco impede duplicata mesmo em corrida;
 * - QR assinado com Ed25519 pela chave do evento (§12).
 */
export async function issueTicketsForOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      attendees: true,
      event: { include: { signingKey: true } },
      user: { select: { id: true, email: true, emailVerifiedAt: true, name: true, cpf: true, sessionVersion: true } },
      guestListEntries: { select: { id: true }, take: 1 },
    },
  });

  if (!order) {
    log.warn({ orderId }, "pedido não encontrado para emissão");
    return;
  }
  if (order.status === "FULFILLED") return; // já emitido — reprocessamento é no-op

  // etiqueta de entrada grátis (2026-08-31): muda assunto/abertura dos e-mails
  const cortesia =
    order.totalCents === 0
      ? order.guestListEntries.length > 0
        ? ("CONVIDADO" as const)
        : order.soldByUserId
          ? ("CORTESIA" as const)
          : ("GRATIS" as const) // lote grátis pego no site (2026-10-10): não é "compra"
      : null;
  if (order.status !== "PAID") {
    // reprocesso depois de um cancelamento que pegou a emissão no meio: o que
    // nasceu valendo num pedido cancelado é anulado (ver corrida abaixo)
    if (order.status === "CANCELED") await anularIngressosDePedidoCancelado(prisma, orderId);
    log.warn({ orderId, status: order.status }, "pedido não está PAID; emissão ignorada");
    return;
  }

  const signingKey = await ensureSigningKey(order.eventId, order.event.signingKey);

  // participantes nominais informados no checkout, consumidos por lote
  const attendeesByLot = new Map<string, Array<{ name: string; cpf: string | null }>>();
  for (const a of order.attendees ?? []) {
    const list = attendeesByLot.get(a.ticketLotId) ?? [];
    list.push({ name: a.name, cpf: a.cpf });
    attendeesByLot.set(a.ticketLotId, list);
  }

  for (const item of order.items) {
    for (let seq = 1; seq <= item.quantity; seq++) {
      const attendee = attendeesByLot.get(item.ticketLotId)?.[seq - 1];
      const ticketId = randomUuid();
      const qrToken = signTicketToken(
        {
          v: 1,
          eid: order.eventId,
          tid: ticketId,
          lid: item.ticketLotId,
          n: randomBytes(8).toString("base64url"),
          iat: Math.floor(Date.now() / 1000),
        },
        signingKey.privateKeyPem,
      );

      try {
        await prisma.ticket.create({
          data: {
            id: ticketId,
            orderId: order.id,
            orderItemId: item.id,
            eventId: order.eventId,
            ticketLotId: item.ticketLotId,
            seq,
            code: generateTicketCode(),
            qrToken,
            status: "ACTIVE",
            attendeeEmail: order.contactEmail,
            // TODO ingresso nasce NOMINAL (decisão 2026-08-15): sem participante
            // digitado, o titular é QUEM PAGOU (nome + CPF da conta do comprador)
            attendeeName: attendee?.name ?? order.contactName ?? order.user?.name ?? null,
            attendeeCpf: attendee?.cpf ?? order.user?.cpf ?? null,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          // (orderItemId, seq) já emitido por execução anterior — idempotente
          continue;
        }
        throw error;
      }
    }
  }

  // FULFILLED + notificações na MESMA transação: reprocessar o outbox nunca
  // duplica e-mail/WhatsApp (a guarda de status decide exatamente uma vez)
  const tickets = await prisma.ticket.findMany({
    where: { orderId },
    orderBy: [{ orderItemId: "asc" }, { seq: "asc" }],
    include: { ticketLot: { select: { name: true, ticketType: { select: { name: true } } } } },
  });

  let justFulfilled = false;
  await prisma.$transaction(async (tx) => {
    const fulfilled = await tx.order.updateMany({
      where: { id: orderId, status: "PAID" },
      data: { status: "FULFILLED" },
    });
    if (fulfilled.count === 0) {
      // CORRIDA COM O CANCELAMENTO DO GRÁTIS (2026-10-11): se o produtor cancelou
      // enquanto este laço criava os ingressos, os criados depois nasceram ACTIVE
      // num pedido CANCELED. O cancelamento já devolveu a vaga deles (contou como
      // "ainda não emitido") — então aqui só se anula o QR, sem mexer no estoque.
      await anularIngressosDePedidoCancelado(tx, orderId);
      return;
    }
    justFulfilled = true;

    // Portão do 1º ingresso (decisão 2026-08-10): conta ainda não verificada
    // NÃO recebe o ingresso por e-mail — recebe o aviso com link mágico, que
    // verifica a conta e abre o ingresso. Verificado = entrega normal.
    if (order.user && !order.user.emailVerifiedAt) {
      // o link entra na conta: vai para o e-mail DA CONTA, nunca para um
      // contato digitado por quem estava logado (2026-10-12, ver a função)
      const destino = destinoDoLinkDeAcesso(order);
      if (!destino) {
        // conta sem e-mail cadastrado: não há destino seguro para o link — e o
        // QR segue trancado até verificar (caso de suporte, não do contato)
        log.warn({ orderId }, "conta não verificada sem e-mail: link de acesso não enviado");
        return;
      }
      const claimToken = await createSessionToken(
        { sub: order.user.id, purpose: "email-verify", sv: order.user.sessionVersion, orderToken: order.publicToken },
        "7d",
      );
      const base = process.env.WEB_BASE_URL ?? "https://borafest.com.br";
      await tx.notification.create({
        data: {
          channel: "EMAIL",
          recipient: destino,
          template: "account_claim",
          payload: {
            // conta que já existia: a saudação é do dono dela, não do contato
            contactName: order.accountCreatedByOrder
              ? order.contactName
              : (order.user.name ?? order.contactName),
            eventTitle: order.event.title,
            claimUrl: `${base}/acesso?token=${encodeURIComponent(claimToken)}`,
            contaNova: Boolean(order.accountCreatedByOrder),
            cortesia,
          },
          orderId,
        },
      });
      return; // sem QR por e-mail/WhatsApp/push até verificar
    }

    const payload = buildDeliveryPayload(order, tickets, cortesia);
    // SEM CAIXA, SEM ENVIO (2026-09-15). Convidado de lista não recebe nada
    // (prova pelo CPF na porta) e a venda na porta não tem e-mail — os dois
    // carregam um contactEmail sintético só para o NOT NULL. Enfileirar aqui
    // era bounce garantido, centenas por noite, contra a reputação do
    // remetente. O ingresso nasce e o pedido fecha FULFILLED exatamente igual.
    const daLista = order.guestListEntries.length > 0;
    if (!daLista && !semEmailReal(order.contactEmail)) {
      await tx.notification.create({
        data: {
          channel: "EMAIL",
          recipient: order.contactEmail,
          template: "ticket_delivery",
          payload,
          orderId,
        },
      });
    }
    if (!daLista && order.contactPhone) {
      await tx.notification.create({
        data: {
          channel: "WHATSAPP",
          recipient: order.contactPhone,
          template: "ticket_delivery",
          payload,
          orderId,
        },
      });
    }

    const pushTokens = await tx.pushToken.findMany({ where: { orderId } });
    for (const pushToken of pushTokens) {
      await tx.notification.create({
        data: {
          channel: "PUSH",
          recipient: pushToken.token,
          template: "ticket_delivery",
          payload,
          orderId,
        },
      });
    }
  });

  log.info({ orderId, tickets: tickets.length }, "ingressos emitidos e entrega enfileirada");

  // Competição de vendas por atlética/parceiro: avisa quem estiver com o
  // ranking aberto (SSE na API) pra atualizar em tempo real, sem esperar F5.
  if (justFulfilled && order.salesPartnerId) {
    publishRankingUpdate(order.eventId);
  }
}

/**
 * Para onde vai o link mágico de acesso (account_claim) — 2026-10-12, decisão
 * de 02/09 ("escopar account_claim a accountCreatedByOrder"). O link VERIFICA
 * E ENTRA na conta, e o contactEmail é só o que foi digitado no checkout:
 * logado numa conta ainda não verificada, quem pusesse o e-mail de um terceiro
 * entregava a ele a chave da própria conta. Só quando a conta NASCEU deste
 * pedido o contato é o e-mail da conta; nos outros casos vai para o e-mail
 * cadastrado na conta, e o contato não recebe link nenhum. null = sem destino
 * seguro (pedido sem conta, ou conta sem e-mail). A API repete esta regra no
 * reenvio (notifications.service.ts) — mudou aqui, muda lá.
 */
export function destinoDoLinkDeAcesso(order: {
  accountCreatedByOrder: boolean;
  contactEmail: string;
  user: { email: string | null } | null;
}): string | null {
  if (!order.user) return null;
  if (order.accountCreatedByOrder) return order.contactEmail;
  return order.user.email || null;
}

export function buildDeliveryPayload(
  order: {
    publicToken: string;
    contactName: string | null;
    event: { title: string; startsAt: Date; timezone: string };
  },
  tickets: Array<{
    code: string;
    ticketLot: { name: string; ticketType: { name: string } };
  }>,
  cortesia: "CONVIDADO" | "CORTESIA" | "GRATIS" | null = null,
) {
  const webBaseUrl = process.env.WEB_BASE_URL ?? (process.env.NODE_ENV === "production" ? "https://borafest.com.br" : "http://localhost:3000");
  return {
    contactName: order.contactName ?? undefined,
    eventTitle: order.event.title,
    eventStartsAt: new Intl.DateTimeFormat("pt-BR", {
      timeZone: order.event.timezone,
      dateStyle: "short",
      timeStyle: "short",
    }).format(order.event.startsAt),
    // link profundo: abre a carteira do pedido sem conta nem aplicativo
    orderUrl: `${webBaseUrl}/pedido/${order.publicToken}`,
    tickets: tickets.map((t) => ({
      code: t.code,
      typeName: t.ticketLot.ticketType.name,
      lotName: t.ticketLot.name,
    })),
    cortesia,
  };
}

/**
 * Chave de assinatura do evento, JÁ ABERTA para assinar (2026-10-12): no banco
 * ela é gravada cifrada quando há TICKET_KEY_ENCRYPTION_KEY; a leitura aceita
 * também o texto puro antigo (ver @borafest/tickets, cifra-chave.ts).
 */
async function ensureSigningKey(
  eventId: string,
  existing: { privateKeyPem: string } | null,
): Promise<{ privateKeyPem: string }> {
  if (existing) return { privateKeyPem: abrirChavePrivada(existing.privateKeyPem) };

  const pair = generateEventKeyPair();
  try {
    await prisma.eventSigningKey.create({
      data: { eventId, publicKeyPem: pair.publicKeyPem, privateKeyPem: protegerChavePrivada(pair.privateKeyPem) },
    });
    return { privateKeyPem: pair.privateKeyPem };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // outra execução criou primeiro — usa a existente
      const criada = await prisma.eventSigningKey.findUniqueOrThrow({ where: { eventId } });
      return { privateKeyPem: abrirChavePrivada(criada.privateKeyPem) };
    }
    throw error;
  }
}

function randomUuid(): string {
  // uuid v4 via crypto — evita dependência extra
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Ingresso ACTIVE de pedido CANCELED não vale na porta (corrida emissão × cancelamento do grátis). */
async function anularIngressosDePedidoCancelado(db: Pick<typeof prisma, "ticket">, orderId: string) {
  const anulados = await db.ticket.updateMany({
    where: { orderId, status: { in: ["ISSUED", "ACTIVE"] }, order: { status: "CANCELED" } },
    data: { status: "CANCELED", canceledAt: new Date() },
  });
  if (anulados.count > 0) log.warn({ orderId, anulados: anulados.count }, "ingressos emitidos depois do cancelamento foram anulados");
}
