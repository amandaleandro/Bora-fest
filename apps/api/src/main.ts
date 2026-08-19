import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { mkdirSync } from "node:fs";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { httpRequestDuration, httpRequestsTotal } from "@borafest/observability";
import { AppModule } from "./app.module";
import { UPLOADS_DIR } from "./uploads/uploads.constants";

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
  const provider = process.env.PAYMENTS_PROVIDER ?? "mock";
  const missing: string[] = [];

  if (provider === "pagarme") {
    if (!process.env.PAGARME_SECRET_KEY) missing.push("PAGARME_SECRET_KEY");
    const hasWebhookAuth =
      (process.env.PAGARME_WEBHOOK_BASIC_USER && process.env.PAGARME_WEBHOOK_BASIC_PASSWORD) ||
      process.env.PAGARME_WEBHOOK_SECRET;
    if (!hasWebhookAuth) missing.push("PAGARME_WEBHOOK_BASIC_USER/PASSWORD");
  } else if (provider === "asaas") {
    if (!process.env.ASAAS_API_KEY) missing.push("ASAAS_API_KEY");
    if (!process.env.ASAAS_WEBHOOK_TOKEN) missing.push("ASAAS_WEBHOOK_TOKEN");
  } else {
    return;
  }

  if (missing.length > 0) {
    throw new Error(
      `PAYMENTS_PROVIDER=${provider} exige: ${missing.join(", ")} — sem isso o webhook é recusado e o pedido nunca confirma`,
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

  // rota usa o path da definição (ex: /events/:id), não a URL crua, para não
  // explodir a cardinalidade das labels do Prometheus com IDs de recurso
  app.getHttpAdapter().getInstance().addHook("onResponse", (request: any, reply: any, done: any) => {
    const route = request.routeOptions?.url ?? request.raw.url;
    const labels = {
      method: request.method,
      route,
      status_code: String(reply.statusCode),
    };
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, reply.elapsedTime / 1000);
    done();
  });

  // uploads (banner de evento): multipart limitado + serviço estático dos
  // arquivos gravados em UPLOADS_DIR (volume no deploy)
  mkdirSync(UPLOADS_DIR, { recursive: true });
  await app.register(multipart as any, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });
  await app.register(fastifyStatic as any, {
    root: UPLOADS_DIR,
    prefix: "/uploads/",
    decorateReply: false,
    // cache imutável: o nome do arquivo muda a cada upload (timestamp+hash),
    // então o navegador/CDN pode guardar 1 ano sem revalidar
    maxAge: "365d",
    immutable: true,
  });

  const port = process.env.API_PORT ? Number(process.env.API_PORT) : 3333;
  await app.listen(port, "0.0.0.0");

  // desligamento educado: sem isso a troca de versão no EasyPanel trava com
  // "container is running" (mesmo sintoma corrigido no worker)
  let encerrando = false;
  const shutdown = async (signal: string) => {
    if (encerrando) return;
    encerrando = true;
    // se o close travar (conexões penduradas), sai mesmo assim em 8s
    setTimeout(() => process.exit(0), 8000).unref();
    await app.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

bootstrap();
