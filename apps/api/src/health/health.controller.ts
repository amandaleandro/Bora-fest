import { Controller, Get } from "@nestjs/common";
import { prisma } from "@borafest/database";

@Controller("health")
export class HealthController {
  @Get()
  async check() {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", db: "up", timestamp: new Date().toISOString() };
  }
}
