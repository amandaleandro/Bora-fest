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

    // CHAVE COMPOSTA POR ESCOPO (2026-09-15). A mesma Idempotency-Key vinda do
    // aparelho servia rotas diferentes: um Pix que falhou no gateway deixava a
    // chave gravada com o pedido PENDENTE, e o toque em Dinheiro logo depois
    // (mesma chave) recebia esse pedido pendente de volta — o cliente pagava em
    // dinheiro e ficava sem ingresso. Cada escopo ganha a própria linha; um
    // retry da MESMA rota continua idempotente.
    const id = `${scope}:${key}`;
    const requestHash = this.hashRequest(payload);

    try {
      await prisma.idempotencyKey.create({
        data: { key: id, scope, requestHash, lockedAt: new Date() },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.idempotencyKey.findUnique({ where: { key: id } });
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
        where: { key: id },
        data: {
          completedAt: new Date(),
          responseBody: response as Prisma.InputJsonValue,
          statusCode: 200,
        },
      });
      return response;
    } catch (error) {
      // libera o key para retry — a falha não deve travar o cliente para sempre
      await prisma.idempotencyKey.delete({ where: { key: id } }).catch(() => undefined);
      throw error;
    }
  }
}
