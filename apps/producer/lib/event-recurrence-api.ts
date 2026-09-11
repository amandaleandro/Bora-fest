import { API_BASE_URL } from "./api-base";

export interface DuplicatedEventResult {
  id: string;
  title: string;
  slug: string;
  status: string;
  startsAt: string;
  endsAt: string;
  copiedFromEventId: string;
  copiedTicketTypes: number;
  copiedLots: number;
  copiedAddOns: number;
}

async function post<T>(token: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = "Não foi possível criar a próxima edição";
    try {
      const payload = (await response.json()) as { message?: string | string[] };
      if (Array.isArray(payload.message)) message = payload.message.join(" · ");
      else if (payload.message) message = payload.message;
    } catch {
      // mantém fallback
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export const eventRecurrenceApi = {
  nextEdition: (
    token: string,
    eventId: string,
    input: { cadenceDays: number; title?: string; copyTicketCatalog: boolean },
  ) => post<DuplicatedEventResult>(token, `/v1/events/${eventId}/next-edition`, input),

  duplicate: (
    token: string,
    eventId: string,
    input: { startsAt: string; endsAt: string; title?: string; copyTicketCatalog: boolean },
  ) => post<DuplicatedEventResult>(token, `/v1/events/${eventId}/duplicate`, input),
};
