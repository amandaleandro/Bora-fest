"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE_URL } from "../../../../../lib/config";

type ReservationStatus = "REQUESTED" | "CONFIRMED" | "REJECTED" | "CANCELED";

type Reservation = {
  publicToken: string;
  status: ReservationStatus;
  units: number;
  partySize: number;
  unitPriceCents: number;
  totalCents: number;
  resolutionNote: string | null;
  respondedAt: string | null;
  createdAt: string;
  inventory: {
    name: string;
    kind: string;
    event: { title: string; slug: string; startsAt: string };
  };
};

const STATUS: Record<ReservationStatus, { title: string; description: string }> = {
  REQUESTED: { title: "Aguardando confirmação", description: "A Casa recebeu seu pedido e ainda precisa confirmar a disponibilidade." },
  CONFIRMED: { title: "Reserva confirmada", description: "Sua unidade VIP está confirmada para este evento." },
  REJECTED: { title: "Reserva não confirmada", description: "A Casa não conseguiu confirmar este pedido." },
  CANCELED: { title: "Reserva cancelada", description: "Esta reserva foi cancelada e não ocupa mais o inventário VIP." },
};

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function VipReservationStatusPage({ params }: { params: { slug: string; publicToken: string } }) {
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE_URL}/v1/public/vip/reservations/${encodeURIComponent(params.publicToken)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? "Reserva não encontrada" : "Não foi possível consultar a reserva");
        return response.json() as Promise<Reservation>;
      })
      .then((payload) => {
        if (active) setReservation(payload);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Não foi possível consultar a reserva");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [params.publicToken]);

  if (loading) return <main className="mx-auto max-w-3xl px-5 py-16 text-center text-sm text-white/60">Consultando reserva…</main>;

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-12 text-white">
      <Link href={`/${params.slug}`} className="text-sm font-bold text-white/60 hover:text-white">← Voltar para o evento</Link>
      {error ? <div className="mt-8 rounded-3xl border border-red-400/25 bg-red-400/10 p-6 text-sm font-bold text-red-200">{error}</div> : null}
      {reservation ? (
        <section className="mt-8 rounded-3xl border border-white/10 bg-white/[.055] p-6 lg:p-8">
          <p className="text-xs font-black uppercase tracking-[.12em] text-primary">Reserva VIP</p>
          <h1 className="mt-2 text-3xl font-black">{STATUS[reservation.status].title}</h1>
          <p className="mt-3 text-sm font-semibold leading-relaxed text-white/60">{STATUS[reservation.status].description}</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-black/15 p-4"><p className="text-[10px] font-black uppercase text-white/40">Evento</p><p className="mt-1 font-black">{reservation.inventory.event.title}</p></div>
            <div className="rounded-2xl bg-black/15 p-4"><p className="text-[10px] font-black uppercase text-white/40">Espaço</p><p className="mt-1 font-black">{reservation.inventory.name}</p></div>
            <div className="rounded-2xl bg-black/15 p-4"><p className="text-[10px] font-black uppercase text-white/40">Reserva</p><p className="mt-1 font-black">{reservation.units} unidade(s) · {reservation.partySize} pessoas</p></div>
            <div className="rounded-2xl bg-black/15 p-4"><p className="text-[10px] font-black uppercase text-white/40">Valor de referência</p><p className="mt-1 font-black">{money(reservation.totalCents)}</p></div>
          </div>
          {reservation.resolutionNote ? <div className="mt-5 rounded-2xl border border-white/10 p-4 text-sm font-semibold text-white/70">{reservation.resolutionNote}</div> : null}
          <p className="mt-6 break-all text-[11px] font-semibold text-white/35">Código: {reservation.publicToken}</p>
        </section>
      ) : null}
    </main>
  );
}
