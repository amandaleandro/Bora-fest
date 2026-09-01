import {
  createNotificationDeliveryQueue,
  createNotificationDeliveryWorker,
  createOrderExpirationQueue,
  createOrderExpirationWorker,
  createOutboxDispatchQueue,
  createOutboxDispatchWorker,
  createPaymentReconciliationQueue,
  createPaymentReconciliationWorker,
  createReservationExpirationQueue,
  createReservationExpirationWorker,
  AUTO_PAYOUTS_JOB_ID,
  createAutoPayoutsQueue,
  createAutoPayoutsWorker,
  createPaymentWebhookProcessingWorker,
  createWaitingRoomSweepQueue,
  createWaitingRoomSweepWorker,
  ABANDONED_CART_JOB_ID,
  createAbandonedCartQueue,
  createAbandonedCartWorker,
  NOTIFICATION_DELIVERY_JOB_ID,
  ORDER_EXPIRATION_JOB_ID,
  OUTBOX_DISPATCH_JOB_ID,
  PAYMENT_RECONCILIATION_JOB_ID,
  RESERVATION_RECONCILIATION_JOB_ID,
  WAITING_ROOM_SWEEP_JOB_ID,
} from "@borafest/queues";
import {
  withContext,
  startMetricsServer,
  jobsCompletedTotal,
  jobsFailedTotal,
  jobDuration,
} from "@borafest/observability";
import { expireReservation, reconcileExpiredReservations } from "./expire-reservation";
import { processOutboxBatch } from "./process-outbox";
import { reconcilePendingPayments } from "./reconcile-payments";
import { expireStaleOrders } from "./expire-orders";
import { deliverPendingNotifications } from "./deliver-notifications";
import { executeAutoTransfers } from "./auto-payouts";
import { processPaymentWebhookJob } from "./process-payment-webhook";
import { sweepWaitingRooms } from "./sweep-waiting-room";
import { sendAbandonedCartReminders, sendExpiredRescueEmails } from "./abandoned-cart";
import { purgarFilasLegado } from "./purga-filas-legado";

const log = withContext({ module: "worker" });

/**
 * Mesmo guard da API (auditoria 2026-08-30): o WORKER é quem entrega OTP/reset/
 * magic-link, então é ele que grava em claro com devlog. Sem este guard, a API
 * podia estar segura e o worker vazando no log.
 */
function assertProductionProviders(): void {
  if (process.env.NODE_ENV !== "production") return;
  const proibidos: string[] = [];
  if ((process.env.EMAIL_PROVIDER ?? "devlog") === "devlog") proibidos.push("EMAIL_PROVIDER=devlog");
  if (process.env.WHATSAPP_PROVIDER === "devlog") proibidos.push("WHATSAPP_PROVIDER=devlog");
  if (process.env.PUSH_PROVIDER === "devlog") proibidos.push("PUSH_PROVIDER=devlog");
  if (proibidos.length > 0) {
    throw new Error(`Worker: configuração insegura para produção: ${proibidos.join("; ")}`);
  }
}

