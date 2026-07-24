"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { catalogApi, eventsApi, dashboardApi, eventControls, couponsApi, complimentaryApi, type Dashboard } from "@/lib/api";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

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

  const [showTypeForm, setShowTypeForm] = useState(false);
  const [typeName, setTypeName] = useState("");

  const [showLotForm, setShowLotForm] = useState(false);
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
  const [copied, setCopied] = useState(false);
  const [lotTypeId, setLotTypeId] = useState("");
  const [lotName, setLotName] = useState("");
  const [lotPrice, setLotPrice] = useState("");
  const [lotFee, setLotFee] = useState("");
  const [lotCapacity, setLotCapacity] = useState("");

  // Tipos conhecidos = os criados nesta sessão + os que já têm lote (o
  // dashboard não expõe tipos sem lote de sessões anteriores — limitação
  // conhecida, ver docs/projeto/MEMORIA.md).
  const knownTypes = useMemo(() => {
    const fromLots = (dashboard?.lots ?? []).map((lot) => ({ id: lot.ticketTypeId, name: lot.typeName }));
    const byId = new Map<string, LocalTicketType>();
    for (const type of [...fromLots, ...sessionTypes]) byId.set(type.id, type);
    return Array.from(byId.values());
  }, [dashboard, sessionTypes]);

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const d = await dashboardApi.get(token, eventId);
      setDashboard(d);
      setBannerUrl((d.event as { bannerUrl?: string | null }).bannerUrl ?? "");
      couponsApi.list(eventId, token).then(setCoupons).catch(() => {});
      complimentaryApi.list(eventId, token).then(setCourtesies).catch(() => {});
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

  async function saveBanner() {
    if (!token) return;
    setError(null);
    try {
      await eventControls.update(eventId, { bannerUrl: bannerUrl || null }, token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar banner");
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

  async function handleCreateType() {
    if (!token) return;
    setError(null);
    try {
      const type = await catalogApi.createTicketType(token, eventId, { name: typeName });
      setSessionTypes((prev) => [...prev, { id: type.id, name: type.name }]);
      setTypeName("");
      setShowTypeForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o tipo");
    }
  }

  async function handleCreateLot() {
    if (!token || !lotTypeId) return;
    setError(null);
    try {
      const lot = await catalogApi.createLot(token, lotTypeId, {
        name: lotName,
        priceCents: Math.round(Number(lotPrice) * 100),
        feeCents: Math.round(Number(lotFee || "0") * 100),
        capacity: Number(lotCapacity),
      });
      await catalogApi.activateLot(token, lot.id);
      setShowLotForm(false);
      setLotName("");
      setLotPrice("");
      setLotFee("");
      setLotCapacity("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o lote");
    }
  }

  if (loading || !dashboard) {
    return (
      <main>
        <Nav />
        <p className="mt-6 text-gray-400">Carregando...</p>
      </main>
    );
  }

  return (
    <main>
      <Nav />
      <div className="mt-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{dashboard.event.title}</h1>
        <span className="rounded-full bg-gray-800 px-3 py-1 text-xs">{dashboard.event.status}</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        {dashboard.event.status === "DRAFT" ? (
          <button
            type="button"
            className="rounded-lg bg-brand px-4 py-2 font-semibold text-brand-dark"
            onClick={handlePublish}
          >
            Publicar evento
          </button>
        ) : null}
        <Link href={`/eventos/${eventId}/dashboard`} className="rounded-lg bg-gray-800 px-4 py-2">
          Dashboard de vendas
        </Link>
        <Link href={`/eventos/${eventId}/vendas`} className="rounded-lg bg-gray-800 px-4 py-2">
          Vendas
        </Link>
        <Link href={`/eventos/${eventId}/participantes`} className="rounded-lg bg-gray-800 px-4 py-2">
          Participantes
        </Link>
        <Link href={`/eventos/${eventId}/portaria`} className="rounded-lg bg-gray-800 px-4 py-2">
          Portaria/validadores
        </Link>
        <Link href={`/eventos/${eventId}/checkin-ao-vivo`} className="rounded-lg bg-gray-800 px-4 py-2">
          Check-in ao vivo
        </Link>
        <Link href={`/eventos/${eventId}/divulgue`} className="rounded-lg bg-gray-800 px-4 py-2">
          Divulgue
        </Link>
      </div>

      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Ingressos</h2>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm"
            onClick={() => setShowTypeForm((v) => !v)}
          >
            + Tipo de ingresso
          </button>
          <button
            type="button"
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm"
            onClick={() => setShowLotForm((v) => !v)}
            disabled={knownTypes.length === 0}
          >
            + Lote
          </button>
        </div>
      </div>

      {showTypeForm ? (
        <div className="mt-3 flex gap-2">
          <input
            placeholder="Nome (ex.: Pista, VIP)"
            className="flex-1"
            value={typeName}
            onChange={(e) => setTypeName(e.target.value)}
          />
          <button
            type="button"
            className="rounded-lg bg-brand px-4 text-sm font-semibold text-brand-dark"
            onClick={handleCreateType}
          >
            Criar
          </button>
        </div>
      ) : null}

      {showLotForm ? (
        <div className="mt-3 space-y-2 rounded-lg bg-gray-800/60 p-4">
          <select className="w-full" value={lotTypeId} onChange={(e) => setLotTypeId(e.target.value)}>
            <option value="">Selecione o tipo de ingresso</option>
            {knownTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
          <input placeholder="Nome do lote" className="w-full" value={lotName} onChange={(e) => setLotName(e.target.value)} />
          <div className="flex gap-2">
            <input
              placeholder="Preço (R$)"
              className="w-full"
              value={lotPrice}
              onChange={(e) => setLotPrice(e.target.value)}
            />
            <input placeholder="Taxa (R$)" className="w-full" value={lotFee} onChange={(e) => setLotFee(e.target.value)} />
            <input
              placeholder="Capacidade"
              className="w-full"
              value={lotCapacity}
              onChange={(e) => setLotCapacity(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-dark"
            onClick={handleCreateLot}
            disabled={!lotTypeId || !lotName || !lotPrice || !lotCapacity}
          >
            Criar e ativar lote
          </button>
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        {dashboard.lots.length === 0 ? <p className="text-gray-500">Nenhum lote criado ainda.</p> : null}
        {dashboard.lots.map((lot) => (
          <div key={lot.id} className="rounded-lg bg-gray-800/60 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {lot.typeName} — {lot.name}
                </p>
                <p className="text-sm text-gray-400">
                  {formatCents(lot.priceCents)} + taxa {formatCents(lot.feeCents)} · {lot.sold}/{lot.capacity} vendidos
                </p>
              </div>
              <span className="text-xs text-gray-400">{lot.status}</span>
            </div>
          </div>
        ))}
      </div>
      {/* --- Publicação (protótipo: URL + toggle + banner) ------------------ */}
      <section className="mt-10 rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-lg font-semibold">Publicação</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <code className="rounded-lg bg-bg px-3 py-2 text-sm">
            {`http://localhost:3000/evento/${(dashboard.event as { slug?: string }).slug ?? ""}`}
          </code>
          <button
            type="button"
            className="rounded-lg border border-line-input px-3 py-2 text-sm font-semibold"
            onClick={() => {
              navigator.clipboard.writeText(`http://localhost:3000/evento/${(dashboard.event as { slug?: string }).slug ?? ""}`);
              setCopied(true); setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copiado!" : "Copiar link"}
          </button>
          {["PUBLISHED", "SALES_PAUSED"].includes(dashboard.event.status) && (
            <button
              type="button"
              onClick={togglePublication}
              className={`rounded-lg px-3 py-2 text-sm font-semibold text-white ${dashboard.event.status === "PUBLISHED" ? "bg-warning" : "bg-success"}`}
            >
              {dashboard.event.status === "PUBLISHED" ? "Pausar vendas" : "Reabrir vendas"}
            </button>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          <input
            placeholder="URL do banner do evento (imagem)"
            className="flex-1 rounded-lg border border-line-input px-3 py-2 text-sm"
            value={bannerUrl}
            onChange={(e) => setBannerUrl(e.target.value)}
          />
          <button type="button" onClick={saveBanner} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white">
            Salvar banner
          </button>
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
          <button type="button" onClick={createCoupon} disabled={!couponCode || !couponValue} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            Criar cupom
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {coupons.length === 0 && <p className="text-sm text-muted">Nenhum cupom ainda.</p>}
          {coupons.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg bg-bg px-4 py-2.5 text-sm">
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
          <button type="button" onClick={issueCourtesy} disabled={!courtesyLot || courtesyName.length < 2 || !courtesyEmail.includes("@")} className="rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            Emitir cortesia
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {courtesies.length === 0 && <p className="text-sm text-muted">Nenhuma cortesia emitida.</p>}
          {courtesies.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg bg-bg px-4 py-2.5 text-sm">
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
