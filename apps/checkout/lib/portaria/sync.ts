import { portariaApi } from "./api";
import * as db from "./db";
import { buildIndex, EMPTY_INDEX, type ManifestIndex } from "./verify";
import type { ManifestMeta, QueueItem, Session } from "./types";

/**
 * Sincronização do manifesto e da fila offline. Todo erro de rede é silencioso
 * (a portaria segue operando com o que tem no aparelho); erro de autorização
 * sobe para quem chama, que mostra a tela "Acesso bloqueado".
 */

function newBatchKey(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return random;
  return `bf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Lê o manifesto guardado e monta o índice em memória usado pelo scanner. */
export async function loadIndex(session: Session): Promise<ManifestIndex> {
  if (!db.isDbAvailable()) return EMPTY_INDEX;
  try {
    const [meta, lots, tickets, queue] = await Promise.all([
      db.getManifestMeta(),
      db.getLots(),
      db.getAllTickets(),
      db.getQueue(),
    ]);
    if (!meta || meta.eventId !== session.event.id) return EMPTY_INDEX;
    return buildIndex({
      eventId: meta.eventId,
      publicKeyPem: meta.publicKeyPem,
      tickets,
      lots,
      queue,
    });
  } catch {
    return EMPTY_INDEX;
  }
}

/**
 * Baixa o manifesto. Faz o full na primeira vez (ou ao trocar de evento) e
 * delta (`since=manifestVersion`) nas demais. Devolve o índice atualizado.
 */
export async function syncManifest(session: Session): Promise<ManifestIndex> {
  if (!db.isDbAvailable()) return EMPTY_INDEX;

  const stored = await db.getManifestMeta().catch(() => undefined);
  const sameEvent = stored?.eventId === session.event.id;
  if (stored && !sameEvent) {
    await db.clearManifest().catch(() => undefined);
  }

  const response = await portariaApi.manifest(
    session,
    sameEvent ? stored?.manifestVersion : undefined,
  );

  const meta: Omit<ManifestMeta, "ticketCount"> = {
    eventId: session.event.id,
    eventTitle: response.event?.title ?? session.event.title,
    manifestVersion: response.manifestVersion,
    // o delta não repete a chave; preserva a que já está guardada
    publicKeyPem:
      response.signingKey?.publicKeyPem ?? (sameEvent ? (stored?.publicKeyPem ?? null) : null),
    syncedAt: new Date().toISOString(),
  };

  await db.saveManifest({
    tickets: response.tickets,
    lots: response.lots ?? [],
    meta,
    replaceAll: !response.delta,
  });

  return loadIndex(session);
}

export interface FlushOutcome {
  sent: number;
  confirmed: number;
  conflicts: number;
  invalid: number;
}

/**
 * Envia a fila em lotes idempotentes (POST /v1/checkins/sync). Item que o
 * servidor recusa NÃO é descartado: vira CONFLICT/INVALID e continua visível
 * no resumo para o organizador resolver.
 */
export async function flushQueue(session: Session): Promise<FlushOutcome | null> {
  if (!db.isDbAvailable()) return null;

  const queue = await db.getQueue();
  const pending = queue.filter((item) => item.state === "PENDING");
  if (pending.length === 0) {
    await db.setPendingBatch(null).catch(() => undefined);
    return null;
  }

  const total: FlushOutcome = { sent: 0, confirmed: 0, conflicts: 0, invalid: 0 };
  // reaproveita a chave de um lote interrompido: reenviar devolve o mesmo resultado
  const openBatch = await db.getPendingBatch().catch(() => undefined);

  for (let offset = 0; offset < pending.length; offset += 200) {
    const slice = pending.slice(offset, offset + 200);
    const reuse = openBatch && slice.some((item) => openBatch.seqs.includes(item.localSeq));
    const batchKey = reuse ? openBatch.key : newBatchKey();

    await db.setPendingBatch({ key: batchKey, seqs: slice.map((i) => i.localSeq) });

    const result = await portariaApi.sync(
      session,
      batchKey,
      slice.map((item) => ({
        localSeq: item.localSeq,
        ticketId: item.ticketId,
        checkinPointId: item.checkinPointId,
        scannedAt: item.scannedAt,
      })),
    );

    const confirmed: number[] = [];
    for (const item of result.items) {
      if (item.status === "CONFIRMED") confirmed.push(item.localSeq);
      else await db.setQueueState(item.localSeq, item.status);
    }
    if (confirmed.length > 0) await db.removeQueueItems(confirmed);
    await db.setPendingBatch(null);

    total.sent += result.received;
    total.confirmed += result.confirmed;
    total.conflicts += result.conflicts;
    total.invalid += result.invalid;
  }

  return total;
}

/** Enfileira um check-in feito offline e marca o ingresso como usado no aparelho. */
export async function enqueueCheckin(input: {
  ticketId: string;
  code: string;
  name: string | null;
  checkinPointId?: string;
  gateName: string | null;
}): Promise<QueueItem | null> {
  if (!db.isDbAvailable()) return null;
  const localSeq = await db.nextLocalSeq();
  const item: QueueItem = {
    localSeq,
    ticketId: input.ticketId,
    checkinPointId: input.checkinPointId,
    scannedAt: new Date().toISOString(),
    state: "PENDING",
    code: input.code,
    name: input.name,
    gateName: input.gateName,
  };
  await db.enqueue(item);
  await db.markTicketCheckedIn(input.ticketId, item.scannedAt);
  return item;
}
