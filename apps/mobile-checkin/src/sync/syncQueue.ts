import * as Crypto from "expo-crypto";
import { api, type DeviceCredentials } from "../api/client";
import {
  listPendingCheckins,
  removePendingCheckin,
  recordConfirmedCheckin,
  markLocalCheckedIn,
} from "../db/database";

export interface SyncResult {
  attempted: number;
  confirmed: number;
  conflicts: number;
  invalid: number;
  error?: string;
}

/**
 * Envia a fila local em um único lote (`batchKey` novo a cada tentativa —
 * se a chamada falhar por rede, o lote inteiro fica intacto para a próxima
 * tentativa, sem duplicar nada porque o servidor também é idempotente por
 * (device, localSeq) e por (device, batchKey)).
 */
export async function flushPendingCheckins(device: DeviceCredentials): Promise<SyncResult> {
  const pending = listPendingCheckins();
  if (pending.length === 0) {
    return { attempted: 0, confirmed: 0, conflicts: 0, invalid: 0 };
  }

  const batchKey = Crypto.randomUUID();

  try {
    const response = await api.syncCheckins(
      device,
      batchKey,
      pending.map((item) => ({
        localSeq: item.local_seq,
        ticketId: item.ticket_id,
        checkinPointId: item.checkin_point_id ?? undefined,
        scannedAt: item.scanned_at,
      })),
    );

    for (const result of response.items) {
      const pendingItem = pending.find((p) => p.local_seq === result.localSeq);
      if (!pendingItem) continue;

      if (result.status === "CONFIRMED") {
        markLocalCheckedIn(result.ticketId);
        recordConfirmedCheckin(result.ticketId, result.checkinId);
      }
      // CONFLICT/INVALID: removemos da fila mesmo assim — já foi resolvido
      // pelo servidor (alguém validou primeiro, ou o ingresso não existe/
      // está cancelado); reter na fila só reenviaria o mesmo resultado.
      removePendingCheckin(result.localSeq);
    }

    return {
      attempted: pending.length,
      confirmed: response.confirmed,
      conflicts: response.conflicts,
      invalid: response.invalid,
    };
  } catch (error) {
    return {
      attempted: pending.length,
      confirmed: 0,
      conflicts: 0,
      invalid: 0,
      error: error instanceof Error ? error.message : "Falha ao sincronizar",
    };
  }
}
