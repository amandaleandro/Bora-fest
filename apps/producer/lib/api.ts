import { API_BASE_URL } from "./config";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * SESSÃO VENCIDA (2026-10-12): o painel nunca tratava 401 — com o token
 * expirado as telas ficavam vazias até a pessoa clicar em Sair. Agora um 401
 * numa chamada COM token avisa o AuthProvider (lib/auth.tsx), que faz o mesmo
 * que o Sair e manda para o login com o aviso. O 401 do próprio login (senha
 * errada) vai sem token, então continua sendo só o erro na tela.
 */
export const SESSION_EXPIRED_EVENT = "bf:session-expired";
export const SESSION_EXPIRED_MESSAGE = "Sua sessão expirou — entre de novo";

// exportada (2026-10-12): os clientes com fetch próprio (loyalty-api, vip-api,
// os outros *-api.ts e o perfil-publico) usam esta mesma regra de 401
export function avisarSessaoVencida(status: number, token: string | null | undefined): boolean {
  if (status !== 401 || !token) return false;
  if (typeof window !== "undefined") {
    // leva o token junto: o AuthProvider só derruba a sessão se ainda for ESTE
    // o token guardado (um 401 atrasado não desloga quem já entrou de novo)
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { token } }));
  }
  return true;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null; idempotencyKey?: string } = {},
): Promise<T> {
  // Content-Type só com corpo: o Fastify rejeita (400) JSON declarado e vazio
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    if (avisarSessaoVencida(response.status, options.token)) {
      throw new ApiError(401, SESSION_EXPIRED_MESSAGE);
    }
    throw new ApiError(response.status, data?.message ?? "Erro ao falar com a API");
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface SessionUser {
  id: string;
  email: string | null;
  name: string | null;
}

export const identityApi = {
  requestOtp: (destination: string) =>
    request<{ sent: boolean }>("/v1/identity/otp/request", {
      method: "POST",
      body: { destination, channel: "EMAIL" },
    }),
  verifyOtp: (destination: string, code: string) =>
    request<{ token: string; user: SessionUser }>("/v1/identity/otp/verify", {
      method: "POST",
      body: { destination, code },
    }),
};

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export type ProducerType = "CASA" | "ATLETICA" | "PRODUTORA" | "INDEPENDENTE" | "OUTRO";

export interface PromoterEventoDoLink {
  id: string;
  title: string;
  slug: string;
  startsAt: string;
}

export interface PromoterEngagement {
  id: string;
  hostName: string;
  slug: string;
  paidOrders: number;
  soldCents?: number;
  /** evento do escopo do vínculo — null quando vale para todos os eventos da casa */
  event?: PromoterEventoDoLink | null;
  /** agenda da casa, quando o vínculo não tem escopo de evento */
  events?: PromoterEventoDoLink[];
  commissionType?: "NONE" | "PERCENT" | "FIXED";
  commissionBps?: number;
  commissionFixedCents?: number;
  commissionCents?: number;
}

export interface PromoterInvite {
  id: string;
  commissionType: "NONE" | "PERCENT" | "FIXED";
  commissionBps: number;
  commissionFixedCents: number;
  invitedAt: string;
  organization: { id: string; name: string; displayName: string | null };
}

export interface PromoterRow {
  id: string;
  status: string;
  slug: string;
  /** null = todos os eventos da casa; senão o título do evento do escopo */
  eventTitle?: string | null;
  /** escopo do vínculo: null = todos os eventos da casa */
  eventId?: string | null;
  /** slug do evento do escopo — o "Copiar link" leva direto à festa */
  eventSlug?: string | null;
  /** código pessoal (ex.: BIA10); null = sem código */
  code?: string | null;
  /** quantos convidados o promoter pode pôr na lista de cada evento (0 = nenhum) */
  guestQuota?: number;
  promoterName: string;
  sellers: number;
  paidOrders: number;
  soldCents: number;
  commissionCents: number;
  commissionType: "NONE" | "PERCENT" | "FIXED";
  commissionBps?: number;
  commissionFixedCents?: number;
}

/** Resposta do PATCH do vínculo do promoter: o que ficou gravado. */
export interface PromoterLinkEditado {
  id: string;
  status: string;
  code: string | null;
  guestQuota: number;
  eventId: string | null;
}

export interface Organization {
  id: string;
  name: string;
  /** nome comercial mostrado ao público; null = usa `name` */
  displayName?: string | null;
  slug: string;
  kind: string;
  status: string;
  document?: string;
}

/**
 * Os ganhos REAIS da produtora — só dinheiro que entrou de verdade.
 * As parcelas somam `totalCents`: recebido + a caminho + disponível
 * + a liberar − em aberto.
 */
export interface OrgEarnings {
  /** tudo que virou dinheiro do produtor, desde sempre */
  totalCents: number;
  /** já caiu na conta dele */
  receivedCents: number;
  /** saque pedido, ainda a caminho */
  inTransitCents: number;
  /** pode sacar agora */
  availableCents: number;
  /** vendas de evento que ainda não liberou */
  pendingReleaseCents: number;
  /** saldo devedor: sacou e depois houve estorno/cancelamento */
  debtCents: number;
}

/**
 * Carteira PESSOAL do promoter (GET wallet/mine): comissões de quem ainda não
 * tem produtora. Quando ele cria a produtora, a carteira passa para ela e o
 * saque sai pelo Financeiro (organizations.service create/getMyWallet).
 */
export interface PromoterWallet {
  /** tudo que está na carteira (pode ficar negativo depois de estorno) */
  balanceCents: number;
  /** a parte que já passou da liberação (D+2 úteis após o evento) */
  availableCents: number;
  /** hoje sempre true: sacar exige completar o cadastro de produtor */
  needsProducerAccount: boolean;
}

export const organizationsApi = {
  list: (token: string) => request<Array<Organization & { roleKey: string }>>("/v1/organizations", { token }),
  /** carteira pessoal do promoter (2026-10-12: a rota existia e nenhuma tela usava) */
  myWallet: (token: string) => request<PromoterWallet>("/v1/organizations/wallet/mine", { token }),

  /** Resumo da produtora numa requisição (ganhos, ingressos e eventos). */
  getSummary: (token: string, organizationId: string) =>
    request<{
      organizationId: string;
      /** null para quem não enxerga financeiro (vendedor) */
      earnings: OrgEarnings | null;
      ticketsSold: number;
      ticketsCapacity: number;
      events: Array<EventSummary & { netCents: number | null }>;
    }>(`/v1/organizations/${organizationId}/summary`, { token }),
  /** Promoter v3: convida uma PESSOA por e-mail (conta simples criada na hora). */
  invitePromoter: (
    token: string,
    organizationId: string,
    input: {
      email: string;
      /** escopo: ausente = todos os eventos; presente = SÓ este evento */
      eventId?: string;
      commissionType: "NONE" | "PERCENT" | "FIXED";
      commissionBps?: number;
      commissionFixedCents?: number;
    },
  ) =>
    request(`/v1/organizations/${organizationId}/promoters`, {
      method: "POST",
      body: input,
      token,
    }),
  inviteSeller: (token: string, promoterLinkId: string, email: string) =>
    request(`/v1/organizations/promoter-links/${promoterLinkId}/sellers`, {
      method: "POST",
      body: { email },
      token,
    }),
  listSellersOfPromoter: (token: string, promoterLinkId: string) =>
    request<Array<{ id: string; status: string; slug: string; sellerName: string; paidOrders: number; soldCents: number }>>(
      `/v1/organizations/promoter-links/${promoterLinkId}/sellers`,
      { token },
    ),
  mySellerInvites: (token: string) =>
    request<Array<{ id: string; promoterLink: { organization: { name: string; displayName: string | null }; promoterUser: { name: string | null; email: string | null } } }>>(
      "/v1/organizations/seller-invites/mine",
      { token },
    ),
  mySellerEngagements: (token: string) =>
    request<Array<{ id: string; slug: string; hostName: string; promoterName: string; paidOrders: number; soldCents: number }>>(
      "/v1/organizations/seller-engagements/mine",
      { token },
    ),
  respondSellerInvite: (token: string, sellerId: string, accept: boolean) =>
    request(`/v1/organizations/promoter-sellers/${sellerId}/${accept ? "accept" : "decline"}`, {
      method: "POST",
      token,
    }),
  /** a casa revoga o acesso do promoter — link e vendedores param na hora */
  revokePromoter: (token: string, linkId: string) =>
    request(`/v1/organizations/promoter-links/${linkId}/revoke`, { method: "POST", token }),

  listPromoters: (token: string, organizationId: string) =>
    request<PromoterRow[]>(`/v1/organizations/${organizationId}/promoters`, { token }),
  /**
   * A casa muda a cota de convidados e/ou o código pessoal do promoter
   * (2026-10-12). Mande só o que mudou; `code: null` tira o código.
   */
  updatePromoterLink: (
    token: string,
    organizationId: string,
    linkId: string,
    input: { guestQuota?: number; code?: string | null },
  ) =>
    request<PromoterLinkEditado>(`/v1/organizations/${organizationId}/promoters/${linkId}`, {
      method: "PATCH",
      body: input,
      token,
    }),
  myPromoterInvites: (token: string) =>
    request<PromoterInvite[]>(`/v1/organizations/promoter-invites/mine`, { token }),
  myPromoterEngagements: (token: string) =>
    request<PromoterEngagement[]>(`/v1/organizations/promoter-engagements/mine`, { token }),
  respondPromoterInvite: (token: string, linkId: string, accept: boolean) =>
    request(`/v1/organizations/promoter-links/${linkId}/${accept ? "accept" : "decline"}`, {
      method: "POST",
      token,
    }),
  create: (token: string, input: { name: string; kind: "INDIVIDUAL" | "COMPANY"; document: string; producerType: ProducerType }) =>
    request<Organization & { members: unknown[]; reused?: boolean }>("/v1/organizations", { method: "POST", body: input, token }),
  update: (token: string, organizationId: string, input: { displayName?: string | null }) =>
    request<Organization>(`/v1/organizations/${organizationId}`, { method: "PATCH", body: input, token }),
  inviteMember: (token: string, organizationId: string, email: string, roleKey: MemberRoleKey, partnerId?: string) =>
    request(`/v1/organizations/${organizationId}/members`, {
      method: "POST",
      body: { email, roleKey, partnerId },
      token,
    }),
  createSalesPartner: (token: string, organizationId: string, input: { name: string; commissionBps: number }) =>
    request<SalesPartner>(`/v1/organizations/${organizationId}/sales-partners`, { method: "POST", body: input, token }),
  listSalesPartners: (token: string, organizationId: string) =>
    request<SalesPartner[]>(`/v1/organizations/${organizationId}/sales-partners`, { token }),
  listMembers: (token: string, organizationId: string) =>
    request<OrgMember[]>(`/v1/organizations/${organizationId}/members`, { token }),
  removeMember: (token: string, organizationId: string, memberId: string) =>
    request(`/v1/organizations/${organizationId}/members/${memberId}`, { method: "DELETE", token }),
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Local do evento — `state` é a UF com 2 letras maiúsculas (ex.: "SP"). Endereço e link do mapa são independentes e opcionais. */
export interface EventVenue {
  name: string;
  address?: string;
  mapsUrl?: string;
  city: string;
  state: string;
}

/** As 27 UFs aceitas em `EventVenue.state` (valores exatos do contrato da API). */
export const UF_LIST = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export type EventCategory = "SHOWS" | "FESTAS" | "ESPORTES" | "TEATRO";

/** Categoria alimenta os chips de busca da home pública — sem ela o evento só some do filtro, não da listagem. */
export const EVENT_CATEGORIES: Array<{ value: EventCategory; label: string }> = [
  { value: "SHOWS", label: "Shows" },
  { value: "FESTAS", label: "Festas" },
  { value: "ESPORTES", label: "Esportes" },
  { value: "TEATRO", label: "Teatro" },
];

export interface EventSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  startsAt: string;
  endsAt: string;
  organizationId: string;
  description?: string | null;
  /** atrações, uma por linha */
  lineup?: string | null;
  /** o que está incluso, um item por linha */
  amenities?: string | null;
  minAge?: number | null;
  bannerUrl?: string | null;
  category?: EventCategory | null;
  venue?: EventVenue | null;
  /**
   * Evento privado (2026-10-12): fora da home, da busca, da página da Casa e do
   * Google; abre só por link. Ausente = API que não manda o campo — a tela não
   * chuta "público".
   */
  isPrivate?: boolean;
  /** quando os seguidores da Casa foram avisados do evento (uma vez só); null = ainda não */
  followersNotifiedAt?: string | null;
}

/**
 * Rótulos → roleKey do inviteMemberSchema (owner|admin|operator|finance|seller).
 * As descrições precisam bater com o PODER REAL do papel (packages/auth/rbac.ts),
 * senão o produtor delega esperando uma coisa e a pessoa toma 403:
 *  - admin  = org:manage_members, event:create, event:publish, order:refund,
 *             finance:view, sales:perform (NÃO faz check-in no app);
 *  - finance = finance:view + order:refund → VÊ pedidos/participantes, exporta,
 *             reembolsa e pede saque; NÃO cria/edita ingressos nem vende no PDV;
 *  - operator = checkin:perform → só a portaria do site (/portaria) e o painel ao vivo
 *    (2026-10-12: não existe "app de validação" — a portaria é uma página do site);
 *  - seller  = sales:perform → registra venda no PDV da atlética/parceiro.
 */
export const MEMBER_ROLES = [
  { key: "admin", label: "Administrador", description: "Cria e edita eventos, ingressos, vendas, financeiro, saques e equipe" },
  { key: "finance", label: "Financeiro", description: "Vê pedidos e participantes, exporta, reembolsa e solicita saque" },
  { key: "operator", label: "Check-in", description: "Só a portaria (borafest.com.br/portaria) e o painel ao vivo" },
  { key: "seller", label: "Vendedor (porta)", description: "Vende no PDV e valida a entrada (check-in) na porta" },
] as const;

export interface SalesPartner {
  id: string;
  name: string;
  slug: string;
  commissionBps: number;
  members: Array<{ user: { id: string; name?: string | null; email?: string | null } }>;
}

export type MemberRoleKey = (typeof MEMBER_ROLES)[number]["key"];

export interface OrgMember {
  id: string;
  status: "INVITED" | "ACTIVE";
  invitedAt: string;
  joinedAt: string | null;
  user: { id: string; name: string | null; email: string | null };
  role: { key: string };
}

export const eventsApi = {
  list: (token: string, organizationId: string) =>
    request<EventSummary[]>(`/v1/organizations/${organizationId}/events`, { token }),
  create: (
    token: string,
    organizationId: string,
    input: {
      title: string;
      startsAt: string;
      endsAt: string;
      description?: string;
      lineup?: string;
      amenities?: string;
      minAge?: number;
      venue?: EventVenue;
      category: EventCategory;
    },
  ) =>
    request<EventSummary>(`/v1/organizations/${organizationId}/events`, {
      method: "POST",
      body: input,
      token,
    }),
  publish: (token: string, eventId: string) =>
    request<EventSummary>(`/v1/events/${eventId}/publish`, { method: "POST", token }),
};

// ---------------------------------------------------------------------------
// Itens adicionais (upsell no checkout)
// ---------------------------------------------------------------------------

export interface EventAddOn {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  active: boolean;
}

export const addOnsApi = {
  list: (token: string, eventId: string) =>
    request<EventAddOn[]>(`/v1/events/${eventId}/add-ons`, { token }),
  create: (token: string, eventId: string, input: { name: string; description?: string; priceCents: number }) =>
    request<EventAddOn>(`/v1/events/${eventId}/add-ons`, { method: "POST", body: input, token }),
  update: (token: string, addOnId: string, input: Partial<{ name: string; description: string; priceCents: number; active: boolean }>) =>
    request<EventAddOn>(`/v1/add-ons/${addOnId}`, { method: "PATCH", body: input, token }),
};

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface TicketType {
  id: string;
  name: string;
  description: string | null;
}

export type FeeMode = "BUYER" | "PRODUCER";

export interface TicketLot {
  id: string;
  name: string;
  priceCents: number;
  feeCents: number;
  capacity: number;
  soldCount: number;
  reservedCount: number;
  status: string;
  feeMode?: FeeMode;
  nominal?: boolean;
  requiresCpf?: boolean;
}

/** "Quem pode pegar" restrito a convidados: link com código ou convite pessoal por e-mail. */
export type LotInviteMode = "NONE" | "LINK" | "EMAIL";

export interface CreateLotInput {
  name: string;
  priceCents: number;
  feeCents: number;
  capacity: number;
  maxPerOrder?: number;
  /** BUYER: preço + taxa no checkout · PRODUCER: produtor absorve a taxa */
  feeMode?: FeeMode;
  nominal?: boolean;
  requiresCpf?: boolean;
  /** oferece meia-entrada (50%) — opt-in do produtor */
  halfPriceEnabled?: boolean;
  pdvOnly?: boolean;
  /** só para quem chega pelo link de um promoter da Casa */
  promoterOnly?: boolean;
  inviteMode?: LotInviteMode;
  /** ingressos deste lote por CPF; ausente = sem limite */
  limitPerCpf?: number;
  /** ISO; ausente = começa já / sem data para parar */
  startsAt?: string;
  endsAt?: string;
  /** virada automática: nasce guardado e abre quando este lote esgotar ou for encerrado */
  activateAfterLotId?: string;
  /** já nasce à venda (uma chamada só, sem lote repetido) */
  activateNow?: boolean;
}

/** Edição de lote: só o que mudou; null limpa (sem limite, sem data, sem virada). */
export interface UpdateLotInput {
  name?: string;
  priceCents?: number;
  capacity?: number;
  maxPerOrder?: number;
  limitPerCpf?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  inviteMode?: LotInviteMode;
  promoterOnly?: boolean;
  pdvOnly?: boolean;
  halfPriceEnabled?: boolean;
  activateAfterLotId?: string | null;
}

/** Lote como o painel do produtor edita (GET /v1/events/:id/ticket-lots). */
export interface ProducerLot {
  id: string;
  ticketTypeId: string;
  typeName: string;
  name: string;
  priceCents: number;
  feeCents: number;
  feeMode: FeeMode;
  nominal: boolean;
  requiresCpf: boolean;
  halfPriceEnabled: boolean;
  pdvOnly: boolean;
  promoterOnly: boolean;
  inviteMode: LotInviteMode;
  /** código do link de convite (só lote LINK) — é a chave do lote */
  inviteToken: string | null;
  limitPerCpf: number | null;
  capacity: number;
  maxPerOrder: number;
  soldCount: number;
  reservedCount: number;
  checkedInCount: number;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  activateAfterLotId: string | null;
  createdAt: string;
}

export interface ProducerLots {
  /** mínimo que o banco aceita numa cobrança online (o comprador paga pelo menos isto) */
  minimoCobrancaCents: number;
  lots: ProducerLot[];
}

/** O que a virada automática fez por causa desta ação (editar ou encerrar lote). */
export interface LotesDaVirada {
  /** lotes que abriram sozinhos */
  openedLots?: Array<{ id: string; name: string }>;
  /** encerrar um lote que ainda esperava a vez: os de trás passam a esperar o anterior dele */
  requeuedLots?: Array<{ id: string; name: string }>;
  requeuedAfter?: { id: string; name: string } | null;
}

export const catalogApi = {
  createTicketType: (token: string, eventId: string, input: { name: string; position?: number }) =>
    request<TicketType>(`/v1/events/${eventId}/ticket-types`, { method: "POST", body: input, token }),
  /**
   * `idempotencyKey` (2026-10-13): a mesma chave por tentativa — a resposta que
   * se perde e o "Tentar novamente" devolvem o lote já criado, sem um 2º lote.
   */
  createLot: (token: string, ticketTypeId: string, input: CreateLotInput, idempotencyKey?: string) =>
    request<TicketLot>(`/v1/ticket-types/${ticketTypeId}/lots`, { method: "POST", body: input, token, idempotencyKey }),
  listLots: (token: string, eventId: string) =>
    request<ProducerLots>(`/v1/events/${eventId}/ticket-lots`, { token }),
  updateLot: (token: string, lotId: string, input: UpdateLotInput) =>
    request<TicketLot & LotesDaVirada>(`/v1/ticket-lots/${lotId}`, { method: "PATCH", body: input, token }),
  rotateInviteLink: (token: string, lotId: string) =>
    request<{ id: string; inviteToken: string }>(`/v1/ticket-lots/${lotId}/invite-link/rotate`, {
      method: "POST",
      token,
    }),
  activateLot: (token: string, lotId: string) =>
    request<TicketLot>(`/v1/ticket-lots/${lotId}/activate`, { method: "POST", token }),
  closeLot: (token: string, lotId: string) =>
    request<TicketLot & LotesDaVirada>(`/v1/ticket-lots/${lotId}/close`, { method: "POST", token }),
  deleteLot: (token: string, lotId: string) =>
    request<{ deleted: boolean }>(`/v1/ticket-lots/${lotId}`, { method: "DELETE", token }),
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface PixelSettings {
  metaPixelId?: string;
  ga4MeasurementId?: string;
  tiktokPixelId?: string;
}

export interface Dashboard {
  event: {
    id: string;
    organizationId: string;
    title: string;
    slug: string;
    status: string;
    category?: EventCategory | null;
    bannerUrl?: string | null;
    waitingRoomEnabled: boolean;
    waitingRoomConcurrency: number;
    pixelSettings?: PixelSettings | null;
    venue?: EventVenue | null;
  };
  /** bruto pago pelo comprador (taxa da plataforma dentro) */
  revenueCents: number;
  /** o que sobra pra casa neste evento; null sem permissão de financeiro */
  netCents: number | null;
  orders: { total: number; byStatus: Record<string, number> };
  tickets: { total: number; byStatus: Record<string, number> };
  lots: Array<{
    id: string;
    name: string;
    ticketTypeId: string;
    typeName: string;
    priceCents: number;
    feeCents: number;
    feeMode?: FeeMode;
    nominal?: boolean;
    requiresCpf?: boolean;
    capacity: number;
    sold: number;
    reserved: number;
    available: number;
    status: string;
  }>;
  reviews: { average: number | null; count: number };
}

export interface Participant {
  id: string;
  code: string;
  status: string;
  attendeeName: string | null;
  attendeeEmail: string | null;
  checkedInAt: string | null;
  typeName: string;
  lotName: string;
}

export interface CheckinLive {
  eventId: string;
  totalTickets: number;
  checkedIn: number;
  remaining: number;
  perMinute: number;
  byCheckinPoint: Array<{ checkinPointId: string | null; count: number }>;
  curve: Array<{
    bucketStart: string;
    total: number;
    byCheckinPoint: Array<{ checkinPointId: string | null; count: number }>;
  }>;
  generatedAt: string;
}

export interface SalesBySeller {
  sellerId: string;
  sellerName: string | null;
  sellerEmail: string | null;
  partnerId: string | null;
  partnerName: string | null;
  ordersOk: number;
  ordersFailed: number;
  ticketsSold: number;
  revenueCents: number;
  commissionCents: number;
}

export interface SalesByPartner {
  partnerId: string;
  partnerName: string | null;
  partnerSlug: string | null;
  ordersOk: number;
  ordersFailed: number;
  ticketsSold: number;
  revenueCents: number;
  commissionCents: number;
}

export const dashboardApi = {
  get: (token: string, eventId: string) => request<Dashboard>(`/v1/events/${eventId}/dashboard`, { token }),
  checkinLive: (token: string, eventId: string) =>
    request<CheckinLive>(`/v1/events/${eventId}/checkin-live`, { token }),
  salesBySeller: (token: string, eventId: string) =>
    request<SalesBySeller[]>(`/v1/events/${eventId}/sales-by-seller`, { token }),
  salesByPartner: (token: string, eventId: string) =>
    request<SalesByPartner[]>(`/v1/events/${eventId}/sales-by-partner`, { token }),
  /**
   * Assina o SSE da competição por atlética/parceiro. O EventSource nativo não manda
   * header Authorization, então lemos o stream via fetch — cada "event: update" chama
   * onUpdate (o front decide o que fazer, normalmente refetch do sales-by-partner).
   * Retorna uma função de cleanup; reconecta sozinho se a conexão cair.
   */
  streamSalesByPartner: (token: string, eventId: string, onUpdate: () => void): (() => void) => {
    const controller = new AbortController();
    let stopped = false;

    async function connect() {
      while (!stopped) {
        try {
          const response = await fetch(`${API_BASE_URL}/v1/events/${eventId}/sales-by-partner/stream`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
            cache: "no-store",
          });
          // sessão vencida: reconectar a cada 3s com o mesmo token nunca daria certo
          if (avisarSessaoVencida(response.status, token)) return;
          if (!response.ok || !response.body) throw new Error("stream indisponível");

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split("\n\n");
            buffer = chunks.pop() ?? "";
            for (const chunk of chunks) {
              if (chunk.includes("event: update")) onUpdate();
            }
          }
        } catch (err) {
          if (stopped || (err instanceof DOMException && err.name === "AbortError")) return;
        }
        if (!stopped) await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }

    connect();
    return () => {
      stopped = true;
      controller.abort();
    };
  },
  /** por página (2026-10-12): a rota deixou de devolver todos os ingressos de uma vez; `q` busca no servidor */
  participants: (token: string, eventId: string, params?: { page?: number; pageSize?: number; q?: string }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.pageSize) query.set("pageSize", String(params.pageSize));
    if (params?.q?.trim()) query.set("q", params.q.trim());
    const qs = query.toString();
    return request<{ total: number; page: number; pageSize: number; participants: Participant[] }>(
      `/v1/events/${eventId}/participants${qs ? `?${qs}` : ""}`,
      { token },
    );
  },
  /**
   * Participantes. `vazio` = evento sem ingresso emitido (a planilha sai só
   * com o cabeçalho e a tela avisa, para não parecer falha). O tratamento de
   * rede, sessão e recusa é o de `baixarCsv`, comum aos três CSVs.
   */
  downloadParticipantsCsv: (token: string, eventId: string): Promise<{ vazio: boolean }> =>
    baixarCsv(token, `/v1/events/${eventId}/participants/export`, "participantes.csv", "Não foi possível exportar os participantes"),
  /**
   * Pedidos (2026-10-12): mesmo caminho dos outros CSVs. Antes a recusa do
   * servidor virava só "Não foi possível exportar" (sem o motivo), a rede fora
   * vazava "Failed to fetch" cru e a URL era revogada no mesmo instante do
   * clique — em alguns navegadores o download saía cortado ou nem começava.
   * `vazio` = evento sem pedido (a planilha sai só com o cabeçalho).
   */
  downloadOrdersCsv: (token: string, eventId: string): Promise<{ vazio: boolean }> =>
    baixarCsv(token, `/v1/events/${eventId}/orders/export`, "pedidos.csv", "Não foi possível exportar os pedidos"),
  /**
   * Meia-entrada (2026-10-12, Decreto 8.537/2015): um ingresso de meia por
   * linha. `vazio` = o evento não tem nenhuma meia; a planilha sai só com o
   * cabeçalho e a tela avisa, para não parecer que a exportação falhou.
   */
  downloadMeiaEntradaCsv: (token: string, eventId: string): Promise<{ vazio: boolean }> =>
    baixarCsv(token, `/v1/events/${eventId}/half-price/export`, "meia-entrada.csv", "Não foi possível exportar a meia-entrada"),
};

