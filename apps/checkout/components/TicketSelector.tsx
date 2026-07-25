"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type PublicEvent } from "../lib/api";
import { formatCents } from "../lib/format";

interface Selection {
  qty: number;
  half: boolean;
}

/** Seleção de lotes com stepper/meia/esgotado — usada no mobile e no hotsite desktop. */
export function TicketSelector({ event, compact = false }: { event: PublicEvent; compact?: boolean }) {
  const router = useRouter();
  const [selection, setSelection] = useState<Record<string, Selection>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lots = useMemo(
    () =>
      event.ticketTypes.flatMap((type) =>
        type.lots.map((lot) => {
          const available = lot.capacity - lot.soldCount - lot.reservedCount;
          return {
            ...lot,
            typeName: type.name,
            available,
            soldOut: lot.status !== "ACTIVE" || available <= 0,
            few: lot.status === "ACTIVE" && available > 0 && available <= Math.max(3, lot.capacity * 0.1),
            // feeMode PRODUCER: o produtor absorve a taxa — o comprador paga só o preço
            buyerPaysFee: lot.feeMode !== "PRODUCER",
          };
        }),
      ),
    [event],
  );

  const totalCents = lots.reduce((sum, lot) => {
    const sel = selection[lot.id];
    if (!sel?.qty) return sum;
    const unit = sel.half ? Math.round(lot.priceCents / 2) : lot.priceCents;
    return sum + sel.qty * (unit + (lot.buyerPaysFee ? lot.feeCents : 0));
  }, 0);
  const count = Object.values(selection).reduce((s, x) => s + x.qty, 0);
  const selectedLots = lots.filter((lot) => selection[lot.id]?.qty);
  const anyBuyerFee = selectedLots.some((lot) => lot.buyerPaysFee);

  function bump(lotId: string, delta: number, max: number) {
    setSelection((prev) => {
      const cur = prev[lotId] ?? { qty: 0, half: false };
      return { ...prev, [lotId]: { ...cur, qty: Math.max(0, Math.min(max, cur.qty + delta)) } };
    });
  }

  async function submit() {
    if (count === 0) return;
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
      // vincula a compra à conta quando a pessoa já entrou (sessão do site/app)
      const token = localStorage.getItem("bf.token") ?? undefined;
      const reservation = await api.createReservation(event.id, items, token);
      sessionStorage.setItem(`bf.slug.${reservation.id}`, event.slug);
      router.push(`/checkout/${reservation.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível reservar. Tente de novo.");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className={compact ? "space-y-2.5" : "space-y-3"}>
        {lots.map((lot) => {
          const sel = selection[lot.id] ?? { qty: 0, half: false };
          const unitPrice = sel.half ? Math.round(lot.priceCents / 2) : lot.priceCents;
          return (
            <div
              key={lot.id}
              className={`rounded-2xl border-[1.5px] bg-surface ${compact ? "p-3.5" : "p-4"} ${
                lot.soldOut ? "border-line bg-[#faf9fc] opacity-75" : sel.qty ? "border-primary" : "border-line"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={`font-extrabold ${compact ? "text-[14px]" : "text-[16px]"}`}>
                    {lot.typeName} — {lot.name}
                  </p>
                  {lot.soldOut ? (
                    <span className="mt-1 inline-block rounded-full bg-line px-2.5 py-0.5 text-[10px] font-bold text-muted">Esgotado</span>
                  ) : lot.few ? (
                    <span className="mt-1 inline-block rounded-full bg-accent/10 px-2.5 py-0.5 text-[10px] font-bold text-accent">Poucos</span>
                  ) : null}
                  {lot.nominal && !lot.soldOut && (
                    <span className="mt-1 ml-1 inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-bold text-primary">
                      Nominal
                    </span>
                  )}
                  <p className={`mt-1.5 font-extrabold ${compact ? "text-[17px]" : "text-[20px]"}`}>{formatCents(unitPrice)}</p>
                  {lot.buyerPaysFee ? (
                    <p className="text-[11px] font-semibold text-muted">+ {formatCents(lot.feeCents)} taxa de serviço</p>
                  ) : (
                    <p className="text-[11px] font-semibold text-success">taxa por conta do produtor</p>
                  )}
                </div>
                {lot.soldOut ? (
                  <span className="rounded-xl bg-line px-3 py-2 text-[11px] font-bold text-muted-3">Indisponível</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={() => bump(lot.id, -1, lot.available)} disabled={!sel.qty} aria-label="Remover"
                      className="flex h-9 w-9 items-center justify-center rounded-xl border-[1.5px] border-line-input text-lg font-bold disabled:opacity-40">−</button>
                    <span className="w-5 text-center text-[15px] font-extrabold">{sel.qty}</span>
                    <button onClick={() => bump(lot.id, 1, Math.min(lot.available, 6))} aria-label="Adicionar"
                      className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-lg font-bold text-white shadow-cta">+</button>
                  </div>
                )}
              </div>
              {!lot.soldOut && (
                <label className="mt-2.5 flex items-center gap-2 border-t border-line-divider pt-2.5 text-[12px] font-semibold text-ink-soft">
                  <input type="checkbox" checked={sel.half}
                    onChange={(e) => setSelection((prev) => ({ ...prev, [lot.id]: { ...sel, half: e.target.checked } }))}
                    className="h-4 w-4 accent-primary" />
                  Meia-entrada (documento na portaria)
                </label>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="mt-2 text-[12px] font-semibold text-danger">{error}</p>}

      <div className="mt-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-muted">
            {count} ingresso{count === 1 ? "" : "s"}
            {count > 0 ? (anyBuyerFee ? " · inclui taxas" : " · taxa por conta do produtor") : ""}
          </p>
          <p className="text-[20px] font-extrabold">{formatCents(totalCents)}</p>
        </div>
        <button onClick={submit} disabled={count === 0 || submitting}
          className={`h-12 rounded-2xl px-6 text-[14px] font-extrabold text-white ${count === 0 || submitting ? "bg-[#d9d2e8]" : "bg-primary shadow-cta"}`}>
          {submitting ? "Reservando…" : "Continuar para pagamento"}
        </button>
      </div>
    </div>
  );
}
