import { isTicketToken, parseTicketTokenPayload, verifyTicketTokenSignature } from "./crypto";
import type { ManifestLot, ManifestTicket, QueueItem, ScanResult } from "./types";

/**
 * Índice em memória do manifesto — carregado do IndexedDB ao entrar no scanner.
 * `localCheckins` vem da fila offline: um ingresso já validado no aparelho
 * precisa reprovar no 2º scan mesmo que o delta do servidor ainda não saiba.
 */
export interface ManifestIndex {
  eventId: string;
  publicKeyPem: string | null;
  byId: Map<string, ManifestTicket>;
  byCode: Map<string, ManifestTicket>;
  lots: Map<string, ManifestLot>;
  localCheckins: Map<string, { at: string; gate: string | null }>;
  ready: boolean;
}

export const EMPTY_INDEX: ManifestIndex = {
  eventId: "",
  publicKeyPem: null,
  byId: new Map(),
  byCode: new Map(),
  lots: new Map(),
  localCheckins: new Map(),
  ready: false,
};

export function buildIndex(input: {
  eventId: string;
  publicKeyPem: string | null;
  tickets: ManifestTicket[];
  lots: ManifestLot[];
  queue: QueueItem[];
}): ManifestIndex {
  const byId = new Map<string, ManifestTicket>();
  const byCode = new Map<string, ManifestTicket>();
  for (const ticket of input.tickets) {
    byId.set(ticket.id, ticket);
    byCode.set(ticket.code.toUpperCase(), ticket);
  }
  const localCheckins = new Map<string, { at: string; gate: string | null }>();
  for (const item of input.queue) {
    // itens INVALID (o servidor não achou o ingresso) não bloqueiam nova tentativa
    if (item.state === "INVALID") continue;
    localCheckins.set(item.ticketId, { at: item.scannedAt, gate: item.gateName });
  }
  return {
    eventId: input.eventId,
    publicKeyPem: input.publicKeyPem,
    byId,
    byCode,
    lots: new Map(input.lots.map((l) => [l.id, l])),
    localCheckins,
    // sem chave pública ou sem lista de ingressos não há verificação possível
    ready: Boolean(input.publicKeyPem) && byId.size > 0,
  };
}

export function lotLabel(index: ManifestIndex, ticketLotId: string): string | null {
  const lot = index.lots.get(ticketLotId);
  return lot ? `${lot.typeName} — ${lot.name}` : null;
}

/**
 * Verificação 100% local. Regra inegociável da v2: sem manifesto sincronizado
 * o resultado é UNVERIFIED — jamais VALID.
 */
export function verifyLocally(
  input: { qrToken?: string; code?: string; ticketId?: string },
  index: ManifestIndex,
): ScanResult {
  if (!index.ready) {
    return { kind: "UNVERIFIED", offline: true };
  }

  let ticket: ManifestTicket | undefined;

  if (input.qrToken) {
    if (!isTicketToken(input.qrToken)) {
      return { kind: "INVALID", reason: "MALFORMED", offline: true };
    }
    if (!index.publicKeyPem) {
      return { kind: "UNVERIFIED", offline: true };
    }
    if (!verifyTicketTokenSignature(input.qrToken, index.publicKeyPem)) {
      return { kind: "INVALID", reason: "BAD_SIGNATURE", offline: true };
    }
    const payload = parseTicketTokenPayload(input.qrToken);
    if (!payload) return { kind: "INVALID", reason: "MALFORMED", offline: true };
    if (payload.eid !== index.eventId) {
      return { kind: "INVALID", reason: "OTHER_EVENT", offline: true };
    }
    ticket = index.byId.get(payload.tid);
  } else if (input.ticketId) {
    ticket = index.byId.get(input.ticketId);
  } else if (input.code) {
    ticket = index.byCode.get(input.code.trim().toUpperCase());
  }

  if (!ticket) return { kind: "INVALID", reason: "NOT_FOUND", offline: true };

  const base = {
    offline: true as const,
    ticketId: ticket.id,
    code: ticket.code,
    name: ticket.attendeeName,
    lotLabel: lotLabel(index, ticket.ticketLotId),
    tipo: ticket.tipo ?? null,
  };

  if (ticket.status === "CANCELED" || ticket.status === "REFUNDED") {
    return { kind: "CANCELED", ...base };
  }

  const local = index.localCheckins.get(ticket.id);
  if (local) {
    return { kind: "ALREADY_USED", ...base, firstAt: local.at, firstGate: local.gate };
  }
  if (ticket.status === "CHECKED_IN") {
    return { kind: "ALREADY_USED", ...base, firstAt: ticket.checkedInAt, firstGate: null };
  }
  if (ticket.status !== "ISSUED" && ticket.status !== "ACTIVE") {
    return { kind: "INVALID", reason: "NOT_FOUND", ...base };
  }

  return { kind: "VALID", ...base };
}

/** Busca manual por NOME ou por código, sobre o manifesto local. */
export function searchManifest(index: ManifestIndex, query: string, limit = 25): ManifestTicket[] {
  const term = query.trim().toLowerCase();
  if (term.length < 2) return [];
  const results: ManifestTicket[] = [];
  for (const ticket of index.byId.values()) {
    const name = ticket.attendeeName?.toLowerCase() ?? "";
    if (name.includes(term) || ticket.code.toLowerCase().includes(term)) {
      results.push(ticket);
      if (results.length >= limit) break;
    }
  }
  return results.sort((a, b) => (a.attendeeName ?? a.code).localeCompare(b.attendeeName ?? b.code));
}

// --- textos do protótipo ("o que dizer ao portador") ------------------------

export const INVALID_REASON_TEXT: Record<string, { motivo: string; dizer: string; acao: string }> = {
  BAD_SIGNATURE: {
    motivo: "Assinatura inválida — QR adulterado ou falsificado",
    dizer: '"Este QR não foi emitido pela BoraFest"',
    acao: "Conferir a compra na busca manual",
  },
  OTHER_EVENT: {
    motivo: "QR de outro evento",
    dizer: '"Este ingresso não é deste evento"',
    acao: "Conferir a compra na busca manual",
  },
  NOT_FOUND: {
    motivo: "Ingresso não encontrado na lista deste evento",
    dizer: '"Não encontramos este ingresso"',
    acao: "Conferir a compra na busca manual",
  },
  EVENT_WITHOUT_KEY: {
    motivo: "Evento sem chave de assinatura",
    dizer: '"Vamos conferir no sistema"',
    acao: "Chamar o organizador",
  },
  MALFORMED: {
    motivo: "QR ilegível ou fora do padrão BoraFest",
    dizer: '"Este código não é um ingresso"',
    acao: "Pedir o ingresso no app ou no e-mail",
  },
};