/** Texto da recusa do servidor (`message` do Nest, string ou lista); sem JSON, o padrão. */
export function mensagemDaRecusa(corpo: string, padrao: string): string {
  try {
    const dados: unknown = JSON.parse(corpo);
    const message = dados && typeof dados === "object" ? (dados as { message?: unknown }).message : undefined;
    if (Array.isArray(message)) {
      const juntas = message.filter((m) => typeof m === "string" && m.trim()).join(" · ");
      if (juntas) return juntas;
    } else if (typeof message === "string" && message.trim()) {
      return message;
    }
  } catch {
    // corpo sem JSON (ex.: página de erro do proxy): fica a mensagem padrão
  }
  return padrao;
}

/** Só o cabeçalho (ou nada) = nenhuma linha de dado. */
export function csvSemLinhas(texto: string): boolean {
  return !texto.trim().includes("\n");
}

/**
 * CSVs do painel (2026-10-12) — um caminho só para os três. O export exige
 * sessão (SessionGuard): um <a href> puro não manda o Authorization, então o
 * arquivo vem por fetch e o download sai de um blob. Rede fora vira texto
 * legível, 401 avisa a sessão vencida (como o `request`), a recusa vem com o
 * motivo do servidor, e a URL do blob só é revogada depois que o download
 * começou (revogar no mesmo instante corta o download em alguns navegadores).
 */
