import { API_BASE_URL } from "./config";
import { ApiError, SESSION_EXPIRED_MESSAGE, avisarSessaoVencida } from "./api";

/** Lote que ficou de fora da nova edição, e por quê (texto do servidor, em português). */
export interface LotePuladoNaEdicao {
  ticketTypeName: string;
  lotName: string;
  reason: string;
}

export interface DuplicatedEventResult {
  id: string;
  title: string;
  slug: string;
  status: string;
  startsAt: string;
  endsAt: string;
  copiedFromEventId: string;
  copiedTicketTypes: number;
  /** só os lotes que de fato foram copiados */
  copiedLots: number;
  copiedAddOns: number;
  /**
   * LOTE MORTO NÃO ATRAVESSA EDIÇÃO (2026-10-12): lote que o cadastro de lote
   * hoje recusaria (balcão de R$ 0, pago abaixo do mínimo) não é copiado. A
   * tela mostra quais ficaram de fora antes de seguir para o novo evento.
   */
  skippedLots?: LotePuladoNaEdicao[];
}

/** Chave de uma tentativa de criar edição, presa aos dados que ela enviou. */
export interface TentativaDeEdicao {
  chave: string;
  /** os dados enviados, serializados (rota + corpo) */
  pedido: string;
}

/**
 * Chave da tentativa (padrão do PDV da porta, 2026-10-12): nasce no clique de
 * confirmar e é a MESMA enquanto os dados forem os mesmos — se a resposta se
 * perdeu e a pessoa clica de novo, o servidor devolve a edição já criada em vez
 * de criar outra. Dados diferentes (outra data, outro nome) = chave nova: o
 * servidor recusa a mesma chave com corpo diferente.
 */
export function tentativaDeEdicao(
  anterior: TentativaDeEdicao | null,
  pedido: string,
  gerarChave: () => string = novaChaveDeIdempotencia,
): TentativaDeEdicao {
  return anterior && anterior.pedido === pedido ? anterior : { chave: gerarChave(), pedido };
}

/** UUID do navegador; fora de contexto seguro (http em rede local) cai num aleatório. */
export function novaChaveDeIdempotencia(): string {
  return globalThis.crypto?.randomUUID?.() ?? `edicao-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * IDEMPOTENCY-KEY (2026-10-12): criar edição é uma escrita que, repetida, vira
 * OUTRO evento em rascunho. A tela manda uma chave por tentativa (padrão do PDV
 * da porta): se a resposta se perder e a pessoa tentar de novo com os mesmos
 * dados, o servidor devolve a edição já criada em vez de criar a segunda.
 */
async function post<T>(token: string, path: string, body: unknown, idempotencyKey: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // "Failed to fetch" cru vira o mesmo texto do resto do painel
    throw new ApiError(0, "Falha de conexão com o servidor — confira a internet e tente de novo.");
  }
  // sessão vencida (2026-10-12): mesmo tratamento do request de lib/api.ts
  if (avisarSessaoVencida(response.status, token)) throw new ApiError(401, SESSION_EXPIRED_MESSAGE);
  if (!response.ok) {
    let message = "Não foi possível criar a próxima edição";
    try {
      const payload = (await response.json()) as { message?: string | string[] };
      if (Array.isArray(payload.message)) message = payload.message.join(" · ");
      else if (payload.message) message = payload.message;
    } catch {
      // mantém fallback
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export const eventRecurrenceApi = {
  nextEdition: (
    token: string,
    eventId: string,
    input: { cadenceDays: number; title?: string; copyTicketCatalog: boolean },
    idempotencyKey: string,
  ) => post<DuplicatedEventResult>(token, `/v1/events/${eventId}/next-edition`, input, idempotencyKey),

  duplicate: (
    token: string,
    eventId: string,
    input: { startsAt: string; endsAt: string; title?: string; copyTicketCatalog: boolean },
    idempotencyKey: string,
  ) => post<DuplicatedEventResult>(token, `/v1/events/${eventId}/duplicate`, input, idempotencyKey),
};
