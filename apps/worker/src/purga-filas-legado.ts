import { getRedisConnection } from "@borafest/queues";
import {
  createOutboxDispatchQueue,
  createWaitingRoomSweepQueue,
  createNotificationDeliveryQueue,
  createOrderExpirationQueue,
  createReservationExpirationQueue,
  createPaymentReconciliationQueue,
  createAutoPayoutsQueue,
  createAbandonedCartQueue,
  createPaymentWebhookProcessingQueue,
} from "@borafest/queues";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "purga-filas" });
const FLAG = "bf:filas:purga-2026-08-30";

/**
 * Purga ONE-SHOT do legado (incidente de performance 2026-08-30): ~2,4M de
 * jobs concluídos acumulados antes do removeOnComplete existir. Roda uma única
 * vez (trava por SET NX no Redis), em background depois do boot, usando
 * queue.clean() — que só toca completed/failed e NUNCA os jobs delayed reais
 * (expiração de reservas) nem os schedulers. FLUSHDB/obliterate são proibidos.
 */
export async function purgarFilasLegado(): Promise<void> {
  const redis = getRedisConnection();
  const primeira = await redis.set(FLAG, new Date().toISOString(), "NX");
  if (primeira === null) {
    log.info({}, "purga do legado já executada antes — nada a fazer");
    return;
  }

  const filas = [
    createOutboxDispatchQueue(),
    createWaitingRoomSweepQueue(),
    createNotificationDeliveryQueue(),
    createOrderExpirationQueue(),
    createReservationExpirationQueue(),
    createPaymentReconciliationQueue(),
    createAutoPayoutsQueue(),
    createAbandonedCartQueue(),
    createPaymentWebhookProcessingQueue(),
  ];

  let totalLimpo = 0;
  for (const fila of filas) {
    try {
      let rodada: string[];
      do {
        rodada = await fila.clean(0, 5000, "completed");
        totalLimpo += rodada.length;
        if (rodada.length > 0) log.info({ fila: fila.name, lote: rodada.length }, "purga: lote de completed removido");
      } while (rodada.length === 5000);
      // failed: mantém 24h pra forense
      const falhosLimpos = await fila.clean(24 * 3600 * 1000, 5000, "failed");
      totalLimpo += falhosLimpos.length;
    } catch (error) {
      log.error({ fila: fila.name, error: (error as Error).message }, "purga: falha numa fila (segue para a próxima)");
    } finally {
      await fila.close().catch(() => undefined);
    }
  }
  log.info({ totalLimpo }, "purga do legado concluída — Redis liberado");
}
