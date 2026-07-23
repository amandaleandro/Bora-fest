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
  NOTIFICATION_DELIVERY_JOB_ID,
  ORDER_EXPIRATION_JOB_ID,
  OUTBOX_DISPATCH_JOB_ID,
  PAYMENT_RECONCILIATION_JOB_ID,
  RESERVATION_RECONCILIATION_JOB_ID,
} from "@borafest/queues";
import { withContext } from "@borafest/observability";
import { expireReservation, reconcileExpiredReservations } from "./expire-reservation";
import { processOutboxBatch } from "./process-outbox";
import { reconcilePendingPayments } from "./reconcile-payments";
import { expireStaleOrders } from "./expire-orders";
import { deliverPendingNotifications } from "./deliver-notifications";

const log = withContext({ module: "worker" });

async function main() {
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

  // --- notificações: entrega de e-mail/WhatsApp ----------------------------
  const notificationWorker = createNotificationDeliveryWorker(async () => {
    await deliverPendingNotifications();
  });
  await createNotificationDeliveryQueue().upsertJobScheduler(
    NOTIFICATION_DELIVERY_JOB_ID,
    { every: 5_000 },
    { name: "deliver", data: {} },
  );

  for (const [name, worker] of [
    ["reservas", reservationWorker],
    ["outbox", outboxWorker],
    ["pagamentos", paymentWorker],
    ["pedidos", orderWorker],
    ["notificações", notificationWorker],
  ] as const) {
    worker.on("failed", (job, error) => {
      log.error({ queue: name, jobId: job?.id, error: error.message }, "job falhou");
    });
  }

  log.info("workers iniciados: reservas, outbox, pagamentos, pedidos e notificações");
}

main().catch((error) => {
  log.error({ error: error.message }, "falha ao iniciar worker");
  process.exit(1);
});
