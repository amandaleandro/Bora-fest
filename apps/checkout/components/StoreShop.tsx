"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { HouseStoreResponse } from "../lib/houses-api";
import { storeApi } from "../lib/store-api";

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function StoreShop({ store }: { store: HouseStoreResponse }) {
  const router = useRouter();
  const [liveStore, setLiveStore] = useState(store);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [fulfillmentMethod, setFulfillmentMethod] = useState<"PICKUP" | "DELIVERY">(
    liveStore.fulfillment.pickupEnabled ? "PICKUP" : "DELIVERY",
  );
  const [address, setAddress] = useState({
    postalCode: "",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const variants = useMemo(
    () =>
      liveStore.products.flatMap((product) =>
        product.variants.map((variant) => ({ product, variant })),
      ),
    [liveStore],
  );

  useEffect(() => {
    storeApi.store(store.organization.slug).then(setLiveStore).catch(() => undefined);
  }, [store.organization.slug]);

  const selected = variants
    .map(({ product, variant }) => ({
      product,
      variant,
      quantity: cart[variant.id] ?? 0,
    }))
    .filter((item) => item.quantity > 0);

  const subtotalCents = selected.reduce(
    (sum, item) => sum + item.variant.priceCents * item.quantity,
    0,
  );
  const shippingCents =
    fulfillmentMethod === "DELIVERY" ? liveStore.fulfillment.flatShippingCents : 0;
  const totalCents = subtotalCents + shippingCents;
  const totalQty = selected.reduce((sum, item) => sum + item.quantity, 0);

  function setQty(variantId: string, next: number, available: number) {
    const qty = Math.max(0, Math.min(next, available, 20));
    setCart((current) => ({ ...current, [variantId]: qty }));
  }

  async function createOrder() {
    if (selected.length === 0 || busy) return;
    if (name.trim().length < 2) {
      setError("Informe seu nome para a retirada.");
      return;
    }
    if (!email.includes("@")) {
      setError("Informe um e-mail válido.");
      return;
    }
    if (fulfillmentMethod === "DELIVERY") {
      if (
        !address.postalCode.trim() ||
        !address.street.trim() ||
        !address.number.trim() ||
        !address.neighborhood.trim() ||
        !address.city.trim() ||
        address.state.trim().length !== 2
      ) {
        setError("Preencha o endereço de entrega.");
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      const order = await storeApi.createOrder(liveStore.organization.slug, {
        items: selected.map((item) => ({
          variantId: item.variant.id,
          quantity: item.quantity,
        })),
        contactName: name.trim(),
        contactEmail: email.trim().toLowerCase(),
        contactPhone: phone.trim() || undefined,
        fulfillmentMethod,
        shippingAddress:
          fulfillmentMethod === "DELIVERY"
            ? {
                postalCode: address.postalCode.trim(),
                street: address.street.trim(),
                number: address.number.trim(),
                complement: address.complement.trim() || undefined,
                neighborhood: address.neighborhood.trim(),
                city: address.city.trim(),
                state: address.state.trim().toUpperCase(),
              }
            : undefined,
      });
      router.push(`/loja/pedido/${order.publicToken}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o pedido.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section>
        <div className="mt-8 border-t border-line pt-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[12px] font-extrabold uppercase tracking-[.08em] text-primary">Loja da Casa</p>
              <h2 className="mt-1 text-[20px] font-black text-ink">Produtos oficiais</h2>
              <p className="mt-1 text-[12.5px] font-semibold text-muted">
                Compre pela BoraFest com retirada ou entrega, conforme as opções da Casa.
              </p>
            </div>
            <span className="rounded-full border border-success/20 bg-success/10 px-3 py-1.5 text-[10.5px] font-extrabold text-success">
              Compra pela BoraFest
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {liveStore.products.map((product) => (
              <article key={product.id} className="overflow-hidden rounded-3xl border border-line bg-surface">
                {product.imageUrl ? (
                  <div className="aspect-[4/3] overflow-hidden bg-bg">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center bg-bg text-[36px]">🛍️</div>
                )}

                <div className="p-4">
                  <h3 className="text-[14px] font-black text-ink">{product.name}</h3>
                  {product.description ? (
                    <p className="mt-1 line-clamp-2 text-[11.5px] font-semibold leading-relaxed text-muted">
                      {product.description}
                    </p>
                  ) : null}

                  <div className="mt-3 space-y-2">
                    {product.variants.map((variant) => {
                      const qty = cart[variant.id] ?? 0;
                      return (
                        <div key={variant.id} className="rounded-xl bg-bg px-3 py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-[11.5px] font-extrabold text-ink">{variant.name}</p>
                              <p className={`text-[10px] font-semibold ${variant.available > 0 ? "text-muted" : "text-danger"}`}>
                                {variant.available > 0
                                  ? `${variant.available} disponível${variant.available === 1 ? "" : "is"}`
                                  : "Sem estoque"}
                              </p>
                            </div>
                            <p className="shrink-0 text-[12px] font-black text-ink">{money(variant.priceCents)}</p>
                          </div>

                          {variant.available > 0 ? (
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => setQty(variant.id, qty - 1, variant.available)}
                                disabled={qty === 0}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-[16px] font-black text-ink disabled:opacity-30"
                              >
                                −
                              </button>
                              <span className="min-w-8 text-center text-[12px] font-black text-ink">{qty}</span>
                              <button
                                type="button"
                                onClick={() => setQty(variant.id, qty + 1, variant.available)}
                                disabled={qty >= variant.available || qty >= 20}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-[16px] font-black text-ink disabled:opacity-30"
                              >
                                +
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </article>
            ))}
          </div>

          {totalQty > 0 ? (
            <div className="sticky bottom-4 z-10 mt-5 flex items-center justify-between gap-4 rounded-2xl border border-primary/20 bg-surface p-4 shadow-card">
              <div>
                <p className="text-[11px] font-bold text-muted">
                  {totalQty} item{totalQty === 1 ? "" : "s"}
                </p>
                <p className="text-[17px] font-black text-ink">{money(totalCents)}</p>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutOpen(true)}
                className="rounded-xl bg-primary px-5 py-3 text-[13px] font-extrabold text-white shadow-cta"
              >
                Continuar compra
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {checkoutOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-5"
          onClick={() => !busy && setCheckoutOpen(false)}
        >
          <div
            className="max-h-[92dvh] w-full max-w-[520px] overflow-y-auto rounded-t-3xl bg-surface p-5 sm:rounded-3xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">Loja da Casa</p>
                <h2 className="mt-1 text-[20px] font-black text-ink">Finalizar pedido</h2>
                <p className="mt-1 text-[12px] font-semibold text-muted">
                  O estoque fica reservado por 15 minutos enquanto você conclui o pagamento.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutOpen(false)}
                disabled={busy}
                className="h-9 w-9 rounded-full border border-line text-[18px] text-muted"
              >
                ×
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {selected.map((item) => (
                <div key={item.variant.id} className="flex items-center justify-between gap-4 rounded-xl bg-bg px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-extrabold text-ink">{item.product.name}</p>
                    <p className="text-[10.5px] font-semibold text-muted">
                      {item.variant.name} · {item.quantity}×
                    </p>
                  </div>
                  <p className="text-[12px] font-black text-ink">
                    {money(item.variant.priceCents * item.quantity)}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome"
                autoComplete="name"
                className="h-12 w-full rounded-xl border border-line-input bg-surface px-3.5 text-[13px] font-semibold outline-none focus:border-primary"
              />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Seu e-mail"
                type="email"
                autoComplete="email"
                className="h-12 w-full rounded-xl border border-line-input bg-surface px-3.5 text-[13px] font-semibold outline-none focus:border-primary"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="WhatsApp/celular (opcional)"
                inputMode="tel"
                autoComplete="tel"
                className="h-12 w-full rounded-xl border border-line-input bg-surface px-3.5 text-[13px] font-semibold outline-none focus:border-primary"
              />
            </div>

            <div className="mt-4">
              <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-muted">Recebimento</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {liveStore.fulfillment.pickupEnabled ? (
                  <button
                    type="button"
                    onClick={() => setFulfillmentMethod("PICKUP")}
                    className={`rounded-xl border px-3 py-3 text-left text-[12px] font-extrabold ${
                      fulfillmentMethod === "PICKUP"
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-line text-ink"
                    }`}
                  >
                    Retirada na Casa
                  </button>
                ) : null}
                {liveStore.fulfillment.deliveryEnabled ? (
                  <button
                    type="button"
                    onClick={() => setFulfillmentMethod("DELIVERY")}
                    className={`rounded-xl border px-3 py-3 text-left text-[12px] font-extrabold ${
                      fulfillmentMethod === "DELIVERY"
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-line text-ink"
                    }`}
                  >
                    Entrega · {money(liveStore.fulfillment.flatShippingCents)}
                  </button>
                ) : null}
              </div>
              {liveStore.fulfillment.deliveryInstructions ? (
                <p className="mt-2 text-[10.5px] font-semibold text-muted">
                  {liveStore.fulfillment.deliveryInstructions}
                </p>
              ) : null}
            </div>

            {fulfillmentMethod === "DELIVERY" ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {[
                  ["postalCode", "CEP"],
                  ["street", "Rua / avenida"],
                  ["number", "Número"],
                  ["complement", "Complemento"],
                  ["neighborhood", "Bairro"],
                  ["city", "Cidade"],
                  ["state", "UF"],
                ].map(([key, label]) => (
                  <input
                    key={key}
                    value={address[key as keyof typeof address]}
                    onChange={(e) =>
                      setAddress((current) => ({ ...current, [key]: e.target.value }))
                    }
                    placeholder={label}
                    className="h-11 rounded-xl border border-line-input bg-surface px-3 text-[12px] font-semibold outline-none focus:border-primary"
                  />
                ))}
              </div>
            ) : null}

            <div className="mt-4 space-y-1.5 border-t border-line pt-4">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-semibold text-muted">Produtos</span>
                <span className="font-bold text-ink">{money(subtotalCents)}</span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-semibold text-muted">Frete</span>
                <span className="font-bold text-ink">
                  {shippingCents > 0 ? money(shippingCents) : "Grátis"}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-[13px] font-bold text-muted">Total</span>
                <span className="text-[20px] font-black text-ink">{money(totalCents)}</span>
              </div>
            </div>

            <p className="mt-3 rounded-xl bg-primary/5 p-3 text-[11px] font-semibold leading-relaxed text-muted">
              {fulfillmentMethod === "PICKUP"
                ? "Após o pagamento, a Casa prepara o pedido e avisa quando estiver pronto para retirada."
                : "Após o pagamento, a Casa prepara o pedido para entrega no endereço informado."}
            </p>

            {error ? <p className="mt-3 text-[12px] font-bold text-danger">{error}</p> : null}

            <button
              type="button"
              onClick={createOrder}
              disabled={busy}
              className="mt-4 h-12 w-full rounded-xl bg-primary px-4 py-3.5 text-[14px] font-extrabold text-white shadow-cta disabled:opacity-50"
            >
              {busy ? "Reservando estoque…" : "Reservar e continuar para pagamento"}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
