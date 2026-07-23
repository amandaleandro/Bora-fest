export interface ValidatorSessionResponse {
  deviceId: string;
  deviceToken: string;
  credentialLabel: string;
  event: {
    id: string;
    title: string;
    slug: string;
    startsAt: string;
    endsAt: string;
  };
  checkinPoints: Array<{ id: string; name: string }>;
}

export interface ManifestTicket {
  id: string;
  code: string;
  status: string;
  ticketLotId: string;
  checkedInAt: string | null;
  updatedAt: string;
}

export interface ManifestResponse {
  manifestVersion: string;
  delta: boolean;
  event: { id: string; title: string; startsAt: string; endsAt: string; timezone: string };
  signingKey: { publicKeyPem: string; algorithm: string } | null;
  ticketCount: number;
  tickets: ManifestTicket[];
}

export type CheckinOutcome = "VALID" | "ALREADY_USED" | "INVALID" | "CANCELED";

export interface CheckinResponse {
  result: CheckinOutcome;
  ticket?: {
    id: string;
    code: string;
    status: string;
    attendeeName: string | null;
    lotName: string;
    typeName: string;
  };
  checkinId?: string;
  firstCheckin?: { at: string | null; deviceName?: string };
}

export interface SyncCheckinItemInput {
  localSeq: number;
  ticketId: string;
  checkinPointId?: string;
  scannedAt: string;
}

export interface SyncCheckinsResponse {
  batchKey: string;
  received: number;
  confirmed: number;
  conflicts: number;
  invalid: number;
  items: Array<{
    localSeq: number;
    ticketId: string;
    status: "CONFIRMED" | "CONFLICT" | "INVALID";
    checkinId?: string;
  }>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
