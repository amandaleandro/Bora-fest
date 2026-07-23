import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    // rawBody: necessário para verificar assinatura de webhooks de pagamento
    { rawBody: true },
  );

  app.enableCors({ origin: true, credentials: true });

  const port = process.env.API_PORT ? Number(process.env.API_PORT) : 3333;
  await app.listen(port, "0.0.0.0");
}

bootstrap();
