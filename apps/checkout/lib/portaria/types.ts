/** Tipos compartilhados do PWA de portaria (handoff v2, superfície 4). */

export interface Session {
  deviceId: string;
  deviceToken: string;
  credentialLabel?: string;
  event: { id: string; title: string; slug?: string; startsAt?: string; endsAt?: string };
  checkinPoints: Array<{ id: string; name: string }>;
  /**
   * Permissões da SESSÃO (2026-08-12). Só a sessão por CONTA as devolve; a
   * sessão por PIN não traz nenhuma (undefined) e, por padrão, valida mas não
   * vende. A portaria mostra a aba "Validar" só com canValidate e a aba
   * "Vender na porta" só com canSell.
   */
  canValidate?: boolean;
  canSell?: boolean;
}

/** Ingresso como vem no manifesto — sem CPF cru (minimização LGPD, ver validator.service). */
export interface ManifestTicket {
  id: string;
  code: string;
  status: string;
  ticketLotId: string;
  checkedInAt: string | null;
  updatedAt: string;
  attendeeName: string | null;
  /**
   * SHA-256 (hex minúsculo) dos 11 dígitos do CPF, ou null se não houver.
   * Permite a busca por documento no aparelho sem o CPF sair do servidor.
   * Opcional para tolerar manifestos guardados antes do campo existir.
   */
  cpfHash?: string | null;
  tipo?: "CONVIDADO" | "CORTESIA" | null;
  /**
   * De quem é a lista (2026-09-15). `null`/ausente = tem ingresso em mãos e cai
   * na aba "Ingressos"; preenchido = só o nome cadastrado, aparece apenas na aba
   * de quem convidou e exige conferência de CPF.
   * Opcional para tolerar manifesto guardado antes do campo existir — aparelho
   * que ainda não ressincronizou não pode quebrar a tela.
   */
  lista?: { id: string; nome: string } | null;
}

export interface ManifestLot {
  id: string;
  name: string;
  typeName: string;
}

export interface ManifestMeta {
  eventId: string;
  eventTitle: string;
  /** carimbo devolvido pelo servidor; vira o `since` do próximo delta */
  manifestVersion: string;
  publicKeyPem: string | null;
  syncedAt: string;
  ticketCount: number;
  /**
   * Versão do FORMATO do manifesto guardado (2026-09-15). Campo novo no ticket
   * não chega por delta: o servidor só devolve `updatedAt > since`, e ingresso
   * antigo não mudou — ele fica no aparelho para sempre com o formato velho.
   * `undefined` = guardado antes deste controle existir, então vale um full.
   */
  manifestSchema?: number;
}

export interface ManifestResponse {
  manifestVersion: string;
  delta: boolean;
  lots: ManifestLot[];
  event: { id: string; title: string; startsAt: string; endsAt: string; timezone: string };
  signingKey: { publicKeyPem: string; algorithm: string } | null;
  ticketCount: number;
  tickets: ManifestTicket[];
}

/** Estado de um item da fila offline. CONFLICT/INVALID nunca são descartados. */
export type QueueState = "PENDING" | "CONFLICT" | "INVALID";

export interface QueueItem {
  /** único por aparelho — o servidor usa (deviceId, localSeq) como chave */
  localSeq: number;
  ticketId: string;
  checkinPointId?: string;
  scannedAt: string;
  state: QueueState;
  code: string;
  name: string | null;
  gateName: string | null;
  /**
   * Convidado de lista liberado sem o CPF bater (2026-09-15). Viaja na fila
   * porque a portaria opera OFFLINE: se o rastro dependesse de rede, ele some
   * exatamente no modo em que a válvula de escape mais é usada.
   * Itens gravados antes deste campo existir chegam `undefined` — e `undefined`
   * significa "entrada normal", que é a leitura certa para eles.
   */
  semConferirCpf?: boolean;
}

export type ResultKind = "VALID" | "ALREADY_USED" | "INVALID" | "CANCELED" | "UNVERIFIED";

export type InvalidReason =
  | "BAD_SIGNATURE"
  | "OTHER_EVENT"
  | "NOT_FOUND"
  | "EVENT_WITHOUT_KEY"
  | "MALFORMED";

export interface ScanResult {
  kind: ResultKind;
  reason?: InvalidReason;
  /** verificado no aparelho (manifesto + assinatura) em vez de no servidor */
  offline?: boolean;
  ticketId?: string;
  code?: string;
  name?: string | null;
  lotLabel?: string | null;
  /** entrada grátis: mostrado no VÁLIDO pro staff saber (CONVIDADO/CORTESIA) */
  tipo?: "CONVIDADO" | "CORTESIA" | null;
  firstAt?: string | null;
  firstGate?: string | null;
  firstDevice?: string | null;
  checkinId?: string;
}

export interface SummaryResponse {
  totalTickets: number;
  checkedIn: number;
  remaining: number;
  byGate: Array<{ gate: string; count: number }>;
}

export interface RecentCheckin {
  checkinId: string;
  code: string;
  name: string | null;
  gate: string | null;
  at: string;
}
