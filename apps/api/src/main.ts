import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";

/**
 * Origens liberadas: em produção, allowlist explícita via CORS_ORIGINS
 * (separadas por vírgula). Com `credentials: true`, refletir qualquer origem
 * significa deixar qualquer site chamar a API em nome do usuário logado.
 */
function corsOrigins(): true | string[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (raw) return raw.split(",").map((o) => o.trim()).filter(Boolean);
  if (process.env.NODE_ENV === "production") {
    throw new Error("CORS_ORIGINS é obrigatório em produção (allowlist de domínios)");
  }
  return true; // dev: localhost em qualquer porta
}

/** Falha no boot em vez de aceitar venda que o gateway não vai honrar. */
function assertPaymentSecrets(): void {
  if ((process.env.PAYMENTS_PROVIDER ?? "mock") !== "pagarme") return;
  const missing = ["PAGARME_SECRET_KEY"].filter((k) => !process.env[k]);
  const hasWebhookAuth =
    (process.env.PAGARME_WEBHOOK_BASIC_USER && process.env.PAGARME_WEBHOOK_BASIC_PASSWORD) ||
    process.env.PAGARME_WEBHOOK_SECRET;
  if (!hasWebhookAuth) missing.push("PAGARME_WEBHOOK_BASIC_USER/PASSWORD");
  if (missing.length > 0) {
    throw new Error(
      `PAYMENTS_PROVIDER=pagarme exige: ${missing.join(", ")} — sem isso o webhook é recusado e o pedido nunca confirma`,
    );
  }
}

async function bootstrap() {
  assertPaymentSecrets();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      // só confia no X-Forwarded-For quando há proxy conhecido na frente
      // (Caddy) — sem isso o rate limit por IP é burlável com um header
      trustProxy: process.env.TRUST_PROXY === "true",
    }),
    // rawBody: necessário para verificar assinatura de webhooks de pagamento
    { rawBody: true },
  );

  app.enableCors({ origin: corsOrigins(), credentials: true });

  const port = process.env.API_PORT ? Number(process.env.API_PORT) : 3333;
  await app.listen(port, "0.0.0.0");
}

bootstrap();
