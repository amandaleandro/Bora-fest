"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type AvailabilityItem, type PublicEvent } from "@/lib/api";
import { formatCents } from "@/lib/format";

export function EventPurchaseForm({
  event,
  availabilityByLot,
}: {
  event: PublicEvent;
  availabilityByLot: Record<string, AvailabilityItem>;
}) {
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalCents = useMemo(() => {
    return event.ticketTypes.reduce((sum, type) => {
      return (
        sum +
        type.lots.reduce((lotSum, lot) => {
          const qty = quantities[lot.id] ?? 0;
          return lotSum + qty * (lot.priceCents + lot.feeCents);
        }, 0)
      );
    }, 0);
  }, [quantities, event]);

  const totalQuantity = Object.values(quantities).reduce((sum, qty) => sum + qty, 0);

  function setQuantity(lotId: string, quantity: number, max: number) {
    setQuantities((prev) => ({ ...prev, [lotId]: Math.max(0, Math.min(quantity, max)) }));
  }

  async function handleReserve() {
    setError(null);
    const items = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([ticketLotId, quantity]) => ({ ticketLotId, quantity }));

    if (items.length === 0) {
      setError("Selecione ao menos um ingresso");
      return;
    }

    setSubmitting(true);
    try {
      const reservation = await api.createReservation(event.id, items);
      router.push(`/checkout/${reservation.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível reservar — tente novamente");
    } finally {
      setSubmitting(false);
    }
  }

  if (event.status !== "PUBLISHED") {
    return <p className="mt-8 text-amber-400">Este evento não está com vendas abertas no momento.</p>;
  }

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Ingressos</h2>

      <div className="mt-4 space-y-4">
        {event.ticketTypes.map((type) => (
          <div key={type.id}>
            <h3 className="text-sm font-medium text-gray-300">{type.name}</h3>
            <div className="mt-2 space-y-2">
              {type.lots.map((lot) => {
                const available = availabilityByLot[lot.id]?.available ?? 0;
                const quantity = quantities[lot.id] ?? 0;
                const soldOut = available === 0;

                return (
                  <div
                    key={lot.id}
                    className="flex items-center justify-between rounded-lg bg-gray-800/60 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium">{lot.name}</p>
                      <p className="text-sm text-gray-400">
                        {formatCents(lot.priceCents + lot.feeCents)}{" "}
                        <span className="text-xs">
                          (ingresso {formatCents(lot.priceCents)} + taxa {formatCents(lot.feeCents)})
                        </span>
                      </p>
                      {soldOut ? <p className="text-xs text-red-400">esgotado</p> : null}
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="h-8 w-8 rounded-full bg-gray-700 disabled:opacity-30"
                        onClick={() => setQuantity(lot.id, quantity - 1, available)}
                        disabled={quantity === 0}
                      >
                        −
                      </button>
                      <span className="w-6 text-center">{quantity}</span>
                      <button
                        type="button"
                        className="h-8 w-8 rounded-full bg-gray-700 disabled:opacity-30"
                        onClick={() => setQuantity(lot.id, quantity + 1, available)}
                        disabled={soldOut || quantity >= available}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

      <div className="mt-8 flex items-center justify-between border-t border-gray-700 pt-4">
        <span className="text-lg font-semibold">{formatCents(totalCents)}</span>
        <button
          type="button"
          className="rounded-lg bg-brand px-6 py-3 font-semibold text-brand-dark disabled:opacity-40"
          onClick={handleReserve}
          disabled={submitting || totalQuantity === 0}
        >
          {submitting ? "Reservando..." : "Continuar"}
        </button>
      </div>
    </section>
  );
}