async function main() {
  assertProductionProviders();
  startMetricsServer(Number(process.env.WORKER_METRICS_PORT ?? 9464));

  // --- reservas: expiração pontual + reconciliação -------------------------
  const reservationWorker = createReservationExpirationWorker(async (job) => {
    if (job.name === "reconcile") {
      await reconcileExpiredReservations();
      return;
    }
    await expireReservation(job.data.reservationId);
  });
  await createReservationExpirationQueue().upsertJobScheduler(
    RESERVATION_RECONCILIATION_JOB_ID,
    { every: 60_000 },
    { name: "reconcile", data: {} as any, opts: { removeOnComplete: { count: 5 }, removeOnFail: { age: 24 * 3600 } } },
  );

  // --- outbox: emissão de ingressos, estornos de órfãos, revogações --------
  const outboxWorker = createOutboxDispatchWorker(async () => {
    await processOutboxBatch();
  });
  await createOutboxDispatchQueue().upsertJobScheduler(
    OUTBOX_DISPATCH_JOB_ID,
    { every: 3_000 },
    { name: "dispatch", data: {}, opts: { removeOnComplete: { count: 5 }, removeOnFail: { age: 24 * 3600 } } },
  );

  // --- repasses: executa/concilia transferências dos saques aprovados ------
  // (molde 2026-08-09: payout NASCE do clique do produtor ou da aprovação do
  // backoffice — a varredura só move o dinheiro, nunca decide sozinha)
  const autoPayoutsWorker = createAutoPayoutsWorker(async () => {
    await executeAutoTransfers();
  });
  await createAutoPayoutsQueue().upsertJobScheduler(
    AUTO_PAYOUTS_JOB_ID,
    // 5 min por padrão: com transferência automática ligada, "repasse na
    // hora" precisa ser quase na hora mesmo (mínimo por casa segura o volume)
    { every: Number(process.env.AUTO_PAYOUTS_SWEEP_MS ?? 5 * 60_000) },
    { name: "sweep", data: {}, opts: { removeOnComplete: { count: 5 }, removeOnFail: { age: 24 * 3600 } } },
  );

  // --- pagamentos: reconciliação com o gateway -----------------------------
  const paymentWorker = createPaymentReconciliationWorker(async () => {
    await reconcilePendingPayments();
  });
  await createPaymentReconciliationQueue().upsertJobScheduler(
    PAYMENT_RECONCILIATION_JOB_ID,
    { every: 60_000 },
    { name: "reconcile", data: {}, opts: { removeOnComplete: { count: 5 }, removeOnFail: { age: 24 * 3600 } } },
  );

  // --- pedidos: expiração da janela de pagamento ---------------------------
  const orderWorker = createOrderExpirationWorker(async () => {
    await expireStaleOrders();
  });
  await createOrderExpirationQueue().upsertJobScheduler(
    ORDER_EXPIRATION_JOB_ID,
    { every: 30_000 },
    { name: "expire", data: {}, opts: { removeOnComplete: { count: 5 }, removeOnFail: { age: 24 * 3600 } } },
  );

  // --- carrinho abandonado: lembrete de pedido pendente não pago -----------
  const abandonedCartWorker = createAbandonedCartWorker(async () => {
    await sendAbandonedCartReminders();
    await sendExpiredRescueEmails();
  });
  await createAbandonedCartQueue().upsertJobScheduler(
    ABANDONED_CART_JOB_ID,
    { every: 5 * 60_000 },
    { name: "remind", data: {}, opts: { removeOnComplete: { count: 5 }, removeOnFail: { age: 24 * 3600 } } },
  );

  // --- notificações: entrega de e-mail/WhatsApp ----------------------------
  const notificationWorker = createNotificationDeliveryWorker(async () => {
    await deliverPendingNotifications();
  });
  await createNotificationDeliveryQueue().upsertJobScheduler(
    NOTIFICATION_DELIVERY_JOB_ID,
    { every: 5_000 },
    { name: "deliver", data: {}, opts: { removeOnComplete: { count: 5 }, removeOnFail: { age: 24 * 3600 } } },
  );

  // --- webhooks de pagamento: verificação de assinatura + aplicação de status
  const webhookWorker = createPaymentWebhookProcessingWorker(async (job) => {
    await processPaymentWebhookJob(job.data);
  });

  // --- sala de espera: promove fila → admitidos nos eventos com pico
  const waitingRoomWorker = createWaitingRoomSweepWorker(async () => {
    await sweepWaitingRooms();
  });
  await createWaitingRoomSweepQueue().upsertJobScheduler(
    WAITING_ROOM_SWEEP_JOB_ID,
    // 10s (perf 2026-08-30): a cada 2s eram 43.200 jobs/dia rodando VAZIOS na
    // maior parte do tempo — 45% do vazamento do Redis. O TTL de admissão é de
    // 12min; entrar da fila com até 10s de espera é imperceptível.
    { every: Number(process.env.WAITING_ROOM_SWEEP_MS ?? 10_000) },
    { name: "sweep", data: {}, opts: { removeOnComplete: { count: 5 }, removeOnFail: { age: 24 * 3600 } } },
  );

  for (const [name, worker] of [
    ["reservas", reservationWorker],
    ["outbox", outboxWorker],
    ["pagamentos", paymentWorker],
    ["pedidos", orderWorker],
    ["notificações", notificationWorker],
    ["repasses", autoPayoutsWorker],
    ["webhooks de pagamento", webhookWorker],
    ["sala de espera", waitingRoomWorker],
    ["carrinho abandonado", abandonedCartWorker],
  ] as const) {
    worker.on("failed", (job, error) => {
      jobsFailedTotal.inc({ queue: name });
      log.error({ queue: name, jobId: job?.id, error: error.message }, "job falhou");
    });
    worker.on("completed", (job) => {
      jobsCompletedTotal.inc({ queue: name });
      if (job.processedOn && job.finishedOn) {
        jobDuration.observe({ queue: name }, (job.finishedOn - job.processedOn) / 1000);
      }
    });
  }

  log.info(
    "workers iniciados: reservas, outbox, pagamentos, pedidos, notificações, repasses, webhooks de pagamento, sala de espera e carrinho abandonado",
  );

  // purga one-shot do legado de jobs (2,4M chaves) — em background, sem
  // atrasar o boot; roda uma vez só (trava NX no Redis) e loga o total
  void purgarFilasLegado().catch((error) =>
    log.error({ error: (error as Error).message }, "purga do legado falhou (workers seguem normais)"),
  );

  // desligamento educado: sem isso o Docker espera, desiste e o deploy do
  // EasyPanel falha com "container is running" na troca de versão
  const workers = [
    reservationWorker,
    outboxWorker,
    paymentWorker,
    orderWorker,
    notificationWorker,
    autoPayoutsWorker,
    webhookWorker,
    waitingRoomWorker,
    abandonedCartWorker,
  ];
  let encerrando = false;
  async function shutdown(signal: string) {
    if (encerrando) return;
    encerrando = true;
    log.info({ signal }, "encerrando workers…");
    await Promise.allSettled(workers.map((w) => w.close()));
    process.exit(0);
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  log.error({ error: error.message }, "falha ao iniciar worker");
  process.exit(1);
});
