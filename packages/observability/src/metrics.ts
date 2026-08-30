import { createServer } from "node:http";
import client from "prom-client";

export const metricsRegistry = new client.Registry();
client.collectDefaultMetrics({ register: metricsRegistry });

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duração das requisições HTTP em segundos",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total de requisições HTTP",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [metricsRegistry],
});

export const jobsCompletedTotal = new client.Counter({
  name: "queue_jobs_completed_total",
  help: "Total de jobs concluídos por fila",
  labelNames: ["queue"] as const,
  registers: [metricsRegistry],
});

export const jobsFailedTotal = new client.Counter({
  name: "queue_jobs_failed_total",
  help: "Total de jobs que falharam por fila",
  labelNames: ["queue"] as const,
  registers: [metricsRegistry],
});

export const jobDuration = new client.Histogram({
  name: "queue_job_duration_seconds",
  help: "Duração dos jobs em segundos, por fila",
  labelNames: ["queue"] as const,
  buckets: [0.05, 0.1, 0.5, 1, 5, 10, 30, 60],
  registers: [metricsRegistry],
});

/** Sobe um servidor HTTP só para expor /metrics — usado por processos sem servidor HTTP próprio (worker). */
export function startMetricsServer(port: number) {
  const server = createServer(async (req, res) => {
    // exige token (auditoria 2026-08-30): mesma protecao da API — sem
    // METRICS_TOKEN a rota some (404), senao qualquer um le a telemetria
    const token = process.env.METRICS_TOKEN;
    if (req.url !== "/metrics" || !token || req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": metricsRegistry.contentType });
    res.end(await metricsRegistry.metrics());
  });
  server.listen(port, "0.0.0.0");
  return server;
}
