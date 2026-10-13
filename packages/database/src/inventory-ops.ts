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

/**
 * Converte unidades reservadas em vendidas (pagamento aprovado).
 *
 * VIRADA AUTOMÁTICA (2026-10-12): se esta venda ESGOTA o lote (vendidos >=
 * capacidade), os lotes guardados que esperavam por ele abrem na MESMA
 * transação — ou a venda e a virada acontecem juntas, ou nenhuma. Quem chama
 * passa a transação da venda (todos os chamadores já passam); chamado fora de
 * uma, abre a sua própria para não deixar a venda sem a virada.
 */
export async function confirmSaleInventory(
  client: DbClient,
  lotId: string,
  quantity: number,
): Promise<void> {
  if (ehClienteRaiz(client)) {
    await client.$transaction((tx) => confirmSaleInventory(tx, lotId, quantity));
    return;
  }
  const rows = await client.$queryRaw<{ sold_count: number; capacity: number }[]>(Prisma.sql`
    UPDATE ticket_lots
    SET reserved_count = GREATEST(reserved_count - ${quantity}, 0),
        sold_count = sold_count + ${quantity},
        updated_at = now()
    WHERE id = ${lotId}::uuid
    RETURNING sold_count, capacity
  `);
  const lote = rows[0];
  if (lote && Number(lote.sold_count) >= Number(lote.capacity)) {
    await abrirLotesSeguintes(client, lotId, "esgotado");
  }
}

/** O que fez o lote anterior liberar a vez dos seguintes. */
export type GatilhoDaVirada = "esgotado" | "encerrado" | "data";

export type LoteAbertoNaVirada = { id: string; name: string; eventId: string; organizationId: string };

/**
 * VIRADA AUTOMÁTICA (2026-10-12): abre (DRAFT → ACTIVE) os lotes que esperavam
 * `lotId` esgotar ou ser encerrado, e grava um 'lot.activate' por lote aberto
 * (sem ator: foi o sistema; motivo 'virada automática').
 *
 * Uma instrução só decide quem abre: só lote ainda DRAFT entra, então rodar
 * de novo (outra venda do lote já esgotado, encerrar depois de esgotar) não
 * abre nada nem suja o histórico. O UPDATE trava a linha de cada lote aberto
 * até o fim da transação de quem chamou.
 */
export async function abrirLotesSeguintes(
  client: DbClient,
  lotId: string,
  gatilho: GatilhoDaVirada,
): Promise<LoteAbertoNaVirada[]> {
  const abertos = await client.$queryRaw<
    { id: string; name: string; event_id: string; organization_id: string }[]
  >(Prisma.sql`
    UPDATE ticket_lots AS seguinte
    SET status = 'ACTIVE', updated_at = now()
    FROM ticket_types AS tipo
    JOIN events AS evento ON evento.id = tipo.event_id
    WHERE seguinte.activate_after_lot_id = ${lotId}::uuid
      AND seguinte.status = 'DRAFT'
      AND tipo.id = seguinte.ticket_type_id
    RETURNING seguinte.id, seguinte.name, tipo.event_id, evento.organization_id
  `);
  if (abertos.length === 0) return [];
  await client.auditLog.createMany({
    data: abertos.map((lote) => ({
      actorUserId: null,
      organizationId: lote.organization_id,
      action: "lot.activate",
      entityType: "ticket_lot",
      entityId: lote.id,
      metadata: {
        eventId: lote.event_id,
        name: lote.name,
        de: "DRAFT",
        para: "ACTIVE",
        motivo: "virada automática",
        anterior: lotId,
        gatilho,
      },
    })),
  });
  return abertos.map((lote) => ({
    id: lote.id,
    name: lote.name,
    eventId: lote.event_id,
    organizationId: lote.organization_id,
  }));
}

/**
 * VIRADA PELA DATA (revisão 2026-10-13): o lote anterior que chega no "Para
 * de vender" (ends_at) sem esgotar continuava ACTIVE e fora da janela — some
 * do site, mas a virada só olhava esgotar/encerrar, então o seguinte ficava
 * guardado para sempre e o ingresso sem lote à venda. O worker chama a cada
 * minuto: cada anterior vencido abre os seus seguintes, com a linha dele
 * travada (mesma ordem do encerrar). Idempotente (só abre DRAFT); numa fila
 * em cadeia, o seguinte que também já venceu abre o próximo na rodada
 * seguinte.
 */
export async function abrirSeguintesDeLotesVencidos(
  client: PrismaClient,
  agora: Date = new Date(),
): Promise<LoteAbertoNaVirada[]> {
  const vencidos = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT DISTINCT anterior.id
    FROM ticket_lots AS anterior
    JOIN ticket_lots AS seguinte
      ON seguinte.activate_after_lot_id = anterior.id AND seguinte.status = 'DRAFT'
    JOIN ticket_types AS tipo ON tipo.id = anterior.ticket_type_id
    JOIN events AS evento ON evento.id = tipo.event_id
    WHERE anterior.status = 'ACTIVE'
      AND anterior.ends_at IS NOT NULL
      AND anterior.ends_at <= (${agora}::timestamptz AT TIME ZONE 'UTC')
      -- só evento publicado que ainda não terminou: o "Para de vender" do
      -- último lote costuma ser o fim do evento, e abrir lote de evento
      -- passado ou cancelado só sujaria o histórico (revisão 2026-10-13)
      AND evento.status = 'PUBLISHED'
      AND evento.ends_at > (${agora}::timestamptz AT TIME ZONE 'UTC')
    LIMIT 200
  `);
  const abertos: LoteAbertoNaVirada[] = [];
  for (const { id } of vencidos) {
    const daVez = await client.$transaction(async (tx) => {
      // confere de novo com a linha travada: o produtor pode ter mudado a data
      // (ou encerrado o lote) entre a busca e aqui
      const ainda = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM ticket_lots
        WHERE id = ${id}::uuid AND status = 'ACTIVE' AND ends_at IS NOT NULL
          AND ends_at <= (${agora}::timestamptz AT TIME ZONE 'UTC')
        FOR UPDATE
      `);
      return ainda.length > 0 ? abrirLotesSeguintes(tx, id, "data") : [];
    });
    abertos.push(...daVez);
  }
  return abertos;
}

/** Cliente "raiz" (fora de transação): a transação interativa não tem $transaction. */
function ehClienteRaiz(client: DbClient): client is PrismaClient {
  return typeof (client as PrismaClient).$transaction === "function";
}

/** Devolve unidades vendidas ao estoque disponível (estorno/chargeback). */
export async function returnSaleInventory(
  client: DbClient,
  lotId: string,
  quantity: number,
): Promise<void> {
  await client.$executeRaw(Prisma.sql`
    UPDATE ticket_lots
    SET sold_count = GREATEST(sold_count - ${quantity}, 0), updated_at = now()
    WHERE id = ${lotId}::uuid
  `);
}