async function baixarCsv(
  token: string,
  caminho: string,
  nomeDoArquivo: string,
  mensagemPadrao: string,
): Promise<{ vazio: boolean }> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${caminho}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    // "Failed to fetch" cru vira o mesmo texto do resto do painel
    throw new ApiError(0, "Falha de conexão com o servidor — confira a internet e tente de novo.");
  }
  if (avisarSessaoVencida(response.status, token)) throw new ApiError(401, SESSION_EXPIRED_MESSAGE);
  let texto: string;
  try {
    texto = await response.text();
  } catch {
    // a conexão caiu no meio do arquivo: nada de planilha cortada
    throw new ApiError(0, "A conexão caiu no meio do download — tente de novo.");
  }
  if (!response.ok) throw new ApiError(response.status, mensagemDaRecusa(texto, mensagemPadrao));

  const url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeDoArquivo;
  // Firefox só dispara o download de link que está no documento
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { vazio: csvSemLinhas(texto) };
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export interface Balance {
  organizationId: string;
  balanceCents: number;
  availableForPayoutCents: number;
  heldCents?: number;
  anticipationFeeCents?: number;
  settlementMode?: "STANDARD" | "INSTANT";
}

export interface LedgerEntry {
  id: string;
  type: string;
  amountCents: number;
  referenceType: string;
  referenceId: string;
  createdAt: string;
}

