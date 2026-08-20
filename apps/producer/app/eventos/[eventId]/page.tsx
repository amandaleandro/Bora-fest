"use client";

import { CHECKOUT_URL } from "@/lib/config";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth";
import { catalogApi, eventsApi, dashboardApi, eventControls, couponsApi, complimentaryApi, addOnsApi, UF_LIST, EVENT_CATEGORIES, type Dashboard, type EventVenue, type EventCategory, type EventAddOn, type FeeMode } from "@/lib/api";
import { FeeModeField, NominalFields } from "@/components/FeeModeField";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Aceita "49,90" e "49.90". Inválido/vazio → 0. */
function parsePriceCents(value: string): number {
  const n = Number(value.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

/**
 * Espelho (só para exibição) da taxa calculada pelo SERVIDOR:
 * 4,99% do preço com piso de R$ 2,49; ingresso grátis = taxa 0.
 */
function serviceFeeCents(priceCents: number): number {
  if (priceCents <= 0) return 0;
  // espelho da taxa REAL do servidor (fees.ts): 5% com piso de R$ 1
  return Math.max(Math.round(priceCents * 0.05), 100);
}

const BANNER_MAX_BYTES = 5 * 1024 * 1024;
const BANNER_TYPES = ["image/jpeg", "image/png", "image/webp"];

const STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  DRAFT: { bg: "bg-warning/10", fg: "text-warning", label: "Rascunho" },
  PUBLISHED: { bg: "bg-success/10", fg: "text-success", label: "Publicado" },
  SALES_PAUSED: { bg: "bg-warning/10", fg: "text-warning", label: "Vendas pausadas" },
  UNPUBLISHED: { bg: "bg-line", fg: "text-muted", label: "Despublicado" },
  CANCELLED: { bg: "bg-danger/10", fg: "text-danger", label: "Cancelado" },
};

interface LocalTicketType {
  id: string;
  name: string;
}

function EventContent({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [sessionTypes, setSessionTypes] = useState<LocalTicketType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form unificado de ingresso (decisão 2026-08-13: criar tipo + 1º lote numa
  // tacada só, padrão de mercado): null = fechado; {} = ingresso novo;
  // { typeId, typeName } = novo lote de um ingresso que já existe.
  const [ticketForm, setTicketForm] = useState<null | { typeId?: string; typeName?: string }>(null);
  const [typeName, setTypeName] = useState("");
  const [savingTicket, setSavingTicket] = useState(false);
  const [coupons, setCoupons] = useState<Array<{ id: string; code: string; discountType: string; discountValue: number; redeemedCount: number; maxRedemptions: number | null; active: boolean }>>([]);
  const [courtesies, setCourtesies] = useState<Array<{ id: string; contactName: string | null; contactEmail: string; status: string; items: Array<{ quantity: number; ticketLot: { name: string } }> }>>([]);
  const [couponCode, setCouponCode] = useState("");
  const [couponType, setCouponType] = useState("PERCENT");
  const [couponValue, setCouponValue] = useState("");
  const [couponMax, setCouponMax] = useState("");
  const [courtesyLot, setCourtesyLot] = useState("");
  const [courtesyQty, setCourtesyQty] = useState("1");
  const [courtesyName, setCourtesyName] = useState("");
  const [courtesyEmail, setCourtesyEmail] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [bannerUploading, setBannerUploading] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [waitingRoomEnabled, setWaitingRoomEnabled] = useState(false);
  const [waitingRoomConcurrency, setWaitingRoomConcurrency] = useState("300");
  const [waitingRoomSaving, setWaitingRoomSaving] = useState(false);
  const [waitingRoomError, setWaitingRoomError] = useState<string | null>(null);
  const [metaPixelId, setMetaPixelId] = useState("");
  const [ga4MeasurementId, setGa4MeasurementId] = useState("");
  const [tiktokPixelId, setTiktokPixelId] = useState("");
  const [pixelSaving, setPixelSaving] = useState(false);
  const [pixelError, setPixelError] = useState<string | null>(null);
  const [category, setCategory] = useState<EventCategory | "">("");
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [addOns, setAddOns] = useState<EventAddOn[]>([]);
  const [addOnName, setAddOnName] = useState("");
  const [addOnPrice, setAddOnPrice] = useState("");
  const [addOnSaving, setAddOnSaving] = useState(false);
  const [addOnError, setAddOnError] = useState<string | null>(null);
  const [venue, setVenue] = useState<EventVenue | null>(null);
  const [editingVenue, setEditingVenue] = useState(false);
  const [venueForm, setVenueForm] = useState<EventVenue>({ name: "", address: "", city: "", state: "" });
  const [venueCityOptions, setVenueCityOptions] = useState<string[]>([]);
  const [loadingVenueCities, setLoadingVenueCities] = useState(false);

  useEffect(() => {
    if (!venueForm.state) { setVenueCityOptions([]); return; }
    let cancelled = false;
    setLoadingVenueCities(true);
    fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${venueForm.state}/municipios`)
      .then((res) => res.json())
      .then((data: Array<{ nome: string }>) => {
        if (cancelled) return;
        setVenueCityOptions(data.map((m) => m.nome).sort((a, b) => a.localeCompare(b, "pt-BR")));
      })
      .catch(() => { if (!cancelled) setVenueCityOptions([]); })
      .finally(() => { if (!cancelled) setLoadingVenueCities(false); });
    return () => { cancelled = true; };
  }, [venueForm.state]);
  const [venueSaving, setVenueSaving] = useState(false);
  const [venueError, setVenueError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [lotName, setLotName] = useState("");
  const [lotPrice, setLotPrice] = useState("");
  const [lotCapacity, setLotCapacity] = useState("");
  const [lotMaxPerOrder, setLotMaxPerOrder] = useState("6");
  const [lotFeeMode, setLotFeeMode] = useState<FeeMode>("BUYER");
  const [lotNominal, setLotNominal] = useState(false);
  const [lotHalf, setLotHalf] = useState(false);
  const [lotRequiresCpf, setLotRequiresCpf] = useState(false);


  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const d = await dashboardApi.get(token, eventId);
      setDashboard(d);
      setBannerUrl(d.event.bannerUrl ?? "");
      setWaitingRoomEnabled(d.event.waitingRoomEnabled);
      setWaitingRoomConcurrency(String(d.event.waitingRoomConcurrency));
      setMetaPixelId(d.event.pixelSettings?.metaPixelId ?? "");
      setGa4MeasurementId(d.event.pixelSettings?.ga4MeasurementId ?? "");
      setTiktokPixelId(d.event.pixelSettings?.tiktokPixelId ?? "");
      setVenue(d.event.venue ?? null);
      setCategory(d.event.category ?? "");
      couponsApi.list(eventId, token).then(setCoupons).catch(() => {});
      complimentaryApi.list(eventId, token).then(setCourtesies).catch(() => {});
      addOnsApi.list(token, eventId).then(setAddOns).catch(() => {});
    } finally {
      setLoading(false);
    }
  }

  async function togglePublication() {
    if (!token || !dashboard) return;
    setError(null);
    try {
      if (dashboard.event.status === "PUBLISHED") await eventControls.unpublish(eventId, token);
      else if (dashboard.event.status === "SALES_PAUSED") await eventControls.republish(eventId, token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao alterar publicação");
    }
  }

  async function saveWaitingRoom(next: { waitingRoomEnabled: boolean; waitingRoomConcurrency: number }) {
    if (!token) return;
    setWaitingRoomError(null);
    setWaitingRoomSaving(true);
    try {
      await eventControls.update(eventId, next, token);
      setWaitingRoomEnabled(next.waitingRoomEnabled);
      setWaitingRoomConcurrency(String(next.waitingRoomConcurrency));
    } catch (err) {
      setWaitingRoomError(err instanceof Error ? err.message : "Falha ao salvar a sala de espera");
    } finally {
      setWaitingRoomSaving(false);
    }
  }

  async function savePixels() {
    if (!token) return;
    setPixelError(null);
    setPixelSaving(true);
    try {
      await eventControls.update(
        eventId,
        {
          pixelSettings: {
            metaPixelId: metaPixelId.trim() || undefined,
            ga4MeasurementId: ga4MeasurementId.trim() || undefined,
            tiktokPixelId: tiktokPixelId.trim() || undefined,
          },
        },
        token,
      );
    } catch (err) {
      setPixelError(err instanceof Error ? err.message : "Falha ao salvar os pixels");
    } finally {
      setPixelSaving(false);
    }
  }

  async function saveCategory(next: EventCategory | "") {
    if (!token) return;
    setCategoryError(null);
    setCategorySaving(true);
    try {
      // "Sem categoria" (next === "") precisa mandar null: o servidor só LIMPA
      // com null explícito — undefined era omitido e o select virava no-op.
      await eventControls.update(eventId, { category: next || null }, token);
      setCategory(next);
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : "Falha ao salvar a categoria");
    } finally {
      setCategorySaving(false);
    }
  }

  async function createAddOn() {
    if (!token || !addOnName.trim() || !addOnPrice) return;
    setAddOnError(null);
    setAddOnSaving(true);
    try {
      const priceCents = Math.round(Number(addOnPrice.replace(",", ".")) * 100) || 0;
      const created = await addOnsApi.create(token, eventId, { name: addOnName.trim(), priceCents });
      setAddOns((prev) => [...prev, created]);
      setAddOnName("");
      setAddOnPrice("");
    } catch (err) {
      setAddOnError(err instanceof Error ? err.message : "Falha ao criar o item adicional");
    } finally {
      setAddOnSaving(false);
    }
  }

  async function toggleAddOnActive(addOn: EventAddOn) {
    if (!token) return;
    try {
      const updated = await addOnsApi.update(token, addOn.id, { active: !addOn.active });
      setAddOns((prev) => prev.map((a) => (a.id === addOn.id ? updated : a)));
    } catch {
      // silencioso — o toggle não é uma ação crítica
    }
  }

  async function handleBannerFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo
    if (!file || !token) return;
    setBannerError(null);
    if (!BANNER_TYPES.includes(file.type)) {
      setBannerError("Formato não aceito — envie uma imagem JPG, PNG ou WebP.");
      return;
    }
    if (file.size > BANNER_MAX_BYTES) {
      setBannerError(`Imagem muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB) — o limite é 5 MB.`);
      return;
    }
    setBannerUploading(true);
    try {
      const result = await eventControls.uploadBanner(eventId, file, token);
      setBannerUrl(result.bannerUrl);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : "Falha ao enviar o banner — tente de novo.");
    } finally {
      setBannerUploading(false);
    }
  }

  function openVenueForm() {
    setVenueForm(venue ?? { name: "", address: "", mapsUrl: "", city: "", state: "" });
    setVenueError(null);
    setEditingVenue(true);
  }

  async function saveVenue() {
    if (!token) return;
    const next: EventVenue = {
      name: venueForm.name.trim(),
      address: venueForm.address?.trim() || undefined,
      mapsUrl: venueForm.mapsUrl?.trim() || undefined,
      city: venueForm.city.trim(),
      state: venueForm.state,
    };
    if (!next.name || !next.city || !next.state) {
      setVenueError("Preencha nome do lugar, cidade e UF.");
      return;
    }
    setVenueSaving(true);
    setVenueError(null);
    try {
      await eventControls.update(eventId, { venue: next }, token);
      setVenue(next);
      setEditingVenue(false);
    } catch (err) {
      setVenueError(err instanceof Error ? err.message : "Não foi possível salvar o local");
    } finally {
      setVenueSaving(false);
    }
  }

  async function createCoupon() {
    if (!token) return;
    setError(null);
    try {
      await couponsApi.create(eventId, {
        code: couponCode,
        discountType: couponType,
        discountValue: couponType === "PERCENT" ? Number(couponValue) : Math.round(Number(couponValue) * 100),
        maxRedemptions: couponMax ? Number(couponMax) : undefined,
      }, token);
      setCouponCode(""); setCouponValue(""); setCouponMax("");
      setCoupons(await couponsApi.list(eventId, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar cupom");
    }
  }

  async function issueCourtesy() {
    if (!token || !courtesyLot) return;
    setError(null);
    try {
      await complimentaryApi.issue(eventId, {
        ticketLotId: courtesyLot,
        quantity: Number(courtesyQty || "1"),
        attendeeName: courtesyName,
        attendeeEmail: courtesyEmail,
      }, token);
      setCourtesyName(""); setCourtesyEmail("");
      setCourtesies(await complimentaryApi.list(eventId, token));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao emitir cortesia");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, eventId]);

  async function handlePublish() {
    if (!token) return;
    setError(null);
    try {
      await eventsApi.publish(token, eventId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível publicar");
    }
  }

  /** "Failed to fetch" cru vira mensagem que o produtor entende. */
  function catalogError(err: unknown, fallback: string): string {
    if (err instanceof Error && /failed to fetch|networkerror|load failed/i.test(err.message)) {
      return "Falha de conexão com o servidor — confira a internet e tente de novo.";
    }
    return err instanceof Error && err.message ? err.message : fallback;
  }

  function resetLotFields(nextLotName: string) {
    setLotName(nextLotName);
    setLotPrice("");
    setLotCapacity("");
    setLotMaxPerOrder("6");
    setLotFeeMode("BUYER");
    setLotNominal(false);
    setLotRequiresCpf(false);
    setLotHalf(false);
  }

  function openNewTicket() {
    setError(null);
    setTypeName("");
    resetLotFields("1º lote");
    setTicketForm({});
  }

  function openNewLot(typeId: string, name: string, existingLots: number) {
    setError(null);
    resetLotFields(`${existingLots + 1}º lote`);
    setTicketForm({ typeId, typeName: name });
  }

  /** Fluxo unificado: cria o tipo (se for ingresso novo) + lote + ativa. */
  async function handleCreateTicket() {
    if (!token || !ticketForm) return;
    setError(null);
    setSavingTicket(true);
    try {
      let typeId = ticketForm.typeId;
      if (!typeId) {
        const type = await catalogApi.createTicketType(token, eventId, { name: typeName.trim() });
        setSessionTypes((prev) => [...prev, { id: type.id, name: type.name }]);
        typeId = type.id;
      }
      const priceCents = parsePriceCents(lotPrice);
      // maxPerOrder: contrato aceita 1..20 (default 6) — clampa pra não tomar 400.
      const maxPerOrder = Math.min(Math.max(Number(lotMaxPerOrder) || 6, 1), 20);
      const lot = await catalogApi.createLot(token, typeId, {
        name: lotName,
        priceCents,
        // A taxa é CALCULADA PELO SERVIDOR; este valor é ignorado lá,
        // mandamos o espelho só para satisfazer o contrato do schema.
        feeCents: serviceFeeCents(priceCents),
        capacity: Number(lotCapacity),
        maxPerOrder,
        feeMode: lotFeeMode,
        nominal: lotNominal,
        // CPF só faz sentido em lote nominal (o backend também amarra os dois)
        requiresCpf: lotNominal && lotRequiresCpf,
        halfPriceEnabled: lotHalf,
      });
      await catalogApi.activateLot(token, lot.id);
      setTicketForm(null);
      setTypeName("");
      resetLotFields("");
      await load();
    } catch (err) {
      setError(catalogError(err, "Não foi possível criar o ingresso"));
    } finally {
      setSavingTicket(false);
    }
  }

  if (loading || !dashboard) {
    return (
      <main>
        <p className="mt-6 text-muted">Carregando...</p>
      </main>
    );
  }

  const statusStyle = STATUS_STYLES[dashboard.event.status] ?? { bg: "bg-line", fg: "text-muted", label: dashboard.event.status };
  const publicUrl = `${CHECKOUT_URL}/${dashboard.event.slug}`;

  return (
    <main>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold">{dashboard.event.title}</h1>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusStyle.bg} ${statusStyle.fg}`}>
          {statusStyle.label}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {dashboard.event.status === "DRAFT" ? (
          <button type="button" className="btn-primary" onClick={handlePublish}>
            Publicar evento
          </button>
        ) : null}
        {/* o resto da navegação vive na sidebar (desktop) e nas pills (mobile);
            aqui só o que não existe lá — e a edição em destaque (2026-08-17) */}
        <Link
          href={`/eventos/${eventId}/editar`}
          className="rounded-full bg-primary px-4 py-1.5 text-[12.5px] font-extrabold text-white shadow-cta"
        >
          ✎ Editar dados do evento
        </Link>
        <Link href={`/eventos/${eventId}/checkin-ao-vivo`} className="chip-nav">
          Check-in ao vivo
        </Link>
        <Link href={`/eventos/${eventId}/lista-convidados`} className="chip-nav">
          Lista de convidados
        </Link>
      </div>

      {error ? <p className="mt-4 text-sm font-semibold text-danger">{error}</p> : null}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold">Ingressos</h2>
        {ticketForm === null ? (
          <button type="button" className="btn-primary px-4 py-2" onClick={openNewTicket}>
            + Criar ingresso
          </button>
        ) : null}
      </div>

      {ticketForm ? (
        <div className="mt-3 space-y-2 rounded-2xl border border-line bg-surface p-4">
          <p className="text-[14px] font-extrabold">
            {ticketForm.typeId ? `Novo lote em "${ticketForm.typeName}"` : "Novo ingresso"}
          </p>
          {!ticketForm.typeId ? (
            <div>
              <label className="text-[12px] font-bold text-ink-soft">Nome do ingresso</label>
              <input
                placeholder="Ex.: Pista, VIP, Camarote"
                className="mt-1 w-full"
                value={typeName}
                onChange={(e) => setTypeName(e.target.value)}
              />
            </div>
          ) : null}
          <div>
            <label className="text-[12px] font-bold text-ink-soft">Lote</label>
            <input placeholder="Ex.: 1º lote" className="mt-1 w-full" value={lotName} onChange={(e) => setLotName(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="min-w-0 flex-1">
              <label className="text-[12px] font-bold text-ink-soft">Quanto você quer receber (R$)</label>
              <input
                placeholder="Ex.: 20,00"
                className="mt-1 w-full"
                inputMode="decimal"
                value={lotPrice}
                onChange={(e) => setLotPrice(e.target.value)}
              />
            </div>
            <div className="min-w-0 flex-1">
              <label className="text-[12px] font-bold text-ink-soft">Quantidade de ingressos</label>
              <input
                placeholder="Ex.: 200"
                className="mt-1 w-full"
                inputMode="numeric"
                value={lotCapacity}
                onChange={(e) => setLotCapacity(e.target.value)}
              />
            </div>
            <div className="w-36 min-w-0">
              <label className="text-[12px] font-bold text-ink-soft">Máx. por pedido</label>
              <input
                className="mt-1 w-full"
                inputMode="numeric"
                value={lotMaxPerOrder}
                onChange={(e) => setLotMaxPerOrder(e.target.value)}
                title="Quantos ingressos deste lote cada pessoa pode comprar num pedido (1 a 20)"
              />
            </div>
          </div>
          <FeeModeField
            value={lotFeeMode}
            onChange={setLotFeeMode}
            priceCents={parsePriceCents(lotPrice)}
            feeCents={serviceFeeCents(parsePriceCents(lotPrice))}
          />
          <NominalFields
            nominal={lotNominal}
            requiresCpf={lotRequiresCpf}
            onChange={({ nominal, requiresCpf }) => {
              setLotNominal(nominal);
              setLotRequiresCpf(requiresCpf);
            }}
          />
          <label className="flex items-center gap-2 text-[13px] font-semibold">
            <input
              type="checkbox"
              checked={lotHalf}
              onChange={(e) => setLotHalf(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <span>
              Oferecer meia-entrada (50% do preço)
              <span className="block text-[11.5px] font-medium text-muted">
                Opcional — o comprador escolhe meia no checkout e o documento é conferido na portaria.
              </span>
            </span>
          </label>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className="btn-primary"
              onClick={handleCreateTicket}
              disabled={
                savingTicket ||
                (!ticketForm.typeId && typeName.trim().length < 2) ||
                !lotName ||
                !lotPrice ||
                !lotCapacity
              }
            >
              {savingTicket ? "Criando…" : ticketForm.typeId ? "Criar lote" : "Criar ingresso e começar a vender"}
            </button>
            <button
              type="button"
              className="btn-secondary px-4"
              onClick={() => setTicketForm(null)}
              disabled={savingTicket}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {(() => {
          // um card por INGRESSO (tipo), com os lotes dentro — em vez da
          // lista achatada "Tipo — Lote" que confundia (feedback 2026-08-13)
          const groups = new Map<string, { name: string; lots: typeof dashboard.lots }>();
          for (const lot of dashboard.lots) {
            const group = groups.get(lot.ticketTypeId) ?? { name: lot.typeName, lots: [] };
            group.lots.push(lot);
            groups.set(lot.ticketTypeId, group);
          }
          for (const type of sessionTypes) {
            if (!groups.has(type.id)) groups.set(type.id, { name: type.name, lots: [] });
          }
          if (groups.size === 0) {
            return (
              <p className="text-sm font-semibold text-muted">
                Nenhum ingresso ainda — toque em “Criar ingresso” para montar o primeiro.
              </p>
            );
          }
          return [...groups.entries()].map(([typeId, group]) => (
            <div key={typeId} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[15px] font-extrabold">{group.name}</p>
                <button
                  type="button"
                  className="btn-secondary px-3 py-1.5"
                  onClick={() => openNewLot(typeId, group.name, group.lots.length)}
                >
                  + Novo lote
                </button>
              </div>
              {group.lots.length === 0 ? (
                <p className="mt-2 text-[13px] font-semibold text-muted">
                  Sem lotes — adicione o primeiro para começar a vender.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {group.lots.map((lot) => (
                    <div key={lot.id} className="rounded-xl border border-line-divider bg-bg/50 px-3.5 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <div className="min-w-0">
                          <p className="font-bold">{lot.name}</p>
                          <p className="text-sm text-muted">
                            {formatCents(lot.priceCents)} + taxa {formatCents(lot.feeCents)} · {lot.sold}/{lot.capacity} vendidos
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-muted">{lot.status}</span>
                          {lot.status !== "CLOSED" ? (
                            <button
                              type="button"
                              className="h-8 rounded-lg border border-line px-3 text-[12px] font-bold text-muted hover:text-ink"
                              onClick={async () => {
                                if (!token) return;
                                if (!window.confirm(`Encerrar as vendas de "${lot.name}"? O lote some do site e não pode ser reativado.`)) return;
                                try {
                                  await catalogApi.closeLot(token, lot.id);
                                  await load();
                                } catch (err) {
                                  setError(catalogError(err, "Não foi possível encerrar o lote"));
                                }
                              }}
                            >
                              Encerrar
                            </button>
                          ) : null}
                          {lot.sold === 0 ? (
                            <button
                              type="button"
                              className="h-8 rounded-lg border border-danger/40 px-3 text-[12px] font-bold text-danger hover:bg-danger/5"
                              onClick={async () => {
                                if (!token) return;
                                if (!window.confirm(`Apagar o lote "${lot.name}"? Isso não pode ser desfeito.`)) return;
                                try {
                                  await catalogApi.deleteLot(token, lot.id);
                                  await load();
                                } catch (err) {
                                  setError(catalogError(err, "Não foi possível apagar o lote"));
                                }
                              }}
                            >
                              Apagar
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ));
        })()}
      </div>
      {/* --- Local do evento ------------------------------------------------ */}
      <section className="mt-10 rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-extrabold">Local</h2>
          {!editingVenue && (
            <button type="button" className="btn-secondary px-3 py-1.5" onClick={openVenueForm}>
              {venue ? "Editar" : "Adicionar local"}
            </button>
          )}
        </div>

        {editingVenue ? (
          <div className="mt-3 space-y-2">
            <input
              placeholder="Nome do lugar (ex.: Arena BSB)"
              className="w-full"
              value={venueForm.name}
              onChange={(e) => setVenueForm({ ...venueForm, name: e.target.value })}
            />
            <div className="flex gap-2">
              <select
                className="w-24 shrink-0"
                value={venueForm.state}
                onChange={(e) => setVenueForm({ ...venueForm, state: e.target.value, city: "" })}
              >
                <option value="">UF</option>
                {UF_LIST.map((uf) => (
                  <option key={uf} value={uf}>{uf}</option>
                ))}
              </select>
              <input
                list="venue-edit-city-options"
                placeholder={!venueForm.state ? "Selecione a UF primeiro" : loadingVenueCities ? "Carregando cidades…" : "Cidade"}
                disabled={!venueForm.state}
                className="w-full min-w-0 disabled:opacity-50"
                value={venueForm.city}
                onChange={(e) => setVenueForm({ ...venueForm, city: e.target.value })}
              />
              <datalist id="venue-edit-city-options">
                {venueCityOptions.map((city) => (
                  <option key={city} value={city} />
                ))}
              </datalist>
            </div>
            <input
              placeholder="Endereço (opcional)"
              className="w-full"
              value={venueForm.address ?? ""}
              onChange={(e) => setVenueForm({ ...venueForm, address: e.target.value })}
            />
            <input
              placeholder="Link do local no Google Maps (opcional)"
              type="url"
              className="w-full"
              value={venueForm.mapsUrl ?? ""}
              onChange={(e) => setVenueForm({ ...venueForm, mapsUrl: e.target.value })}
            />
            {venueError ? <p className="text-[13px] font-semibold text-danger">{venueError}</p> : null}
            <div className="flex gap-2">
              <button type="button" className="btn-primary" onClick={saveVenue} disabled={venueSaving}>
                {venueSaving ? "Salvando…" : "Salvar local"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setEditingVenue(false)} disabled={venueSaving}>
                Cancelar
              </button>
            </div>
          </div>
        ) : venue ? (
          <div className="mt-3 text-sm">
            <p className="font-bold">{venue.name}</p>
            <p className="text-muted">
              {venue.address ? `${venue.address} — ` : ""}
              {venue.city}/{venue.state}
              {venue.mapsUrl && (
                <>
                  {" — "}
                  <a href={venue.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    Ver no mapa
                  </a>
                </>
              )}
            </p>
          </div>
        ) : (
          <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-[13px] font-semibold text-warning">
            Este evento ainda não tem local. Sem local, ele não aparece na busca por cidade.
          </p>
        )}
      </section>

      {/* --- Publicação (link público + pausar/reabrir + banner) ------------ */}
      <section className="mt-10 rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-lg font-extrabold">Publicação</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener"
            className="max-w-full break-all rounded-lg bg-bg px-3 py-2 text-sm font-semibold text-primary underline underline-offset-2 hover:opacity-80"
          >
            {publicUrl}
          </a>
          <a href={publicUrl} target="_blank" rel="noopener" className="btn-primary px-3 py-2">
            Ver página do evento
          </a>
          <button
            type="button"
            className="btn-secondary px-3 py-2"
            onClick={() => {
              navigator.clipboard.writeText(publicUrl);
              setCopied(true); setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copiado!" : "Copiar link"}
          </button>
          {["PUBLISHED", "SALES_PAUSED"].includes(dashboard.event.status) && (
            <button
              type="button"
              onClick={togglePublication}
              className={`rounded-lg px-3 py-2 text-sm font-bold text-white ${dashboard.event.status === "PUBLISHED" ? "bg-warning" : "bg-success"}`}
            >
              {dashboard.event.status === "PUBLISHED" ? "Pausar vendas" : "Reabrir vendas"}
            </button>
          )}
        </div>

        <div className="mt-5">
          <h3 className="text-[13px] font-extrabold">Banner do evento</h3>
          <div className="mt-2 aspect-video w-full max-w-md overflow-hidden rounded-xl border border-line bg-bg">
            {bannerUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- domínio do banner é dinâmico
              <img src={bannerUrl} alt="Banner do evento" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-[13px] font-semibold text-muted">
                Nenhum banner ainda
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className={`btn-secondary cursor-pointer ${bannerUploading ? "pointer-events-none opacity-60" : ""}`}>
              {bannerUploading ? "Enviando…" : bannerUrl ? "Trocar banner" : "Adicionar banner"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={bannerUploading}
                onChange={handleBannerFile}
              />
            </label>
            <span className="text-[12px] font-semibold text-muted">JPG, PNG ou WebP · até 5 MB · ideal 1600×900</span>
          </div>
          {bannerError ? <p className="mt-2 text-[13px] font-semibold text-danger">{bannerError}</p> : null}
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <h3 className="text-[13px] font-extrabold">Sala de espera</h3>
          <p className="mt-1 text-[12px] font-semibold text-muted">
            Para eventos com pico de acesso na abertura das vendas: admite N compradores por vez no checkout em vez
            de deixar todo mundo bater junto no lote.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] font-bold">
              <input
                type="checkbox"
                checked={waitingRoomEnabled}
                disabled={waitingRoomSaving}
                onChange={(e) =>
                  saveWaitingRoom({
                    waitingRoomEnabled: e.target.checked,
                    waitingRoomConcurrency: Number(waitingRoomConcurrency) || 300,
                  })
                }
              />
              Ativar sala de espera
            </label>
            <label className="flex items-center gap-2 text-[13px] font-semibold text-muted">
              Compradores simultâneos:
              <input
                type="number"
                min={1}
                className="w-24 rounded-lg border border-line-input px-2 py-1 text-sm"
                value={waitingRoomConcurrency}
                disabled={waitingRoomSaving}
                onChange={(e) => setWaitingRoomConcurrency(e.target.value)}
                onBlur={() =>
                  saveWaitingRoom({
                    waitingRoomEnabled,
                    waitingRoomConcurrency: Number(waitingRoomConcurrency) || 300,
                  })
                }
              />
            </label>
          </div>
          {waitingRoomError ? <p className="mt-2 text-[13px] font-semibold text-danger">{waitingRoomError}</p> : null}
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <h3 className="text-[13px] font-extrabold">Pixels de conversão</h3>
          <p className="mt-1 text-[12px] font-semibold text-muted">
            Cole os IDs das plataformas que você usa pra rastrear campanha — disparamos PageView na página do evento
            e Purchase na confirmação do pedido.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <input
              placeholder="Meta Pixel ID"
              className="rounded-lg border border-line-input px-3 py-2 text-sm"
              value={metaPixelId}
              disabled={pixelSaving}
              onChange={(e) => setMetaPixelId(e.target.value)}
              onBlur={savePixels}
            />
            <input
              placeholder="GA4 Measurement ID"
              className="rounded-lg border border-line-input px-3 py-2 text-sm"
              value={ga4MeasurementId}
              disabled={pixelSaving}
              onChange={(e) => setGa4MeasurementId(e.target.value)}
              onBlur={savePixels}
            />
            <input
              placeholder="TikTok Pixel ID"
              className="rounded-lg border border-line-input px-3 py-2 text-sm"
              value={tiktokPixelId}
              disabled={pixelSaving}
              onChange={(e) => setTiktokPixelId(e.target.value)}
              onBlur={savePixels}
            />
          </div>
          {pixelError ? <p className="mt-2 text-[13px] font-semibold text-danger">{pixelError}</p> : null}
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <h3 className="text-[13px] font-extrabold">Categoria</h3>
          <p className="mt-1 text-[12px] font-semibold text-muted">
            Ajuda seu evento a aparecer nos filtros de busca do site.
          </p>
          <select
            className="mt-3 h-11 rounded-lg border border-line-input px-3 text-sm"
            value={category}
            disabled={categorySaving}
            onChange={(e) => saveCategory(e.target.value as EventCategory | "")}
          >
            <option value="">Sem categoria</option>
            {EVENT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          {categoryError ? <p className="mt-2 text-[13px] font-semibold text-danger">{categoryError}</p> : null}
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <h3 className="text-[13px] font-extrabold">Itens adicionais (upsell)</h3>
          <p className="mt-1 text-[12px] font-semibold text-muted">
            Itens opcionais que o comprador soma ao ingresso no checkout — ex.: camiseta do evento.
          </p>
          <div className="mt-3 space-y-2">
            {addOns.map((addOn) => (
              <div key={addOn.id} className="flex items-center justify-between gap-2 rounded-lg border border-line-input px-3 py-2">
                <div>
                  <p className="text-[13px] font-bold">{addOn.name}</p>
                  <p className="text-[12px] text-muted">{formatCents(addOn.priceCents)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleAddOnActive(addOn)}
                  className={`rounded-full px-3 py-1 text-[11px] font-bold ${addOn.active ? "bg-success/10 text-success" : "bg-line text-muted"}`}
                >
                  {addOn.active ? "Ativo" : "Inativo"}
                </button>
              </div>
            ))}
            {addOns.length === 0 ? <p className="text-[12px] font-semibold text-muted">Nenhum item cadastrado ainda.</p> : null}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_140px_auto]">
            <input
              placeholder="Nome (ex.: Camiseta do evento)"
              className="rounded-lg border border-line-input px-3 py-2 text-sm"
              value={addOnName}
              onChange={(e) => setAddOnName(e.target.value)}
            />
            <input
              placeholder="Preço (R$)"
              className="rounded-lg border border-line-input px-3 py-2 text-sm"
              value={addOnPrice}
              onChange={(e) => setAddOnPrice(e.target.value)}
            />
            <button
              type="button"
              onClick={createAddOn}
              disabled={addOnSaving || !addOnName.trim() || !addOnPrice}
              className="rounded-lg bg-primary px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50"
            >
              {addOnSaving ? "Criando…" : "Adicionar"}
            </button>
          </div>
          {addOnError ? <p className="mt-2 text-[13px] font-semibold text-danger">{addOnError}</p> : null}
        </div>
      </section>

      {/* --- Cupons --------------------------------------------------------- */}
      <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-lg font-semibold">Cupons</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <input placeholder="CÓDIGO" className="w-36 rounded-lg border border-line-input px-3 py-2 text-sm uppercase" value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} />
          <select className="rounded-lg border border-line-input px-3 py-2 text-sm" value={couponType} onChange={(e) => setCouponType(e.target.value)}>
            <option value="PERCENT">% de desconto</option>
            <option value="FIXED">R$ fixo</option>
          </select>
          <input placeholder={couponType === "PERCENT" ? "% (1-100)" : "Valor R$"} className="w-28 rounded-lg border border-line-input px-3 py-2 text-sm" value={couponValue} onChange={(e) => setCouponValue(e.target.value)} />
          <input placeholder="Limite de usos" className="w-32 rounded-lg border border-line-input px-3 py-2 text-sm" value={couponMax} onChange={(e) => setCouponMax(e.target.value)} />
          <button type="button" onClick={createCoupon} disabled={!couponCode || !couponValue} className="btn-primary px-4 py-2">
            Criar cupom
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {coupons.length === 0 && <p className="text-sm text-muted">Nenhum cupom ainda.</p>}
          {coupons.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-bg px-4 py-2.5 text-sm">
              <span className="font-bold">{c.code}</span>
              <span>{c.discountType === "PERCENT" ? `−${c.discountValue}%` : `−${formatCents(c.discountValue)}`}</span>
              <span className="text-muted">{c.redeemedCount}{c.maxRedemptions ? `/${c.maxRedemptions}` : ""} usados</span>
              {c.active ? (
                <button type="button" onClick={async () => { if (token) { await couponsApi.deactivate(c.id, token); setCoupons(await couponsApi.list(eventId, token)); } }} className="font-semibold text-danger">
                  Desativar
                </button>
              ) : (
                <span className="text-muted">inativo</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* --- Cortesias ------------------------------------------------------ */}
      <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-lg font-semibold">Cortesias</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <select className="rounded-lg border border-line-input px-3 py-2 text-sm" value={courtesyLot} onChange={(e) => setCourtesyLot(e.target.value)}>
            <option value="">Lote</option>
            {dashboard.lots.map((lot) => (
              <option key={lot.id} value={lot.id}>{lot.typeName} — {lot.name}</option>
            ))}
          </select>
          <input placeholder="Qtd" className="w-16 rounded-lg border border-line-input px-3 py-2 text-sm" value={courtesyQty} onChange={(e) => setCourtesyQty(e.target.value)} />
          <input placeholder="Nome do convidado" className="w-44 rounded-lg border border-line-input px-3 py-2 text-sm" value={courtesyName} onChange={(e) => setCourtesyName(e.target.value)} />
          <input placeholder="E-mail" className="w-52 rounded-lg border border-line-input px-3 py-2 text-sm" value={courtesyEmail} onChange={(e) => setCourtesyEmail(e.target.value)} />
          <button type="button" onClick={issueCourtesy} disabled={!courtesyLot || courtesyName.length < 2 || !courtesyEmail.includes("@")} className="rounded-lg bg-success px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-line disabled:text-muted">
            Emitir cortesia
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {courtesies.length === 0 && <p className="text-sm text-muted">Nenhuma cortesia emitida.</p>}
          {courtesies.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-bg px-4 py-2.5 text-sm">
              <span className="font-semibold">{c.contactName ?? c.contactEmail}</span>
              <span className="text-muted">{c.items.map((i) => `${i.quantity}× ${i.ticketLot.name}`).join(", ")}</span>
              <span className={c.status === "FULFILLED" ? "font-semibold text-success" : "text-muted"}>{c.status}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export default function EventPage({ params }: { params: { eventId: string } }) {
  return (
    <AuthGuard>
      <EventContent eventId={params.eventId} />
    </AuthGuard>
  );
}
