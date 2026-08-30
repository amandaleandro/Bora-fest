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

/**
 * Em produção não pode subir com gateway de mentira nem log de OTP em claro
 * (auditoria de segurança 2026-08-29): MockGateway aprova qualquer cartão na
 * hora e WHATSAPP_PROVIDER=devlog grava o código OTP no log.
 */
function assertProductionProviders(): void {
  if (process.env.NODE_ENV !== "production") return;
  const proibidos: string[] = [];
  if ((process.env.PAYMENTS_PROVIDER ?? "mock") === "mock") proibidos.push("PAYMENTS_PROVIDER=mock (aprova qualquer pagamento)");
  if (process.env.WHATSAPP_PROVIDER === "devlog") proibidos.push("WHATSAPP_PROVIDER=devlog (grava OTP/telefone no log)");
  if (proibidos.length > 0) {
    throw new Error(`Configuração insegura para produção: ${proibidos.join("; ")}`);
  }
}

/**
 * TRUST_PROXY: número de saltos de proxy à frente da API (1 = só o Caddy).
 * Devolver o IP real do cliente exige contar os hops, não confiar em todos.
 */
function resolveTrustProxy(): number | boolean {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === "true") return 1; // legado: 1 salto, seguro
  return false;
}

async function bootstrap() {
  assertProductionProviders();
  assertPaymentSecrets();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      // NÚMERO DE SALTOS de proxy, não booleano (auditoria 2026-08-30): com
      // `trustProxy: true` o Fastify confia em QUALQUER proxy e devolve o
      // X-Forwarded-For MAIS À ESQUERDA — que é o que o cliente forja. Aí o
      // rate limit por IP continuava burlável. Com um número (n saltos), o
      // request.ip é o IP real que o proxy confiável (Caddy) viu. Legado
      // "true" passa a valer 1 salto (seguro). Setar TRUST_PROXY=1 no servidor.
      trustProxy: resolveTrustProxy(),
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