export interface OrgRefundRequest {
  id: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedAt: string;
  resolutionNote: string | null;
  order: {
    publicToken: string;
    contactName: string | null;
    contactEmail: string;
    totalCents: number;
    status: string;
    event: { title: string };
  };
}

export const financeApi = {
  getBalance: (token: string, organizationId: string) =>
    request<Balance>(`/v1/organizations/${organizationId}/balance`, { token }),
  getLedger: (token: string, organizationId: string) =>
    request<LedgerEntry[]>(`/v1/organizations/${organizationId}/ledger`, { token }),
  listRefundRequests: (token: string, organizationId: string) =>
    request<OrgRefundRequest[]>(`/v1/organizations/${organizationId}/refund-requests`, { token }),
  approveRefundRequest: (token: string, organizationId: string, id: string) =>
    request(`/v1/organizations/${organizationId}/refund-requests/${id}/approve`, {
      method: "POST",
      body: {},
      token,
    }),
  rejectRefundRequest: (token: string, organizationId: string, id: string, note: string) =>
    request(`/v1/organizations/${organizationId}/refund-requests/${id}/reject`, {
      method: "POST",
      body: { note },
      token,
    }),
};

// ---------------------------------------------------------------------------
// Validador (configuração pelo produtor)
// ---------------------------------------------------------------------------

