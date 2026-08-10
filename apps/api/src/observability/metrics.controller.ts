import { Controller, Get, Header } from "@nestjs/common";
import { metricsRegistry } from "@borafest/observability";

@Controller("metrics")
export class MetricsController {
  @Get()
  @Header("Content-Type", metricsRegistry.contentType)
  async metrics() {
    return metricsRegistry.metrics();
  }
}
