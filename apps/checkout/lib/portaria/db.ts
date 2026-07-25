import type { ManifestLot, ManifestMeta, ManifestTicket, QueueItem, QueueState } from "./types";

/**
 * Wrapper mínimo de IndexedDB para a portaria (sem libs externas de idb).
 * Guarda o manifesto (chave pública + lotes + ingressos) e a fila offline —
 * é o que permite validar de verdade sem rede.
 */

const DB_NAME = "borafest-portaria";
const DB_VERSION = 1;
const META = "meta";
const TICKETS = "tickets";
const QUEUE = "queue";

const KEY_MANIFEST = "manifest";
const KEY_LOTS = "lots";
const KEY_SEQ = "nextLocalSeq";
const KEY_BATCH = "pendingBatch";
const KEY_COUNT = "gateCount";

let dbPromise: Promise<IDBDatabase> | null = null;

export function isDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!isDbAvailable()) {
      reject(new Error("IndexedDB indisponível neste navegador"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      if (!db.objectStoreNames.contains(TICKETS)) {
        const store = db.createObjectStore(TICKETS, { keyPath: "id" });
        store.createIndex("code", "code", { unique: false });
      }
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: "localSeq" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha ao abrir o banco local"));
  });
  // uma falha não pode congelar o app para sempre: permite nova tentativa
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Erro no banco local"));
  });
}

async function tx<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  const transaction = db.transaction(stores, mode);
  const result = await run(transaction);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Transação falhou"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Transação abortada"));
  });
  return result;
}

// --- meta -------------------------------------------------------------------

export function getMeta<T>(key: string): Promise<T | undefined> {
  return tx(META, "readonly", (t) => promisify<T | undefined>(t.objectStore(META).get(key)));
}

export function setMeta(key: string, value: unknown): Promise<void> {
  return tx(META, "readwrite", (t) => {
    t.objectStore(META).put(value, key);
  });
}

// --- manifesto --------------------------------------------------------------

export function getManifestMeta(): Promise<ManifestMeta | undefined> {
  return getMeta<ManifestMeta>(KEY_MANIFEST);
}

export function getLots(): Promise<ManifestLot[]> {
  return getMeta<ManifestLot[]>(KEY_LOTS).then((l) => l ?? []);
}

/**
 * Grava um lote de ingressos (full ou delta) e o novo carimbo do manifesto na
 * MESMA transação — se algo falhar no meio, a versão local não avança e o
 * próximo delta rebusca a partir do ponto anterior.
 */
export function saveManifest(input: {
  tickets: ManifestTicket[];
  lots: ManifestLot[];
  meta: Omit<ManifestMeta, "ticketCount">;
  replaceAll: boolean;
}): Promise<void> {
  return tx([META, TICKETS], "readwrite", async (t) => {
    const tickets = t.objectStore(TICKETS);
    if (input.replaceAll) tickets.clear();
    for (const ticket of input.tickets) tickets.put(ticket);
    const ticketCount = await promisify<number>(tickets.count());
    const meta = t.objectStore(META);
    meta.put({ ...input.meta, ticketCount }, KEY_MANIFEST);
    if (input.lots.length > 0) meta.put(input.lots, KEY_LOTS);
  });
}

export function getAllTickets(): Promise<ManifestTicket[]> {
  return tx(TICKETS, "readonly", (t) =>
    promisify<ManifestTicket[]>(t.objectStore(TICKETS).getAll()),
  );
}

/** Marca o ingresso como usado no aparelho, para o 2º scan já cair em "Já utilizado". */
export function markTicketCheckedIn(ticketId: string, at: string): Promise<void> {
  return tx(TICKETS, "readwrite", async (t) => {
    const store = t.objectStore(TICKETS);
    const ticket = await promisify<ManifestTicket | undefined>(store.get(ticketId));
    if (!ticket) return;
    store.put({ ...ticket, status: "CHECKED_IN", checkedInAt: at });
  });
}

/** Apaga tudo do evento anterior — troca de PIN/evento não pode misturar listas. */
export function clearManifest(): Promise<void> {
  return tx([META, TICKETS], "readwrite", (t) => {
    t.objectStore(TICKETS).clear();
    const meta = t.objectStore(META);
    meta.delete(KEY_MANIFEST);
    meta.delete(KEY_LOTS);
    meta.delete(KEY_COUNT);
  });
}

// --- fila offline -----------------------------------------------------------

/** Reserva o próximo localSeq. Nunca reaproveita: (deviceId, localSeq) é único no servidor. */
export function nextLocalSeq(): Promise<number> {
  return tx(META, "readwrite", async (t) => {
    const store = t.objectStore(META);
    const current = (await promisify<number | undefined>(store.get(KEY_SEQ))) ?? 0;
    const next = current + 1;
    store.put(next, KEY_SEQ);
    return next;
  });
}

export function enqueue(item: QueueItem): Promise<void> {
  return tx(QUEUE, "readwrite", (t) => {
    t.objectStore(QUEUE).put(item);
  });
}

export function getQueue(): Promise<QueueItem[]> {
  return tx(QUEUE, "readonly", (t) => promisify<QueueItem[]>(t.objectStore(QUEUE).getAll())).then(
    (items) => items.sort((a, b) => a.localSeq - b.localSeq),
  );
}

export function removeQueueItems(seqs: number[]): Promise<void> {
  return tx(QUEUE, "readwrite", (t) => {
    const store = t.objectStore(QUEUE);
    for (const seq of seqs) store.delete(seq);
  });
}

export function setQueueState(seq: number, state: QueueState): Promise<void> {
  return tx(QUEUE, "readwrite", async (t) => {
    const store = t.objectStore(QUEUE);
    const item = await promisify<QueueItem | undefined>(store.get(seq));
    if (!item) return;
    store.put({ ...item, state });
  });
}

export interface PendingBatch {
  key: string;
  seqs: number[];
}

export function getPendingBatch(): Promise<PendingBatch | undefined> {
  return getMeta<PendingBatch>(KEY_BATCH);
}

export function setPendingBatch(batch: PendingBatch | null): Promise<void> {
  return tx(META, "readwrite", (t) => {
    if (batch) t.objectStore(META).put(batch, KEY_BATCH);
    else t.objectStore(META).delete(KEY_BATCH);
  });
}

// --- contador do portão -----------------------------------------------------

export function getGateCount(): Promise<number> {
  return getMeta<number>(KEY_COUNT).then((v) => v ?? 0);
}

export function bumpGateCount(delta: number): Promise<number> {
  return tx(META, "readwrite", async (t) => {
    const store = t.objectStore(META);
    const current = (await promisify<number | undefined>(store.get(KEY_COUNT))) ?? 0;
    const next = Math.max(0, current + delta);
    store.put(next, KEY_COUNT);
    return next;
  });
}
