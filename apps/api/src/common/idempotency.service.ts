import { ConflictException, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { createHash } from "crypto";
import { prisma, Prisma } from "@borafest/database";

/**
 * Idempotência de requisições via header `Idempotency-Key` (arquitetura §11).
 * A primeira chamada executa e grava a resposta; repetições com o mesmo key e
 * mesmo payload recebem a resposta gravada; payload diferente é rejeitado.
 */
@Injectable()
export class IdempotencyService {
  hashRequest(payload: unknown): string {
    return createHash("sha256").update(JSON.stringify(payload ?? {})).digest("hex");
  }

  async run<T>(
    key: string | undefined,
    scope: string,
    payload: unknown,
    handler: () => Promise<T>,
  ): Promise<T> {
    if (!key) return handler();

    const requestHash = this.hashRequest(payload);

    try {
      await prisma.idempotencyKey.create({
        data: { key, scope, requestHash, lockedAt: new Date() },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.idempotencyKey.findUnique({ where: { key } });
        if (!existing) throw error;
        if (existing.requestHash !== requestHash) {
          throw new UnprocessableEntityException(
            "Idempotency-Key reutilizada com payload diferente",
          );
        }
        if (existing.completedAt) {
          return existing.responseBody as T;
        }
        throw new ConflictException("Requisição com esta Idempotency-Key ainda em processamento");
      }
      throw error;
    }

    try {
      const response = await handler();
      await prisma.idempotencyKey.update({
        where: { key },
        data: {
          completedAt: new Date(),
          responseBody: response as Prisma.InputJsonValue,
          statusCode: 200,
        },
      });
      return response;
    } catch (error) {
      // libera o key para retry — a falha não deve travar o cliente para sempre
      await prisma.idempotencyKey.delete({ where: { key } }).catch(() => undefined);
      throw error;
    }
  }
}