export interface CheckinPoint {
  id: string;
  name: string;
  active: boolean;
}

export interface ValidatorDevice {
  id: string;
  name: string;
  status: string;
  registeredAt: string;
  lastSeenAt: string | null;
}

export const validatorConfigApi = {
  listCheckinPoints: (token: string, eventId: string) =>
    request<CheckinPoint[]>(`/v1/events/${eventId}/checkin-points`, { token }),
  createCheckinPoint: (token: string, eventId: string, name: string) =>
    request<CheckinPoint>(`/v1/events/${eventId}/checkin-points`, { method: "POST", body: { name }, token }),
  createCredential: (token: string, eventId: string, label: string) =>
    request<{ id: string; label: string; expiresAt: string; pin: string }>(
      `/v1/events/${eventId}/validator-credentials`,
      { method: "POST", body: { label }, token },
    ),
  listDevices: (token: string, eventId: string) =>
    request<ValidatorDevice[]>(`/v1/events/${eventId}/validator-devices`, { token }),
  blockDevice: (token: string, eventId: string, deviceId: string) =>
    request(`/v1/events/${eventId}/validator-devices/${deviceId}/block`, { method: "POST", token }),
  /** Entradas do evento para "Desfazer entrada" (50 mais recentes; busca por nome ou código). */
  listRecentCheckins: (token: string, eventId: string, busca?: string) =>
    request<RecentCheckinsResponse>(
      `/v1/events/${eventId}/recent-checkins${busca ? `?busca=${encodeURIComponent(busca)}` : ""}`,
      { token },
    ),
  /** Desfaz uma entrada (dono/admin, sem limite de tempo). O ingresso volta a valer na porta. */
  reverseCheckin: (token: string, checkinId: string) =>
    request<{ reversed: boolean; ticketActive?: boolean }>(`/v1/checkins/${checkinId}/reverse`, {
      method: "POST",
      token,
    }),
};

