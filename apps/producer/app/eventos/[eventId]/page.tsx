"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { catalogApi, eventsApi, dashboardApi, type Dashboard } from "@/lib/api";

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
      setDashboard(await dashboardApi.get(token, eventId));
    } finally {
      setLoading(false);
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
        <Link href={`/eventos/${eventId}/participantes`} className="rounded-lg bg-gray-800 px-4 py-2">
          Participantes
        </Link>
        <Link href={`/eventos/${eventId}/portaria`} className="rounded-lg bg-gray-800 px-4 py-2">
          Portaria/validadores
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
