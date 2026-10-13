import { Injectable } from "@nestjs/common";
import { confirmSaleInventory, prisma, Prisma } from "@borafest/database";

export type DbClient = typeof prisma | Prisma.TransactionClient;

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
   * para não haver overselling sob concorrência. Aceita um
   * client de transação para ser combinado com a criação da
   * reserva em uma única unidade atômica.
   */
  async tryReserve(lotId: string, quantity: number, client: DbClient = prisma): Promise<void> {
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

  async release(lotId: string, quantity: number, client: DbClient = prisma): Promise<void> {
    await client.$executeRaw(Prisma.sql`
      UPDATE ticket_lots
      SET reserved_count = GREATEST(reserved_count - ${quantity}, 0), updated_at = now()
      WHERE id = ${lotId}::uuid
    `);
  }

  /**
   * Converte reservado em vendido. VIRADA AUTOMÁTICA (2026-10-12): delega para
   * a operação única de @borafest/database — a mesma do pagamento, da cortesia
   * e da porta. Antes este método fazia o próprio UPDATE, e a lista de
   * convidados que esgotava o lote NÃO abria o lote seguinte (ele ficava
   * guardado para sempre). Na transação de quem chama, venda e virada entram
   * juntas; fora de uma, a operação abre a sua.
   */
  async confirmSale(lotId: string, quantity: number, client: DbClient = prisma): Promise<void> {
    await confirmSaleInventory(client, lotId, quantity);
  }

  async getAvailability(lotId: string, client: DbClient = prisma) {
    const lot = await client.ticketLot.findUnique({ where: { id: lotId } });
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
