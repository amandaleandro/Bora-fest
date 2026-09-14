import { API_BASE_URL } from "./config";
import type { CustomerSegment } from "./customer-crm-api";

export interface ReactivationPreview {
  segment: CustomerSegment;
  eligibleCount: number;
  truncated: boolean;
  maxSend: number;
  canSend: boolean;
  sample: Array<{ email: string; name: string | null; tags: string[] }>;
}

export interface ReactivationSendResult {
  campaignId: string;
  queued: number;
  segment: string;
  createdAt: string;
  replayed: boolean;
}

async function parseError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(payload.message)) return payload.message.join(" · ");
    if (payload.message) return payload.message;
  } catch {
    // mantém fallback
  }
  return fallback;
}

export async function previewReactivation(
  token: string,
  organizationId: string,
  segment: CustomerSegment,
) {
  const response = await fetch(
    `${API_BASE_URL}/v1/organizations/${organizationId}/customers/reactivation/preview`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ segment }),
    },
  );
  if (!response.ok) throw new Error(await parseError(response, "Não foi possível calcular o público"));
  return (await response.json()) as ReactivationPreview;
}

export async function sendReactivation(
  token: string,
  organizationId: string,
  input: {
    segment: CustomerSegment;
    subject: string;
    message: string;
    ctaLabel?: string;
    ctaUrl?: string;
  },
  idempotencyKey: string,
) {
  const response = await fetch(
    `${API_BASE_URL}/v1/organizations/${organizationId}/customers/reactivation/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) throw new Error(await parseError(response, "Não foi possível enviar a campanha"));
  return (await response.json()) as ReactivationSendResult;
}
