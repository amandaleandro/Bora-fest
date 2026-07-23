import { api, type DeviceCredentials } from "../api/client";
import type { CheckinResponse } from "../api/types";
import {
  findTicketById,
  findTicketByCode,
  getMeta,
  markLocalCheckedIn,
  queuePendingCheckin,
  recordConfirmedCheckin,
} from "../db/database";
import { looksLikeTicketToken, parseTicketToken } from "../qr/parseTicketToken";
import { verifyTicketTokenSignature } from "../qr/verifyTicketToken";

export interface CheckinAttemptResult {
  outcome: CheckinResponse["result"];
  offline: boolean;
  ticketCode?: string;
  attendeeName?: string | null;
  message: string;
}

const ACTIVE_STATUSES = new Set(["ISSUED", "ACTIVE"]);

/**
 * Tenta validar online primeiro (o servidor é sempre a fonte de verdade —
 * confere assinatura do QR e resolve corrida entre aparelhos). Se a rede
 * falhar, cai para o pré-check local contra o manifesto e enfileira para
 * sincronizar depois. Ver docs/projeto/API-REFERENCE.md sobre a limitação:
 * dois aparelhos totalmente offline não conseguem se coordenar entre si.
 */
export async function attemptCheckin(
  device: DeviceCredentials,
  scanned: { qrToken?: string; code?: string },
  checkinPointId: string | undefined,
): Promise<CheckinAttemptResult> {
  const scannedAt = new Date().toISOString();

  try {
    const response = await api.checkin(device, { ...scanned, checkinPointId, scannedAt });
    if (response.result === "VALID" && response.ticket) {
      recordConfirmedCheckin(response.ticket.id, response.checkinId);
    }
    return {
      outcome: response.result,
      offline: false,
      ticketCode: response.ticket?.code,
      attendeeName: response.ticket?.attendeeName,
      message: describeOutcome(response.result, response.firstCheckin?.deviceName),
    };
  } catch {
    return attemptCheckinOffline(scanned, checkinPointId, scannedAt);
  }
}

function attemptCheckinOffline(
  scanned: { qrToken?: string; code?: string },
  checkinPointId: string | undefined,
  scannedAt: string,
): CheckinAttemptResult {
  let ticketId: string | undefined;

  if (scanned.qrToken && looksLikeTicketToken(scanned.qrToken)) {
    try {
      ticketId = parseTicketToken(scanned.qrToken).tid;
    } catch {
      return { outcome: "INVALID", offline: true, message: "QR não reconhecido (offline)" };
    }

    // verificação criptográfica LOCAL (§12): com a chave pública do evento
    // baixada no manifesto, um QR forjado/adulterado é recusado mesmo sem rede
    const publicKeyPem = getMeta("signingKeyPublicKeyPem");
    if (publicKeyPem && !verifyTicketTokenSignature(scanned.qrToken, publicKeyPem)) {
      return {
        outcome: "INVALID",
        offline: true,
        message: "Assinatura do QR inválida — ingresso não autêntico",
      };
    }
  }

  const local = ticketId ? findTicketById(ticketId) : scanned.code ? findTicketByCode(scanned.code) : null;

  if (!local) {
    return {
      outcome: "INVALID",
      offline: true,
      message: "Ingresso não encontrado no manifesto local — sincronize o manifesto",
    };
  }

  if (local.status === "CHECKED_IN") {
    return {
      outcome: "ALREADY_USED",
      offline: true,
      ticketCode: local.code,
      message: "Já utilizado (segundo o último manifesto sincronizado)",
    };
  }

  if (!ACTIVE_STATUSES.has(local.status)) {
    return {
      outcome: "CANCELED",
      offline: true,
      ticketCode: local.code,
      message: "Ingresso cancelado/reembolsado (segundo o último manifesto sincronizado)",
    };
  }

  queuePendingCheckin(local.id, local.code, checkinPointId, scannedAt);
  markLocalCheckedIn(local.id);

  return {
    outcome: "VALID",
    offline: true,
    ticketCode: local.code,
    message: "Válido offline — na fila para sincronizar quando a rede voltar",
  };
}

function describeOutcome(outcome: CheckinResponse["result"], firstDeviceName?: string): string {
  switch (outcome) {
    case "VALID":
      return "Entrada confirmada";
    case "ALREADY_USED":
      return firstDeviceName
        ? `Já utilizado (validado antes em "${firstDeviceName}")`
        : "Já utilizado";
    case "CANCELED":
      return "Ingresso cancelado ou reembolsado";
    default:
      return "Ingresso inválido";
  }
}