/** Uma entrada registrada na porta (Check-in → "Desfazer entrada"). */
export interface RecentCheckin {
  checkinId: string;
  /** hora da leitura na porta */
  at: string;
  gate: string | null;
  deviceName: string;
  /** registrada sem internet e enviada depois */
  offline: boolean;
  code: string;
  name: string | null;
  buyerName: string | null;
  typeName: string;
  lotName: string;
  meia: boolean;
  /** false quando o pedido foi cancelado/reembolsado depois da entrada */
  canUndo: boolean;
}

export interface RecentCheckinsResponse {
  entries: RecentCheckin[];
  /** há mais entradas além das mostradas — a busca acha as outras */
  hasMore: boolean;
}

export const passwordAuth = {
  register: (input: { name: string; email: string; password: string }) =>
    request<{ token: string; user: SessionUser }>("/v1/identity/register", {
      method: "POST",
      body: { ...input, acceptTerms: true },
    }),
  login: (email: string, password: string) =>
    request<{ token: string; user: SessionUser }>("/v1/identity/login", {
      method: "POST",
      body: { email, password },
    }),
  recover: (email: string) =>
    request<{ sent: boolean }>("/v1/identity/recover", { method: "POST", body: { email } }),
  reset: (token: string, password: string) =>
    request<{ token: string; user: SessionUser }>("/v1/identity/reset-password", {
      method: "POST",
      body: { token, password },
    }),
};

export interface UpdateEventInput {
  title?: string;
  description?: string;
  /** atrações, uma por linha */
  lineup?: string;
  /** o que está incluso, um item por linha */
  amenities?: string;
  /** idade mínima em anos */
  minAge?: number;
  /** null limpa a categoria no servidor (a opção "Sem categoria" do painel). */
  category?: EventCategory | null;
  startsAt?: string;
  endsAt?: string;
  /** updateEventSchema valida `z.string().url().optional()` — null derruba a request. */
  bannerUrl?: string;
  waitingRoomEnabled?: boolean;
  waitingRoomConcurrency?: number;
  pixelSettings?: PixelSettings;
  /** Token da API de Conversões da Meta; "" ou null desliga. */
  metaCapiToken?: string | null;
  /** A API cria/atualiza o local e vincula ao evento. */
  venue?: EventVenue;
  /** evento privado (abre só por link); abrir um publicado avisa os seguidores uma vez — o servidor decide */
  isPrivate?: boolean;
}

export interface CancelPreview {
  eventId: string;
  alreadyCanceled: boolean;
  /** quantos pedidos ainda têm dinheiro a devolver */
  orders: number;
  /** pedidos de R$ 0 ainda valendo (lote grátis, cupom 100%, cortesia, lista) — são cancelados junto */
  freeOrders?: number;
  refundTotalCents: number;
  /** taxa da plataforma que volta pro produtor */
  feeBackCents: number;
  balanceCents: number;
  balanceAfterCents: number;
}

export interface CancelResult {
  canceled: boolean;
  refundedNow: number;
  refundedCents: number;
  feeBackCents: number;
  /** ingressos grátis cancelados nesta volta (não entram em refundedNow: não houve dinheiro) */
  freeCanceledNow?: number;
  remaining: number;
  errors: Array<{ orderId: string; message: string }>;
}

