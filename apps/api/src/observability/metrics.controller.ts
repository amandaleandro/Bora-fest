import { Controller, Get, Header, Headers, NotFoundException } from "@nestjs/common";
import { metricsRegistry } from "@borafest/observability";

@Controller("metrics")
export class MetricsController {
  /**
   * Métricas Prometheus NÃO são públicas (auditoria de segurança 2026-08-29):
   * expunham volume de requisições e, por rota não-normalizada, ids de recurso.
   * Exige `Authorization: Bearer $METRICS_TOKEN`; sem o token configurado, a
   * rota some (404) em vez de vazar. O scraper interno manda o header.
   */
  @Get()
  @Header("Content-Type", metricsRegistry.contentType)
  async metrics(@Headers("authorization") auth?: string) {
    const token = process.env.METRICS_TOKEN;
    if (!token || auth !== `Bearer ${token}`) {
      throw new NotFoundException();
    }
    return metricsRegistry.metrics();
  }
}
