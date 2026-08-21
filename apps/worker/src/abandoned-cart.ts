import { prisma } from "@borafest/database";
import { getEmailSender } from "@borafest/notifications";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "abandoned-cart" });

// tempo parado no pedido antes de considerar "abandonado" o suficiente pra lembrar
const ABANDONED_AFTER_MS = Number(process.env.ABANDONED_CART_AFTER_MS ?? 20 * 60_000);

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
    subject: `Seu ingresso pra ${order.event.title} ainda te espera`,
    html: `<p>${saudacao}</p><p>Você começou a comprar ingresso pra <strong>${order.event.title}</strong> e não terminou o pagamento.</p><p><a href="${link}">${link}</a></p>`,
    text: `${saudacao} Você começou a comprar ingresso pra ${order.event.title} e não terminou o pagamento: ${link}`,
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
