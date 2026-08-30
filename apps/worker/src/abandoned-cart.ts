import { prisma } from "@borafest/database";
import { getEmailSender } from "@borafest/notifications";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "abandoned-cart" });

// tempo parado no pedido antes de considerar "abandonado" o suficiente pra
// lembrar. 15 min numa janela de pagamento de 30 (correção 2026-08-30): o
// default antigo era 20 min numa janela de 15 — conjunto VAZIO, o lembrete
// nunca disparou uma única vez em produção.
const ABANDONED_AFTER_MS = Number(process.env.ABANDONED_CART_AFTER_MS ?? 15 * 60_000);

// resgate pós-expiração (decisão do Arthur 2026-08-30): 1h depois de expirar,
// convida a recomeçar pelo hotsite do evento. O teto de idade protege o
// PRIMEIRO deploy: sem ele, todo o histórico de pedidos expirados receberia
// e-mail de uma vez.
const RESCUE_AFTER_MS = Number(process.env.ABANDONED_RESCUE_AFTER_MS ?? 60 * 60_000);
const RESCUE_MAX_AGE_MS = Number(process.env.ABANDONED_RESCUE_MAX_AGE_MS ?? 6 * 60 * 60_000);

/**
 * Lembrete de carrinho abandonado: pedido criado há tempo, ainda sem
 * pagamento, mas dentro da janela (`expiresAt` no futuro — se já venceu,
 * quem cuida é o expire-orders). Um e-mail por pedido, marcado por
 * `abandonedReminderSentAt` pra não repetir.
 */
export async function sendAbandonedCartReminders(): Promise<void> {
  const threshold = new Date(Date.now() - ABANDONED_AFTER_MS);
  const stale = await prisma.order.findMany({
    where: {
      status: { in: ["CREATED", "PAYMENT_PENDING"] },
      createdAt: { lt: threshold },
      expiresAt: { gt: new Date() },
      abandonedReminderSentAt: null,
    },
    select: {
      id: true,
      publicToken: true,
      contactEmail: true,
      contactName: true,
      event: { select: { title: true } },
    },
    take: 100,
  });

  for (const order of stale) {
    try {
      await remindOrder(order);
    } catch (error) {
      log.error({ orderId: order.id, error: (error as Error).message }, "falha ao lembrar carrinho abandonado");
    }
  }
}

async function remindOrder(order: {
  id: string;
  publicToken: string;
  contactEmail: string;
  contactName: string | null;
  event: { title: string };
}): Promise<void> {
  const webBaseUrl = process.env.CHECKOUT_BASE_URL ?? process.env.WEB_BASE_URL ?? "http://localhost:3000";
  const link = `${webBaseUrl}/pedido/${order.publicToken}`;
  const saudacao = order.contactName ? `Oi, ${order.contactName}!` : "Oi!";

  await getEmailSender().send({
    to: order.contactEmail,
    subject: `Seu Pix pra ${order.event.title} expira em breve`,
    html: `<p>${saudacao}</p><p>Você começou a comprar ingresso pra <strong>${order.event.title}</strong> e o Pix ainda está valendo — mas expira em breve.</p><p><a href="${link}">Concluir o pagamento</a></p><p style="color:#666;font-size:12px">Se você já pagou, pode ignorar este e-mail.</p>`,
    text: `${saudacao} Você começou a comprar ingresso pra ${order.event.title} e o Pix ainda está valendo, mas expira em breve. Conclua em: ${link}`,
  });

  // marca ANTES de considerar concluído seria arriscado (falha no meio deixaria
  // pedido sem marca e sem e-mail); marcar DEPOIS do send arrisca reenvio numa
  // corrida rara com o próprio sweep — aceitável pra um lembrete best-effort
  await prisma.order.update({
    where: { id: order.id },
    data: { abandonedReminderSentAt: new Date() },
  });

  log.info({ orderId: order.id }, "lembrete de carrinho abandonado enviado");
}

/**
 * Resgate pós-expiração (toque 2 do funil, 2026-08-30): o pedido morreu, o
 * estoque voltou — o link certo é o HOTSITE do evento, que recomeça o checkout
 * e lida sozinho com lote virado/esgotado. Regras:
 *  - só eventos publicados e que ainda não começaram;
 *  - nunca para quem JÁ COMPROU o mesmo evento em outro pedido (marcamos
 *    rescueReminderSentAt mesmo assim, pra não reavaliar a cada varredura);
 *  - teto de idade (RESCUE_MAX_AGE_MS) segura o backlog no primeiro deploy;
 *  - um e-mail por pedido, via rescueReminderSentAt.
 */
export async function sendExpiredRescueEmails(): Promise<void> {
  const agora = Date.now();
  const expirados = await prisma.order.findMany({
    where: {
      status: "EXPIRED",
      rescueReminderSentAt: null,
      expiresAt: {
        lt: new Date(agora - RESCUE_AFTER_MS),
        gt: new Date(agora - RESCUE_MAX_AGE_MS),
      },
      event: { status: "PUBLISHED", startsAt: { gt: new Date() } },
    },
    select: {
      id: true,
      eventId: true,
      contactEmail: true,
      contactName: true,
      event: { select: { title: true, slug: true } },
    },
    take: 100,
  });

  for (const order of expirados) {
    try {
      await resgatarPedido(order);
    } catch (error) {
      log.error({ orderId: order.id, error: (error as Error).message }, "falha no resgate pós-expiração");
    }
  }
}

async function resgatarPedido(order: {
  id: string;
  eventId: string;
  contactEmail: string;
  contactName: string | null;
  event: { title: string; slug: string };
}): Promise<void> {
  // já comprou este evento por outro caminho? então nada de "ainda dá tempo"
  const jaComprou = await prisma.order.findFirst({
    where: {
      eventId: order.eventId,
      contactEmail: order.contactEmail,
      status: { in: ["PAID", "FULFILLED", "PARTIALLY_REFUNDED"] },
    },
    select: { id: true },
  });
  if (jaComprou) {
    await prisma.order.update({ where: { id: order.id }, data: { rescueReminderSentAt: new Date() } });
    log.info({ orderId: order.id }, "resgate pulado: comprador já concluiu outro pedido do evento");
    return;
  }

  const webBaseUrl = process.env.CHECKOUT_BASE_URL ?? process.env.WEB_BASE_URL ?? "http://localhost:3000";
  const link = `${webBaseUrl}/evento/${order.event.slug}`;
  const saudacao = order.contactName ? `Oi, ${order.contactName}!` : "Oi!";

  await getEmailSender().send({
    to: order.contactEmail,
    subject: `Ainda dá tempo: ingressos pra ${order.event.title}`,
    html: `<p>${saudacao}</p><p>Seu pedido pra <strong>${order.event.title}</strong> expirou, mas os ingressos continuam à venda.</p><p><a href="${link}">Garantir meu ingresso</a></p><p style="color:#666;font-size:12px">Se você já garantiu o seu, pode ignorar este e-mail.</p>`,
    text: `${saudacao} Seu pedido pra ${order.event.title} expirou, mas os ingressos continuam à venda: ${link}`,
  });

  await prisma.order.update({ where: { id: order.id }, data: { rescueReminderSentAt: new Date() } });
  log.info({ orderId: order.id }, "resgate pós-expiração enviado");
}
