import { prisma, Prisma } from "@borafest/database";

type DbClient = typeof prisma | Prisma.TransactionClient;

export async function releaseInventory(lotId: string, quantity: number, client: DbClient = prisma) {
  await client.$executeRaw(Prisma.sql`
    UPDATE ticket_lots
    SET reserved_count = GREATEST(reserved_count - ${quantity}, 0), updated_at = now()
    WHERE id = ${lotId}::uuid
  `);
}
