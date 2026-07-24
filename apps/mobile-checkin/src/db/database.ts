import * as SQLite from "expo-sqlite";
import type { ManifestResponse } from "../api/types";

const db = SQLite.openDatabaseSync("borafest-checkin.db");

export function initDatabase(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      status TEXT NOT NULL,
      ticket_lot_id TEXT NOT NULL,
      checked_in_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_code ON tickets(code);

    CREATE TABLE IF NOT EXISTS pending_checkins (
      local_seq INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL,
      ticket_code TEXT NOT NULL,
      checkin_point_id TEXT,
      scanned_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS confirmed_checkins (
      ticket_id TEXT PRIMARY KEY,
      checkin_id TEXT,
      confirmed_at TEXT NOT NULL
    );
  `);
}

export function getMeta(key: string): string | null {
  const row = db.getFirstSync<{ value: string }>("SELECT value FROM meta WHERE key = ?", [key]);
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db.runSync("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
    key,
    value,
  ]);
}

export function upsertManifest(manifest: ManifestResponse): void {
  db.withTransactionSync(() => {
    for (const ticket of manifest.tickets) {
      db.runSync(
        `INSERT INTO tickets (id, code, status, ticket_lot_id, checked_in_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           code = excluded.code,
           status = excluded.status,
           ticket_lot_id = excluded.ticket_lot_id,
           checked_in_at = excluded.checked_in_at,
           updated_at = excluded.updated_at`,
        [
          ticket.id,
          ticket.code,
          ticket.status,
          ticket.ticketLotId,
          ticket.checkedInAt,
          ticket.updatedAt,
        ],
      );
    }
  });
  setMeta("manifestVersion", manifest.manifestVersion);
  if (manifest.signingKey) {
    setMeta("signingKeyPublicKeyPem", manifest.signingKey.publicKeyPem);
  }
}

export interface LocalTicket {
  id: string;
  code: string;
  status: string;
  ticket_lot_id: string;
  checked_in_at: string | null;
  updated_at: string;
}

export function findTicketById(ticketId: string): LocalTicket | null {
  return db.getFirstSync<LocalTicket>("SELECT * FROM tickets WHERE id = ?", [ticketId]) ?? null;
}

export function findTicketByCode(code: string): LocalTicket | null {
  return (
    db.getFirstSync<LocalTicket>("SELECT * FROM tickets WHERE code = ? COLLATE NOCASE", [code]) ?? null
  );
}

export function searchTicketsByCode(query: string, limit = 30): LocalTicket[] {
  return db.getAllSync<LocalTicket>(
    "SELECT * FROM tickets WHERE code LIKE ? COLLATE NOCASE ORDER BY code LIMIT ?",
    [`%${query}%`, limit],
  );
}

export function markLocalCheckedIn(ticketId: string): void {
  db.runSync("UPDATE tickets SET status = 'CHECKED_IN' WHERE id = ?", [ticketId]);
}

export function queuePendingCheckin(
  ticketId: string,
  ticketCode: string,
  checkinPointId: string | undefined,
  scannedAt: string,
): number {
  const result = db.runSync(
    "INSERT INTO pending_checkins (ticket_id, ticket_code, checkin_point_id, scanned_at) VALUES (?, ?, ?, ?)",
    [ticketId, ticketCode, checkinPointId ?? null, scannedAt],
  );
  return Number(result.lastInsertRowId);
}

export interface PendingCheckin {
  local_seq: number;
  ticket_id: string;
  ticket_code: string;
  checkin_point_id: string | null;
  scanned_at: string;
}

export function listPendingCheckins(): PendingCheckin[] {
  return db.getAllSync<PendingCheckin>("SELECT * FROM pending_checkins ORDER BY local_seq ASC");
}

export function countPendingCheckins(): number {
  const row = db.getFirstSync<{ count: number }>("SELECT COUNT(*) as count FROM pending_checkins");
  return row?.count ?? 0;
}

export function removePendingCheckin(localSeq: number): void {
  db.runSync("DELETE FROM pending_checkins WHERE local_seq = ?", [localSeq]);
}

export function recordConfirmedCheckin(ticketId: string, checkinId: string | undefined): void {
  db.runSync(
    `INSERT INTO confirmed_checkins (ticket_id, checkin_id, confirmed_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(ticket_id) DO NOTHING`,
    [ticketId, checkinId ?? null],
  );
}

export function countConfirmedCheckins(): number {
  const row = db.getFirstSync<{ count: number }>("SELECT COUNT(*) as count FROM confirmed_checkins");
  return row?.count ?? 0;
}

export interface RecentCheckin {
  ticket_id: string;
  checkin_id: string | null;
  confirmed_at: string;
  code: string | null;
}

export function listRecentCheckins(limit = 30): RecentCheckin[] {
  return db.getAllSync<RecentCheckin>(
    `SELECT c.ticket_id, c.checkin_id, c.confirmed_at, t.code
     FROM confirmed_checkins c
     LEFT JOIN tickets t ON t.id = c.ticket_id
     ORDER BY c.confirmed_at DESC
     LIMIT ?`,
    [limit],
  );
}
