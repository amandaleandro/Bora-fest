import webpush from "web-push";
import { prisma } from "@borafest/database";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "sale-notify" });

let configured = false;

/** Configura o VAPID uma vez. Sem chaves no ambiente, o push é no-op silencioso. */
function ensureVapid(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  if (!configured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? "mailto:no-reply@borafest.com.br",
      publicKey,
      privateKey,
    );
    configured = true;
  }
  return true;
}

/**
 * Notificação push de VENDA (gamificação 2026-08-12). Dispara na confirmação da
 * venda (online e PDV, via order.paid), com o valor. Vai para:
 *  - quem registrou/fez a venda (soldByUserId — vendedor do PDV);
 *  - o promoter creditado (promoterLink), quando a venda veio do link dele;
 *  - o dono/admins da organização (a casa vê TODAS as suas vendas).
 *
 * É BEST-EFFORT e NUNCA lança: notificação jamais pode quebrar a emissão do
 * ingresso, que é o efeito crítico do order.paid.
 */
export async function notifySale(orderId: string): Promise<void> {
  try {
    if (!ensureVapid()) return;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        totalCents: true,
        soldByUserId: true,
        event: { select: { title: true, organizationId: true } },
        promoterLink: { select: { promoterUserId: true } },
      },
    });
    // cortesia (R$ 0) não é "venda" para efeito de gamificação
    if (!order || order.totalCents <= 0) return;

    const recipientIds = new Set<string>();
    if (order.soldByUserId) recipientIds.add(order.soldByUserId);
    if (order.promoterLink?.promoterUserId) recipientIds.add(order.promoterLink.promoterUserId);

    const orgOwners = await prisma.organizationMember.findMany({
      where: {
        organizationId: order.event.organizationId,
        status: "ACTIVE",
        role: { key: { in: ["owner", "admin"] } },
      },
      select: { userId: true },
    });
    for (const m of orgOwners) recipientIds.add(m.userId);

    if (recipientIds.size === 0) return;

    const valor = (order.totalCents / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
    const payload = JSON.stringify({
      title: "💸 Venda realizada!",
      body: `${valor} · ${order.event.title}`,
      url: "/",
    });

    const subs = await prisma.webPushSubscription.findMany({
      where: { userId: { in: [...recipientIds] } },
    });
    await Promise.all(subs.map((sub) => sendOne(sub.id, sub.endpoint, sub.p256dh, sub.auth, payload)));

    if (subs.length > 0) {
      log.info({ orderId, recipients: recipientIds.size, sent: subs.length }, "push de venda disparado");
    }
  } catch (error) {
    log.error({ orderId, err: (error as Error).message }, "falha ao notificar venda (ignorado)");
  }
}

async function sendOne(
  id: string,
  endpoint: string,
  p256dh: string,
  auth: string,
  payload: string,
): Promise<void> {
  try {
    await webpush.sendNotification({ endpoint, keys: { p256dh, auth } }, payload);
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    // inscrição morta (navegador desinstalou/expirou): remove para não insistir
    if (status === 404 || status === 410) {
      await prisma.webPushSubscription.delete({ where: { id } }).catch(() => undefined);
    }
  }
}
