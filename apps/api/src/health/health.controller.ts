import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { getRedisConnection } from "@borafest/queues";
import { withContext } from "@borafest/observability";
import { WORKER_HEARTBEAT_KEY, verificarSaude, type DependenciasSaude } from "./health.checks";

const log = withContext({ module: "health" });

/** Consultas reais usadas pelo /health (a lógica fica em health.checks.ts). */
const dependenciasReais: DependenciasSaude = {
  pingBanco: () => prisma.$queryRaw`SELECT 1`,
  redisPronto: () => getRedisConnection().status === "ready",
  lerBatida: () => getRedisConnection().get(WORKER_HEARTBEAT_KEY),
};

@Controller("health")
export class HealthController {
  /**
   * 200 com {"status":"ok","db":"up",...} quando banco, Redis e worker estão
   * vivos; 503 com a lista de motivos quando algum falha (2026-10-12 — antes
   * só o banco era testado e Redis fora/worker parado apareciam como "ok").
   * Quem lê: monitor externo (UptimeRobot/BetterStack) e
   * infra/scripts/healthcheck-alert.sh. Não use esta rota como healthcheck de
   * contêiner que tira a API do ar: worker parado não é motivo para derrubar
   * a venda.
   */
  @Get()
  async check() {
    const { ok, corpo } = await verificarSaude(dependenciasReais);
    if (!ok) {
      log.error(
        { db: corpo.db, redis: corpo.redis, worker: corpo.worker, motivos: corpo.motivos },
        "health com falha",
      );
      throw new ServiceUnavailableException(corpo);
    }
    return corpo;
  }
}