export const eventControls = {
  cancelPreview: (eventId: string, token: string) =>
    request<CancelPreview>(`/v1/events/${eventId}/cancel-preview`, { token }),
  /** Repetir enquanto `remaining` > 0: cada chamada devolve um lote. */
  cancel: (
    eventId: string,
    body: { reason: string; batchSize?: number; skipOrderIds?: string[] },
    token: string,
  ) =>
    request<CancelResult>(`/v1/events/${eventId}/cancel`, { method: "POST", body, token }),
  unpublish: (eventId: string, token: string) =>
    request(`/v1/events/${eventId}/unpublish`, { method: "POST", token }),
  republish: (eventId: string, token: string) =>
    request(`/v1/events/${eventId}/republish`, { method: "POST", token }),
  update: (eventId: string, body: UpdateEventInput, token: string) =>
    request<EventSummary>(`/v1/events/${eventId}`, { method: "PATCH", body, token }),
  /**
   * Upload do banner (multipart, campo "file") — fora do `request` porque lá o
   * corpo vira JSON; aqui o browser define o Content-Type com boundary sozinho.
   */
  uploadBanner: async (eventId: string, file: File, token: string): Promise<{ bannerUrl: string }> => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${API_BASE_URL}/v1/events/${eventId}/banner`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (avisarSessaoVencida(response.status, token)) throw new ApiError(401, SESSION_EXPIRED_MESSAGE);
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!response.ok) throw new ApiError(response.status, data?.message ?? "Falha ao enviar o banner");
    return data as { bannerUrl: string };
  },
};

export const couponsApi = {
  list: (eventId: string, token: string) =>
    request<Array<{ id: string; code: string; discountType: string; discountValue: number; redeemedCount: number; maxRedemptions: number | null; active: boolean }>>(
      `/v1/events/${eventId}/coupons`, { token }),
  create: (eventId: string, body: Record<string, unknown>, token: string) =>
    request(`/v1/events/${eventId}/coupons`, { method: "POST", body, token }),
  deactivate: (couponId: string, token: string) =>
    request(`/v1/coupons/${couponId}/deactivate`, { method: "POST", token }),
};

export const complimentaryApi = {
  list: (eventId: string, token: string) =>
    request<Array<{ id: string; publicToken: string; contactName: string | null; contactEmail: string; status: string; createdAt: string; items: Array<{ quantity: number; ticketLot: { name: string } }> }>>(
      `/v1/events/${eventId}/complimentary-tickets`, { token }),
  issue: (eventId: string, body: Record<string, unknown>, token: string) =>
    request(`/v1/events/${eventId}/complimentary-tickets`, { method: "POST", body, token }),
};

export interface BankAccount {
  id: string;
  bankCode: string;
  agency: string;
  account: string;
  accountType: string;
  holderName: string;
  holderDocument: string;
  pixKey?: string | null;
  isDefault: boolean;
}

/** createBankAccountSchema exige holderDocument e accountType — sem eles a API devolve 400. */
export interface CreateBankAccountInput {
  holderName: string;
  holderDocument: string;
  bankCode: string;
  agency: string;
  account: string;
  accountType: "corrente" | "poupanca";
  pixKey?: string;
}

export const bankAccountsApi = {
  add: (organizationId: string, body: CreateBankAccountInput, token: string) =>
    request<BankAccount>(`/v1/organizations/${organizationId}/bank-accounts`, { method: "POST", body, token }),
  list: (organizationId: string, token: string) =>
    request<BankAccount[]>(`/v1/organizations/${organizationId}/bank-accounts`, { token }),
};

// ---------------------------------------------------------------------------
// Vendas (pedidos + PDV + reembolso) — painel > evento > Vendas
// ---------------------------------------------------------------------------

export interface OrderSummary {
  id: string;
  publicToken: string;
  contactName: string | null;
  contactEmail: string;
  status: string;
  totalCents: number;
  createdAt: string;
  paidAt: string | null;
  _count: { tickets: number };
}

export interface OrderDetail {
  id: string;
  publicToken: string;
  contactName: string | null;
  contactEmail: string;
  status: string;
  totalCents: number;
  discountCents: number;
  createdAt: string;
  paidAt: string | null;
  /** false para lista/porta (endereço sintético): ninguém lê esse e-mail */
  contactEmailReal?: boolean;
  event: { id: string; title: string };
  items: Array<{
    id: string;
    quantity: number;
    priceCents: number;
    feeCents: number;
    ticketLotId: string;
    ticketLot: { name: string; ticketType: { name: string } };
  }>;
  payments: Array<{ id: string; method: string; status: string; amountCents: number; provider: string; paidAt: string | null }>;
  tickets: Array<{ id: string; code: string; status: string; attendeeName: string | null; ticketLotId?: string }>;
}

export const ordersApi = {
  list: (eventId: string, token: string, params?: { status?: string; page?: number; pageSize?: number }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.page) query.set("page", String(params.page));
    if (params?.pageSize) query.set("pageSize", String(params.pageSize));
    const qs = query.toString();
    return request<{ total: number; page: number; pageSize: number; orders: OrderSummary[] }>(
      `/v1/events/${eventId}/orders${qs ? `?${qs}` : ""}`, { token },
    );
  },
  detail: (orderId: string, token: string) => request<OrderDetail>(`/v1/orders/${orderId}/detail`, { token }),
  refund: (orderId: string, body: { amountCents?: number; reason: string }, token: string) =>
    request(`/v1/orders/${orderId}/refund`, { method: "POST", body, token }),
  /** Pedido de R$ 0 não se reembolsa, se cancela (2026-10-11): QR para de valer, vaga volta, pessoa avisada. */
  cancelFree: (orderId: string, body: { reason?: string }, token: string) =>
    request<Pick<OrderDetail, "status" | "tickets">>(`/v1/orders/${orderId}/cancel-free`, { method: "POST", body, token }),
  createPdvSale: (
    eventId: string,
    body: { ticketLotId: string; quantity: number; buyerName: string; buyerDocument?: string; buyerEmail?: string },
    token: string,
  ) => request<{ orderId: string; publicToken: string }>(`/v1/events/${eventId}/pdv-orders`, { method: "POST", body, token }),
};

// ---------------------------------------------------------------------------
// Repasses (payouts) — leitura, painel > Financeiro (criação é exclusiva do backoffice admin)
// ---------------------------------------------------------------------------

export interface Payout {
  id: string;
  amountCents: number;
  status: string;
  requestedAt: string;
  paidAt: string | null;
  notes: string | null;
}

/** Solicitação de saque feita pelo produtor (fila que o backoffice aprova). */
export interface PayoutRequest {
  id: string;
  amountCents: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "PAID" | string;
  notes: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

// ---------------------------------------------------------------------------
// Lista de convidados
// ---------------------------------------------------------------------------

export type GuestListStatus = "CONFIRMED" | "CHECKED_IN" | "CANCELED";

export interface GuestListEntry {
  id: string;
  eventId: string;
  ticketLotId: string;
  salesPartnerId: string | null;
  addedByUserId: string;
  orderId: string | null;
  guestName: string;
  guestDocument: string | null;
  guestPhone: string | null;
  status: GuestListStatus;
  ticketId: string | null;
  createdAt: string;
  ticketLot: { name: string };
  salesPartner: { id: string; name: string } | null;
  ticket: { id: string; status: string; code: string; checkedInAt: string | null } | null;
}

export interface CreateGuestListEntryInput {
  ticketLotId: string;
  guestName: string;
  /**
   * OBRIGATÓRIO desde 2026-09-15: convidado de lista não recebe ingresso, então
   * o CPF é a única prova de identidade dele na porta. Tipado como obrigatório
   * de propósito — o servidor recusa sem ele, e um chamador novo tem que
   * descobrir isso no compilador, não no 400 em produção.
   */
  guestDocument: string;
  guestPhone?: string;
  salesPartnerId?: string;
}

export const guestListApi = {
  list: (token: string, eventId: string) =>
    request<GuestListEntry[]>(`/v1/events/${eventId}/guest-list`, { token }),
  create: (token: string, eventId: string, input: CreateGuestListEntryInput) =>
    request<GuestListEntry>(`/v1/events/${eventId}/guest-list`, { method: "POST", body: input, token }),
  cancel: (token: string, eventId: string, id: string) =>
    request<GuestListEntry>(`/v1/events/${eventId}/guest-list/${id}`, { method: "DELETE", token }),
};

// ---------------------------------------------------------------------------
// Convite por e-mail (2026-10-12) — lote "Só quem eu convidar por e-mail"
// ---------------------------------------------------------------------------

/** Calculada no servidor (convite + pedido + entrega do e-mail). */
export type SituacaoConviteEmail =
  | "ENVIADO"
  | "ENTREGUE"
  | "VOLTOU"
  | "NAO_SAIU"
  | "PAGANDO"
  | "PEGOU"
  | "REVOGADO";

export interface ConviteEmail {
  id: string;
  email: string;
  situacao: SituacaoConviteEmail;
  enviadoEm: string;
  criadoEm: string;
  pegouEm: string | null;
  podeReenviar: boolean;
  podeCorrigir: boolean;
  podeRevogar: boolean;
}

export interface ConvitesDoLote {
  lote: {
    id: string;
    name: string;
    ticketTypeName: string;
    status: string;
    inviteMode: string;
    priceCents: number;
    capacity: number;
    disponiveis: number;
  };
  evento: { id: string; title: string; slug: string };
  /** null = dá para mandar convites agora; senão, o motivo (envio travado) */
  motivoParaNaoMandar: string | null;
  resumo: { convidados: number; pegaram: number; voltaram: number };
  convites: ConviteEmail[];
}

export interface LoteDeConviteEmail {
  id: string;
  name: string;
  ticketTypeName: string;
  status: string;
  /** convites que não foram revogados */
  convites: number;
}

export interface ResultadoDoEnvioDeConvites {
  enviados: string[];
  jaConvidados: string[];
  invalidos: Array<{ email: string; motivo: string }>;
  repetidosNaLista: number;
}

export const convitesEmailApi = {
  lotes: (token: string, eventId: string) =>
    request<LoteDeConviteEmail[]>(`/v1/events/${eventId}/convites-email/lotes`, { token }),
  listar: (token: string, lotId: string) =>
    request<ConvitesDoLote>(`/v1/ticket-lots/${lotId}/convites-email`, { token }),
  criar: (token: string, lotId: string, emails: string[]) =>
    request<ResultadoDoEnvioDeConvites>(`/v1/ticket-lots/${lotId}/convites-email`, {
      method: "POST",
      body: { emails },
      token,
    }),
  reenviar: (token: string, id: string) =>
    request<ConviteEmail>(`/v1/convites-email/${id}/reenviar`, { method: "POST", token }),
  corrigir: (token: string, id: string, email: string) =>
    request<ConviteEmail>(`/v1/convites-email/${id}/corrigir`, { method: "POST", body: { email }, token }),
  revogar: (token: string, id: string) =>
    request<ConviteEmail>(`/v1/convites-email/${id}/revogar`, { method: "POST", token }),
};

// ---------------------------------------------------------------------------
// Web Push (notificações de venda) — inscrição do navegador do produtor
// ---------------------------------------------------------------------------

/** Exatamente o shape de PushSubscription.toJSON() que o backend espera. */
export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export const pushApi = {
  /** Salva a inscrição do navegador para receber push de vendas. */
  subscribe: (token: string, subscription: PushSubscriptionPayload) =>
    request("/v1/me/push-subscriptions", { method: "POST", body: subscription, token }),
  /** Remove a inscrição ao desativar as notificações neste dispositivo. */
  unsubscribe: (token: string, endpoint: string) =>
    request("/v1/me/push-subscriptions", { method: "DELETE", body: { endpoint }, token }),
};

export const payoutsApi = {
  list: (organizationId: string, token: string) =>
    request<Payout[]>(`/v1/organizations/${organizationId}/payouts`, { token }),
  listRequests: (organizationId: string, token: string) =>
    request<PayoutRequest[]>(`/v1/organizations/${organizationId}/payout-requests`, { token }),
  requestPayout: (organizationId: string, amountCents: number, token: string, anticipation = false) =>
    request<PayoutRequest & { needsApproval: boolean; payoutId: string | null; anticipationFeeCents: number }>(
      `/v1/organizations/${organizationId}/payout-requests`,
      {
        method: "POST",
        body: { amountCents, anticipation },
        token,
      },
    ),
};
