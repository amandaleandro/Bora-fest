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
import { sendAbandonedCartReminders } from "./abandoned-cart";

const log = withContext({ module: "worker" });

async function main() {
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
    { name: "reconcile", data: {} as any },
  );

  // --- outbox: emissão de ingressos, estornos de órfãos, revogações --------
  const outboxWorker = createOutboxDispatchWorker(async () => {
    await processOutboxBatch();
  });
  await createOutboxDispatchQueue().upsertJobScheduler(
    OUTBOX_DISPATCH_JOB_ID,
    { every: 3_000 },
    { name: "dispatch", data: {} },
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
    { name: "sweep", data: {} },
  );

  // --- pagamentos: reconciliação com o gateway -----------------------------
  const paymentWorker = createPaymentReconciliationWorker(async () => {
    await reconcilePendingPayments();
  });
  await createPaymentReconciliationQueue().upsertJobScheduler(
    PAYMENT_RECONCILIATION_JOB_ID,
    { every: 60_000 },
    { name: "reconcile", data: {} },
  );

  // --- pedidos: expiração da janela de pagamento ---------------------------
  const orderWorker = createOrderExpirationWorker(async () => {
    await expireStaleOrders();
  });
  await createOrderExpirationQueue().upsertJobScheduler(
    ORDER_EXPIRATION_JOB_ID,
    { every: 30_000 },
    { name: "expire", data: {} },
  );

  // --- carrinho abandonado: lembrete de pedido pendente não pago -----------
  const abandonedCartWorker = createAbandonedCartWorker(async () => {
    await sendAbandonedCartReminders();
  });
  await createAbandonedCartQueue().upsertJobScheduler(
    ABANDONED_CART_JOB_ID,
    { every: 5 * 60_000 },
    { name: "remind", data: {} },
  );

  // --- notificações: entrega de e-mail/WhatsApp ----------------------------
  const notificationWorker = createNotificationDeliveryWorker(async () => {
    await deliverPendingNotifications();
  });
  await createNotificationDeliveryQueue().upsertJobScheduler(
    NOTIFICATION_DELIVERY_JOB_ID,
    { every: 5_000 },
    { name: "deliver", data: {} },
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
    { every: 2_000 },
    { name: "sweep", data: {} },
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
