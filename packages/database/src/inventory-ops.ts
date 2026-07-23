import { Prisma, PrismaClient } from "@prisma/client";

export type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Operações atômicas de estoque (fonte de verdade: Postgres).
 * Compartilhadas por API e workers para nunca divergirem.
 */

export class InsufficientStockError extends Error {
  constructor(lotId: string) {
    super(`Estoque insuficiente para o lote ${lotId}`);
  }
}

/** Reserva unidades somente se vendidos + reservados + qtd <= capacidade. */
export async function reserveInventory(
  client: DbClient,
  lotId: string,
  quantity: number,
): Promise<void> {
  const rows = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE ticket_lots
    SET reserved_count = reserved_count + ${quantity}, updated_at = now()
    WHERE id = ${lotId}::uuid
      AND status = 'ACTIVE'
      AND (sold_count + reserved_count + ${quantity}) <= capacity
    RETURNING id
  `);
  if (rows.length === 0) {
    throw new InsufficientStockError(lotId);
  }
}

/** Devolve unidades reservadas ao estoque disponível. */
export async function releaseInventory(
  client: DbClient,
  lotId: string,
  quantity: number,
): Promise<void> {
  await client.$executeRaw(Prisma.sql`
    UPDATE ticket_lots
    SET reserved_count = GREATEST(reserved_count - ${quantity}, 0), updated_at = now()
    WHERE id = ${lotId}::uuid
  `);
}

/** Converte unidades reservadas em vendidas (pagamento aprovado). */
export async function confirmSaleInventory(
  client: DbClient,
  lotId: string,
  quantity: number,
): Promise<void> {
  await client.$executeRaw(Prisma.sql`
    UPDATE ticket_lots
    SET reserved_count = GREATEST(reserved_count - ${quantity}, 0),
        sold_count = sold_count + ${quantity},
        updated_at = now()
    WHERE id = ${lotId}::uuid
  `);
}
