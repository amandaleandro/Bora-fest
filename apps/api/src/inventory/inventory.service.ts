import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@borafest/database";

export class InsufficientStockError extends Error {
  constructor(lotId: string) {
    super(`Estoque insuficiente para o lote ${lotId}`);
  }
}

@Injectable()
export class InventoryService {
  /**
   * Decremento atômico de estoque: só reserva se
   * vendidos + reservados + quantidade <= capacidade,
   * checado e atualizado em uma única instrução no Postgres
   * para não haver overselling sob concorrência.
   */
  async tryReserve(lotId: string, quantity: number): Promise<void> {
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
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

  async release(lotId: string, quantity: number): Promise<void> {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE ticket_lots
      SET reserved_count = GREATEST(reserved_count - ${quantity}, 0), updated_at = now()
      WHERE id = ${lotId}::uuid
    `);
  }

  async confirmSale(lotId: string, quantity: number): Promise<void> {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE ticket_lots
      SET reserved_count = GREATEST(reserved_count - ${quantity}, 0),
          sold_count = sold_count + ${quantity},
          updated_at = now()
      WHERE id = ${lotId}::uuid
    `);
  }

  async getAvailability(lotId: string) {
    const lot = await prisma.ticketLot.findUnique({ where: { id: lotId } });
    if (!lot) return null;

    return {
      lotId: lot.id,
      capacity: lot.capacity,
      sold: lot.soldCount,
      reserved: lot.reservedCount,
      available: Math.max(lot.capacity - lot.soldCount - lot.reservedCount, 0),
      status: lot.status,
    };
  }
}
