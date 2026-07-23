import {
  createReservationExpirationQueue,
  createReservationExpirationWorker,
} from "@borafest/queues";
import { withContext } from "@borafest/observability";
import { expireReservation, reconcileExpiredReservations } from "./expire-reservation";

const log = withContext({ module: "worker" });

async function main() {
  const worker = createReservationExpirationWorker(async (job) => {
    if (job.name === "reconcile") {
      await reconcileExpiredReservations();
      return;
    }
    await expireReservation(job.data.reservationId);
  });

  worker.on("failed", (job, error) => {
    log.error({ jobId: job?.id, error: error.message }, "job de expiração falhou");
  });

  const queue = createReservationExpirationQueue();
  await queue.upsertJobScheduler(
    "reconcile-expired-reservations",
    { every: 60_000 },
    { name: "reconcile", data: {} as any },
  );

  log.info("worker de expiração de reservas iniciado");
}

main().catch((error) => {
  log.error({ error: error.message }, "falha ao iniciar worker");
  process.exit(1);
});
