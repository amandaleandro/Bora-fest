"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type PublicEvent } from "../../../../lib/api";
import { formatCents } from "../../../../lib/format";
import { Icon, paths } from "../../../../components/icons";

interface Selection {
  qty: number;
  half: boolean;
}

export default function SelectTicketsPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const router = useRouter();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [selection, setSelection] = useState<Record<string, Selection>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getPublicEvent(slug).then(setEvent).catch(() => setError("Evento não encontrado"));
  }, [slug]);

  const lots = useMemo(
    () =>
      (event?.ticketTypes ?? []).flatMap((type) =>
        type.lots.map((lot) => ({
          ...lot,
          typeName: type.name,
          soldOut:
            lot.status !== "ACTIVE" || lot.capacity - lot.soldCount - lot.reservedCount <= 0,
          few:
            lot.status === "ACTIVE" &&
            lot.capacity - lot.soldCount - lot.reservedCount > 0 &&
            lot.capacity - lot.soldCount - lot.reservedCount <= Math.max(3, lot.capacity * 0.1),
        })),
      ),
    [event],
  );

  const totalCents = lots.reduce((sum, lot) => {
    const sel = selection[lot.id];
    if (!sel?.qty) return sum;
    const unit = (sel.half ? Math.round(lot.priceCents / 2) : lot.priceCents) + lot.feeCents;
    return sum + sel.qty * unit;
  }, 0);
  const count = Object.values(selection).reduce((s, x) => s + x.qty, 0);

  function bump(lotId: string, delta: number, max: number) {
    setSelection((prev) => {
      const cur = prev[lotId] ?? { qty: 0, half: false };
      const qty = Math.max(0, Math.min(max, cur.qty + delta));
      return { ...prev, [lotId]: { ...cur, qty } };
    });
  }

  async function submit() {
    if (!event || count === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const items = lots
        .filter((lot) => selection[lot.id]?.qty)
        .map((lot) => ({
          ticketLotId: lot.id,
          quantity: selection[lot.id].qty,
          halfPrice: selection[lot.id].half || undefined,
        }));
      const reservation = await api.createReservation(event.id, items);
      sessionStorage.setItem(`bf.slug.${reservation.id}`, event.slug);
      router.push(`/checkout/${reservation.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível reservar. Tente de novo.");
      setSubmitting(false);
    }
  }

  if (!event) {
    return <main className="flex min-h-dvh items-center justify-center text-[13px] text-muted">{error ?? "Carregando…"}</main>;
  }

  return (
    <main className="pb-36">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-bg/85 px-5 py-4 backdrop-blur">
        <button onClick={() => router.back()} aria-label="Voltar" className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface">
          <Icon d={paths.back} />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-[16px] font-extrabold">Escolha seus ingressos</h1>
          <p className="truncate text-[12px] font-medium text-muted">{event.title}</p>
        </div>
      </header>

      <div className="space-y-3 px-5 pt-4">
        {lots.map((lot) => {
          const sel = selection[lot.id] ?? { qty: 0, half: false };
          const unitPrice = sel.half ? Math.round(lot.priceCents / 2) : lot.priceCents;
          const available = lot.capacity - lot.soldCount - lot.reservedCount;
          return (
            <div
              key={lot.id}
              className={`rounded-2xl border-[1.5px] bg-surface p-4 ${
                lot.soldOut ? "border-line bg-[#faf9fc] opacity-75" : sel.qty ? "border-primary" : "border-line"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[16px] font-extrabold">
                    {lot.typeName} — {lot.name}
                  </p>
                  {lot.soldOut ? (
                    <span className="mt-1 inline-block rounded-full bg-line px-2.5 py-0.5 text-[10px] font-bold text-muted">Esgotado</span>
                  ) : lot.few ? (
                    <span className="mt-1 inline-block rounded-full bg-accent/10 px-2.5 py-0.5 text-[10px] font-bold text-accent">Poucos</span>
                  ) : null}
                  <p className="mt-2 text-[20px] font-extrabold">{formatCents(unitPrice)}</p>
                  <p className="text-[11px] font-semibold text-muted">+ {formatCents(lot.feeCents)} taxa de serviço</p>
                </div>

                {lot.soldOut ? (
                  <span className="rounded-xl bg-line px-4 py-2 text-[12px] font-bold text-muted-3">Indisponível</span>
                ) : (
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => bump(lot.id, -1, available)}
                      aria-label="Remover"
                      className="flex h-[38px] w-[38px] items-center justify-center rounded-xl border-[1.5px] border-line-input text-lg font-bold text-ink disabled:opacity-40"
                      disabled={!sel.qty}
                    >
                      −
                    </button>
                    <span className="w-5 text-center text-[16px] font-extrabold">{sel.qty}</span>
                    <button
                      onClick={() => bump(lot.id, 1, Math.min(available, 6))}
                      aria-label="Adicionar"
                      className="flex h-[38px] w-[38px] items-center justify-center rounded-xl bg-primary text-lg font-bold text-white shadow-cta"
                    >
                      +
                    </button>
                  </div>
                )}
              </div>

              {!lot.soldOut && (
                <label className="mt-3 flex items-center gap-2 border-t border-line-divider pt-3 text-[12px] font-semibold text-ink-soft">
                  <input
                    type="checkbox"
                    checked={sel.half}
                    onChange={(e) =>
                      setSelection((prev) => ({ ...prev, [lot.id]: { ...sel, half: e.target.checked } }))
                    }
                    className="h-4 w-4 accent-primary"
                  />
                  Meia-entrada (estudante / documento na portaria)
                </label>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="mt-3 px-5 text-[12px] font-semibold text-danger">{error}</p>}

      {/* resumo sticky */}
      <div className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-[430px] border-t border-line bg-surface/90 p-4 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[12px] font-semibold text-muted">
              {count} ingresso{count === 1 ? "" : "s"} · inclui taxas
            </p>
            <p className="text-[22px] font-extrabold">{formatCents(totalCents)}</p>
          </div>
          <button
            onClick={submit}
            disabled={count === 0 || submitting}
            className={`h-14 rounded-2xl px-8 text-[15px] font-extrabold text-white ${
              count === 0 || submitting ? "bg-[#d9d2e8]" : "bg-primary shadow-cta"
            }`}
          >
            {submitting ? "Reservando…" : "Continuar"}
          </button>
        </div>
      </div>
    </main>
  );
}
