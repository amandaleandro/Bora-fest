"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { GuardedPanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import { storeApi, type StoreAnalytics, type StoreOrderManage, type StoreProduct, type StoreRefundRequestManage, type StoreSettings, type StoreVariant } from "@/lib/api";

function parsePrice(value: string) {
  const normalized = Number(value.trim().replace(",", "."));
  return Number.isFinite(normalized) && normalized >= 0 ? Math.round(normalized * 100) : 0;
}

function VariantRow({
  token,
  variant,
  onUpdated,
}: {
  token: string;
  variant: StoreVariant;
  onUpdated: () => Promise<void>;
}) {
  const [stock, setStock] = useState(String(variant.stockTotal));
  const [price, setPrice] = useState((variant.priceCents / 100).toFixed(2).replace(".", ","));
  const [busy, setBusy] = useState(false);
  const available = Math.max(variant.stockTotal - variant.reservedCount - variant.soldCount, 0);

  async function save() {
    setBusy(true);
    try {
      await storeApi.updateVariant(token, variant.id, {
        stockTotal: Number(stock),
        priceCents: parsePrice(price),
      });
      await onUpdated();
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    setBusy(true);
    try {
      await storeApi.updateVariant(token, variant.id, { active: !variant.active });
      await onUpdated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-2xl border border-line bg-bg p-4 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto] lg:items-end">
      <div>
        <p className="text-[13px] font-extrabold text-ink">{variant.name}</p>
        <p className="mt-0.5 text-[11px] font-semibold text-muted">SKU: {variant.sku || "—"}</p>
      </div>
      <label className="text-[10.5px] font-bold text-muted">
        Preço
        <input value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-line-input bg-surface px-3 text-[12px] text-ink" />
      </label>
      <label className="text-[10.5px] font-bold text-muted">
        Estoque total
        <input type="number" min={variant.soldCount + variant.reservedCount} value={stock} onChange={(e) => setStock(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-line-input bg-surface px-3 text-[12px] text-ink" />
      </label>
      <div>
        <p className="text-[10.5px] font-bold text-muted">Disponível agora</p>
        <p className="mt-1 text-[15px] font-black text-ink">{available}</p>
        <p className="text-[10px] font-semibold text-muted">{variant.soldCount} vendidos · {variant.reservedCount} reservados</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={toggle} disabled={busy} className={`rounded-xl px-3 py-2 text-[11px] font-extrabold ${variant.active ? "bg-success/10 text-success" : "bg-line text-muted"}`}>
          {variant.active ? "Ativa" : "Pausada"}
        </button>
        <button type="button" onClick={save} disabled={busy} className="rounded-xl bg-primary px-3 py-2 text-[11px] font-extrabold text-white disabled:opacity-50">
          Salvar
        </button>
      </div>
    </div>
  );
}

export default function StorePage({ params }: { params: { orgId: string } }) {
  const { token } = useAuth();
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [orders, setOrders] = useState<StoreOrderManage[]>([]);
  const [refunds, setRefunds] = useState<StoreRefundRequestManage[]>([]);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [analytics, setAnalytics] = useState<StoreAnalytics | null>(null);
  const [pickupCodes, setPickupCodes] = useState<Record<string, string>>({});
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", description: "", imageUrl: "" });
  const [variantDrafts, setVariantDrafts] = useState<Record<string, { name: string; sku: string; price: string; stock: string }>>({});

  async function load() {
    if (!token) return;
    const [result, orderList, refundList, storeSettings, storeAnalytics] = await Promise.all([
      storeApi.list(token, params.orgId),
      storeApi.listOrders(token, params.orgId),
      storeApi.listRefundRequests(token, params.orgId),
      storeApi.getSettings(token, params.orgId),
      storeApi.analytics(token, params.orgId),
    ]);
    setProducts(result);
    setOrders(orderList);
    setRefunds(refundList);
    setSettings(storeSettings);
    setAnalytics(storeAnalytics);
  }

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    load()
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível carregar a loja"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, params.orgId]);

  async function saveSettings(next: StoreSettings) {
    if (!token) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await storeApi.updateSettings(token, params.orgId, next);
      setSettings(saved);
      setMessage("Configuração de retirada e entrega salva.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar a configuração da Loja");
    } finally {
      setBusy(false);
    }
  }

  async function markReady(order: StoreOrderManage) {
    if (!token) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await storeApi.markReady(token, order.id);
      await load();
      setMessage(
        order.fulfillmentMethod === "DELIVERY"
          ? "Pedido marcado como pronto para envio/entrega e cliente notificado."
          : "Pedido marcado como pronto para retirada e cliente notificado.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível marcar o pedido como pronto");
    } finally {
      setBusy(false);
    }
  }

  async function markReturned(request: StoreRefundRequestManage) {
    if (!token) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await storeApi.markRefundReturned(token, params.orgId, request.id);
      await load();
      setMessage("Devolução física confirmada. O pedido já pode ser estornado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível confirmar a devolução");
    } finally {
      setBusy(false);
    }
  }

  async function approveRefund(request: StoreRefundRequestManage) {
    if (!token) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await storeApi.approveRefund(token, params.orgId, request.id);
      await load();
      setMessage(
        result.gatewayStatus === "REFUNDED"
          ? "Reembolso concluído."
          : "Estorno enviado ao provedor e aguardando confirmação.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível aprovar o reembolso");
    } finally {
      setBusy(false);
    }
  }

  async function rejectRefund(request: StoreRefundRequestManage) {
    if (!token) return;
    const note = (rejectNotes[request.id] ?? "").trim();
    if (note.length < 3) {
      setError("Informe o motivo da rejeição.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await storeApi.rejectRefund(token, params.orgId, request.id, note);
      setRejectNotes((current) => ({ ...current, [request.id]: "" }));
      await load();
      setMessage("Solicitação de reembolso rejeitada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível rejeitar o reembolso");
    } finally {
      setBusy(false);
    }
  }

  async function fulfillOrder(order: StoreOrderManage) {
    if (!token) return;
    const code = (pickupCodes[order.id] ?? "").trim();
    if (order.fulfillmentMethod === "PICKUP" && !code) {
      setError("Digite o código mostrado pelo cliente antes de confirmar a retirada.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await storeApi.fulfillOrder(token, order.id, code);
      setPickupCodes((current) => ({ ...current, [order.id]: "" }));
      await load();
      setMessage(
        order.fulfillmentMethod === "DELIVERY"
          ? "Entrega concluída."
          : "Retirada confirmada. O pedido foi marcado como entregue.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível confirmar a retirada");
    } finally {
      setBusy(false);
    }
  }

  async function createProduct(event: FormEvent) {
    event.preventDefault();
    if (!token || !draft.name.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await storeApi.create(token, params.orgId, {
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        imageUrl: draft.imageUrl.trim() || undefined,
      });
      setDraft({ name: "", description: "", imageUrl: "" });
      await load();
      setMessage("Produto criado como rascunho. Adicione ao menos uma variação antes de ativar.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o produto");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(product: StoreProduct, status: StoreProduct["status"]) {
    if (!token) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (status === "ACTIVE" && product.variants.length === 0) {
        throw new Error("Adicione pelo menos uma variação antes de publicar o produto.");
      }
      await storeApi.updateProduct(token, product.id, { status });
      await load();
      setMessage(status === "ACTIVE" ? "Produto publicado na vitrine da Casa." : "Status do produto atualizado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar o produto");
    } finally {
      setBusy(false);
    }
  }

  async function addVariant(productId: string) {
    if (!token) return;
    const draftVariant = variantDrafts[productId] ?? { name: "", sku: "", price: "", stock: "" };
    if (!draftVariant.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await storeApi.createVariant(token, productId, {
        name: draftVariant.name.trim(),
        sku: draftVariant.sku.trim() || undefined,
        priceCents: parsePrice(draftVariant.price),
        stockTotal: Math.max(0, Number(draftVariant.stock) || 0),
      });
      setVariantDrafts((current) => ({ ...current, [productId]: { name: "", sku: "", price: "", stock: "" } }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a variação");
    } finally {
      setBusy(false);
    }
  }

  const totalAvailable = useMemo(
    () =>
      products.reduce(
        (sum, product) =>
          sum +
          product.variants.reduce(
            (variantSum, variant) => variantSum + Math.max(variant.stockTotal - variant.reservedCount - variant.soldCount, 0),
            0,
          ),
        0,
      ),
    [products],
  );

  return (
    <GuardedPanelShell title="Loja da Casa" organizationId={params.orgId}>
      <main>
        {settings ? (
          <section className="mb-6 rounded-3xl border border-line bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">Entrega</p>
                <h2 className="mt-1 text-[18px] font-black text-ink">Como a Casa entrega os produtos</h2>
                <p className="mt-1 text-[11.5px] font-semibold text-muted">
                  Mantenha pelo menos retirada ou entrega habilitada.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void saveSettings(settings)}
                disabled={busy}
                className="rounded-xl bg-primary px-4 py-2.5 text-[11px] font-extrabold text-white disabled:opacity-50"
              >
                Salvar configuração
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-3 rounded-xl border border-line bg-bg p-3">
                <input
                  type="checkbox"
                  checked={settings.pickupEnabled}
                  onChange={(e) => setSettings({ ...settings, pickupEnabled: e.target.checked })}
                />
                <span className="text-[12px] font-extrabold text-ink">Retirada na Casa</span>
              </label>
              <label className="flex items-center gap-3 rounded-xl border border-line bg-bg p-3">
                <input
                  type="checkbox"
                  checked={settings.deliveryEnabled}
                  onChange={(e) => setSettings({ ...settings, deliveryEnabled: e.target.checked })}
                />
                <span className="text-[12px] font-extrabold text-ink">Entrega local</span>
              </label>
            </div>
            {settings.deliveryEnabled ? (
              <div className="mt-3 grid gap-3 md:grid-cols-[180px_1fr]">
                <label className="text-[10.5px] font-bold text-muted">
                  Frete fixo (R$)
                  <input
                    value={(settings.flatShippingCents / 100).toFixed(2).replace(".", ",")}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        flatShippingCents: parsePrice(e.target.value),
                      })
                    }
                    className="mt-1 h-10 w-full rounded-xl border border-line-input bg-bg px-3 text-[12px] text-ink"
                  />
                </label>
                <label className="text-[10.5px] font-bold text-muted">
                  Instruções de entrega
                  <input
                    value={settings.deliveryInstructions ?? ""}
                    onChange={(e) =>
                      setSettings({ ...settings, deliveryInstructions: e.target.value })
                    }
                    placeholder="Ex.: Entregas em Uberlândia de segunda a sexta"
                    className="mt-1 h-10 w-full rounded-xl border border-line-input bg-bg px-3 text-[12px] text-ink"
                  />
                </label>
              </div>
            ) : null}
          </section>
        ) : null}

        {analytics ? (
          <section className="mb-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Receita da Loja", (analytics.grossCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })],
                ["Pedidos pagos", String(analytics.paidOrders)],
                ["Ticket médio", (analytics.averageTicketCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })],
                ["Clientes únicos", String(analytics.uniqueCustomers)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-line bg-surface p-4">
                  <p className="text-[10.5px] font-bold text-muted">{label}</p>
                  <p className="mt-1 text-[20px] font-black text-ink">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-line bg-surface p-4">
                <h3 className="text-[13px] font-extrabold text-ink">Produtos mais vendidos</h3>
                <div className="mt-3 space-y-2">
                  {analytics.topProducts.length === 0 ? (
                    <p className="text-[11px] font-semibold text-muted">Sem vendas ainda.</p>
                  ) : analytics.topProducts.map((product) => (
                    <div key={product.name} className="flex items-center justify-between gap-3 rounded-xl bg-bg px-3 py-2">
                      <span className="text-[11px] font-bold text-ink">{product.name}</span>
                      <span className="text-[10.5px] font-extrabold text-muted">
                        {product.quantity} un. · {(product.revenueCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-line bg-surface p-4">
                <h3 className="text-[13px] font-extrabold text-ink">CRM · principais clientes</h3>
                <div className="mt-3 space-y-2">
                  {analytics.customers.length === 0 ? (
                    <p className="text-[11px] font-semibold text-muted">Sem clientes ainda.</p>
                  ) : analytics.customers.slice(0, 10).map((customer) => (
                    <div key={customer.email} className="rounded-xl bg-bg px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] font-bold text-ink">{customer.name}</span>
                        <span className="text-[10.5px] font-extrabold text-muted">
                          {(customer.spentCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] font-semibold text-muted">
                        {customer.email} · {customer.orders} pedido{customer.orders === 1 ? "" : "s"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">BF-021 · catálogo permanente</p>
            <h1 className="mt-1 text-[27px] font-black tracking-tight text-ink">Loja da Casa</h1>
            <p className="mt-2 max-w-3xl text-[13px] font-semibold leading-relaxed text-muted">
              Camisetas, copos, kits e outros produtos ficam ligados à Casa, não a um evento específico. Variações têm estoque próprio.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-surface px-4 py-3 text-right">
            <p className="text-[10px] font-extrabold uppercase tracking-[.06em] text-muted-2">Estoque disponível</p>
            <p className="mt-1 text-[22px] font-black text-ink">{totalAvailable}</p>
          </div>
        </div>

        {error ? <p className="mt-5 rounded-2xl border border-danger/25 bg-danger/5 p-4 text-[12px] font-bold text-danger">{error}</p> : null}
        {message ? <p className="mt-5 rounded-2xl border border-success/25 bg-success/5 p-4 text-[12px] font-bold text-success">{message}</p> : null}

        <form onSubmit={createProduct} className="mt-6 rounded-3xl border border-line bg-surface p-5">
          <div>
            <h2 className="text-[16px] font-black text-ink">Novo produto</h2>
            <p className="mt-1 text-[11.5px] font-semibold text-muted">O produto nasce como rascunho e só aparece publicamente quando você ativar.</p>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <input required minLength={2} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Ex.: Camiseta oficial" className="h-11 rounded-xl border border-line-input bg-bg px-3 text-[12px] text-ink" />
            <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Descrição curta" className="h-11 rounded-xl border border-line-input bg-bg px-3 text-[12px] text-ink" />
            <input type="url" value={draft.imageUrl} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} placeholder="Imagem do produto (URL)" className="h-11 rounded-xl border border-line-input bg-bg px-3 text-[12px] text-ink" />
          </div>
          <button disabled={busy || !draft.name.trim()} className="mt-3 h-11 rounded-xl bg-primary px-5 text-[12px] font-extrabold text-white disabled:opacity-50">
            Criar produto
          </button>
        </form>

        {loading ? <div className="mt-6 rounded-3xl border border-line bg-surface p-10 text-center text-[12px] font-semibold text-muted">Carregando produtos…</div> : null}

        {!loading && products.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-line bg-surface p-10 text-center">
            <p className="text-[15px] font-extrabold text-ink">Sua loja ainda está vazia</p>
            <p className="mt-1 text-[12px] font-semibold text-muted">Crie o primeiro produto acima. Para camiseta, use uma variação por tamanho.</p>
          </div>
        ) : null}

        <div className="mt-6 space-y-5">
          {products.map((product) => {
            const variantDraft = variantDrafts[product.id] ?? { name: "", sku: "", price: "", stock: "" };
            return (
              <section key={product.id} className="rounded-3xl border border-line bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 gap-4">
                    {product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.imageUrl} alt="" className="h-20 w-20 rounded-2xl border border-line object-cover" />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-line bg-bg text-[24px]">🛍️</div>
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-[18px] font-black text-ink">{product.name}</h2>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${
                          product.status === "ACTIVE" ? "bg-success/10 text-success" : product.status === "ARCHIVED" ? "bg-line text-muted" : "bg-warning/10 text-warning"
                        }`}>{product.status === "ACTIVE" ? "Publicado" : product.status === "ARCHIVED" ? "Arquivado" : "Rascunho"}</span>
                      </div>
                      <p className="mt-1 text-[12px] font-semibold text-muted">{product.description || "Sem descrição"}</p>
                      <p className="mt-1 text-[10.5px] font-semibold text-muted-2">/{product.slug}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {product.status !== "ACTIVE" ? (
                      <button type="button" disabled={busy} onClick={() => setStatus(product, "ACTIVE")} className="rounded-xl bg-primary px-3 py-2 text-[11px] font-extrabold text-white disabled:opacity-50">Publicar</button>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => setStatus(product, "DRAFT")} className="rounded-xl border border-line-input px-3 py-2 text-[11px] font-extrabold text-muted disabled:opacity-50">Ocultar</button>
                    )}
                    {product.status !== "ARCHIVED" ? (
                      <button type="button" disabled={busy} onClick={() => setStatus(product, "ARCHIVED")} className="rounded-xl border border-line-input px-3 py-2 text-[11px] font-extrabold text-muted disabled:opacity-50">Arquivar</button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-5 space-y-2">
                  {product.variants.map((variant) => (
                    <VariantRow key={variant.id} token={token!} variant={variant} onUpdated={load} />
                  ))}
                </div>

                <div className="mt-4 rounded-2xl border border-dashed border-line-input bg-bg/50 p-4">
                  <p className="text-[12px] font-extrabold text-ink">Adicionar variação</p>
                  <div className="mt-3 grid gap-2 md:grid-cols-4">
                    <input value={variantDraft.name} onChange={(e) => setVariantDrafts({ ...variantDrafts, [product.id]: { ...variantDraft, name: e.target.value } })} placeholder="Ex.: M / Único / 500ml" className="h-10 rounded-xl border border-line-input bg-surface px-3 text-[11.5px]" />
                    <input value={variantDraft.sku} onChange={(e) => setVariantDrafts({ ...variantDrafts, [product.id]: { ...variantDraft, sku: e.target.value } })} placeholder="SKU opcional" className="h-10 rounded-xl border border-line-input bg-surface px-3 text-[11.5px]" />
                    <input value={variantDraft.price} onChange={(e) => setVariantDrafts({ ...variantDrafts, [product.id]: { ...variantDraft, price: e.target.value } })} placeholder="Preço (ex.: 39,90)" className="h-10 rounded-xl border border-line-input bg-surface px-3 text-[11.5px]" />
                    <input type="number" min={0} value={variantDraft.stock} onChange={(e) => setVariantDrafts({ ...variantDrafts, [product.id]: { ...variantDraft, stock: e.target.value } })} placeholder="Estoque" className="h-10 rounded-xl border border-line-input bg-surface px-3 text-[11.5px]" />
                  </div>
                  <button type="button" disabled={busy || !variantDraft.name.trim()} onClick={() => addVariant(product.id)} className="mt-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2 text-[11px] font-extrabold text-primary disabled:opacity-50">
                    + Adicionar variação
                  </button>
                </div>
              </section>
            );
          })}
        </div>

        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-primary">Operação</p>
              <h2 className="mt-1 text-[20px] font-black text-ink">Pedidos da Loja</h2>
              <p className="mt-1 text-[12px] font-semibold text-muted">
                Pagamentos confirmados geram um código de retirada. Confira o código antes de entregar o produto.
              </p>
            </div>
            <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[10.5px] font-extrabold text-muted">
              {orders.length} pedido{orders.length === 1 ? "" : "s"}
            </span>
          </div>

          {orders.length === 0 ? (
            <div className="mt-4 rounded-3xl border border-line bg-surface p-8 text-center">
              <p className="text-[13px] font-extrabold text-ink">Nenhuma compra na Loja ainda</p>
              <p className="mt-1 text-[11.5px] font-semibold text-muted">
                Quando alguém comprar pela página pública da Casa, o pedido aparece aqui.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {orders.map((order) => {
                const canFulfill = order.status === "READY";
                const canMarkReady = order.status === "PAID";
                const paid = ["PAID", "READY", "FULFILLED"].includes(order.status);
                return (
                  <article key={order.id} className="rounded-2xl border border-line bg-surface p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[13px] font-extrabold text-ink">{order.contactName}</p>
                          <span className={`rounded-full px-2.5 py-1 text-[9.5px] font-extrabold ${
                            order.status === "FULFILLED"
                              ? "bg-success/10 text-success"
                              : paid
                                ? "bg-primary/10 text-primary"
                                : ["CANCELED", "REFUNDED", "CHARGEBACK"].includes(order.status)
                                  ? "bg-danger/10 text-danger"
                                  : "bg-warning/10 text-warning"
                          }`}>
                            {order.status === "FULFILLED"
                              ? order.fulfillmentMethod === "DELIVERY" ? "Entregue" : "Retirado"
                              : order.status === "PAID"
                                ? "Pago · em preparo"
                                : order.status === "READY"
                                  ? order.fulfillmentMethod === "DELIVERY" ? "Pronto para entrega" : "Pronto para retirada"
                                : order.status === "PAYMENT_PENDING"
                                  ? "Aguardando Pix"
                                  : order.status === "CREATED"
                                    ? "Criado"
                                    : order.status}
                          </span>
                        </div>
                        <p className="mt-1 text-[10.5px] font-semibold text-muted">
                          {order.contactEmail}{order.contactPhone ? ` · ${order.contactPhone}` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[16px] font-black text-ink">
                          {(order.totalCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </p>
                        <p className="text-[10px] font-semibold text-muted">
                          {new Date(order.createdAt).toLocaleString("pt-BR")}
                        </p>
                      </div>
                    </div>

                    {order.fulfillmentMethod === "DELIVERY" && order.shippingAddress ? (
                      <div className="mt-3 rounded-xl border border-line bg-bg p-3 text-[10.5px] font-semibold text-muted">
                        Entrega: {order.shippingAddress.street}, {order.shippingAddress.number}
                        {order.shippingAddress.complement ? ` · ${order.shippingAddress.complement}` : ""}
                        <br />
                        {order.shippingAddress.neighborhood} · {order.shippingAddress.city}/{order.shippingAddress.state}
                        <br />
                        CEP {order.shippingAddress.postalCode} · frete {(order.shippingCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </div>
                    ) : null}

                    <div className="mt-3 space-y-1.5">
                      {order.items.map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-bg px-3 py-2">
                          <p className="text-[11px] font-bold text-ink">
                            {item.productName} · {item.variantName}
                          </p>
                          <p className="text-[11px] font-extrabold text-muted">{item.quantity}×</p>
                        </div>
                      ))}
                    </div>

                    {canMarkReady ? (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => void markReady(order)}
                          disabled={busy}
                          className="h-10 rounded-xl bg-success px-4 text-[11px] font-extrabold text-white disabled:opacity-50"
                        >
                          {order.fulfillmentMethod === "DELIVERY" ? "Marcar pronto para entrega" : "Marcar pronto para retirada"}
                        </button>
                      </div>
                    ) : null}

                    {canFulfill ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/15 bg-primary/5 p-3">
                        {order.fulfillmentMethod === "PICKUP" ? (
                          <input
                            value={pickupCodes[order.id] ?? ""}
                            onChange={(e) =>
                              setPickupCodes((current) => ({
                                ...current,
                                [order.id]: e.target.value.toUpperCase().slice(0, 20),
                              }))
                            }
                            placeholder="Código de retirada"
                            autoComplete="off"
                            className="h-10 min-w-[180px] flex-1 rounded-xl border border-line-input bg-surface px-3 font-mono text-[12px] font-bold tracking-[.08em]"
                          />
                        ) : (
                          <p className="flex-1 text-[11px] font-semibold text-muted">
                            Confirme quando a entrega estiver concluída.
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => void fulfillOrder(order)}
                          disabled={busy}
                          className="h-10 rounded-xl bg-primary px-4 text-[11px] font-extrabold text-white disabled:opacity-50"
                        >
                          {order.fulfillmentMethod === "DELIVERY" ? "Confirmar entregue" : "Confirmar retirada"}
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-8">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-danger">Pós-venda</p>
            <h2 className="mt-1 text-[20px] font-black text-ink">Reembolsos e devoluções</h2>
            <p className="mt-1 text-[12px] font-semibold text-muted">
              Pedido já retirado precisa voltar fisicamente antes do estorno. Pedido ainda não retirado pode ser estornado direto.
            </p>
          </div>

          {refunds.length === 0 ? (
            <div className="mt-4 rounded-3xl border border-line bg-surface p-8 text-center">
              <p className="text-[13px] font-extrabold text-ink">Nenhuma solicitação pendente</p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {refunds.map((request) => {
                const active = ["PENDING", "AWAITING_RETURN"].includes(request.status);
                return (
                  <article key={request.id} className="rounded-2xl border border-line bg-surface p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-extrabold text-ink">{request.order.contactName}</p>
                          <span className={`rounded-full px-2.5 py-1 text-[9.5px] font-extrabold ${
                            request.status === "AWAITING_RETURN"
                              ? "bg-warning/10 text-warning"
                              : request.status === "PENDING"
                                ? "bg-primary/10 text-primary"
                                : request.status === "APPROVED"
                                  ? "bg-success/10 text-success"
                                  : "bg-danger/10 text-danger"
                          }`}>
                            {request.status === "AWAITING_RETURN"
                              ? "Aguardando devolução"
                              : request.status === "PENDING"
                                ? request.returnedAt
                                  ? "Devolução recebida · pronto para estorno"
                                  : "Aguardando análise"
                                : request.status === "APPROVED"
                                  ? "Aprovado"
                                  : "Rejeitado"}
                          </span>
                        </div>
                        <p className="mt-1 text-[10.5px] font-semibold text-muted">{request.order.contactEmail}</p>
                        <p className="mt-2 text-[11px] font-semibold text-ink-soft">{request.reason}</p>
                      </div>
                      <p className="text-[15px] font-black text-ink">
                        {(request.order.totalCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </p>
                    </div>

                    <div className="mt-3 space-y-1.5">
                      {request.order.items.map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-bg px-3 py-2">
                          <p className="text-[11px] font-bold text-ink">{item.productName} · {item.variantName}</p>
                          <p className="text-[11px] font-extrabold text-muted">{item.quantity}×</p>
                        </div>
                      ))}
                    </div>

                    {request.status === "AWAITING_RETURN" ? (
                      <button
                        type="button"
                        onClick={() => void markReturned(request)}
                        disabled={busy}
                        className="mt-3 rounded-xl bg-warning px-4 py-2.5 text-[11px] font-extrabold text-white disabled:opacity-50"
                      >
                        Confirmar que recebi a devolução
                      </button>
                    ) : null}

                    {request.status === "PENDING" ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void approveRefund(request)}
                          disabled={busy}
                          className="rounded-xl bg-success px-4 py-2.5 text-[11px] font-extrabold text-white disabled:opacity-50"
                        >
                          Aprovar estorno
                        </button>
                        <input
                          value={rejectNotes[request.id] ?? ""}
                          onChange={(e) =>
                            setRejectNotes((current) => ({ ...current, [request.id]: e.target.value }))
                          }
                          placeholder="Motivo para rejeitar"
                          className="h-10 min-w-[190px] flex-1 rounded-xl border border-line-input bg-bg px-3 text-[11px]"
                        />
                        <button
                          type="button"
                          onClick={() => void rejectRefund(request)}
                          disabled={busy}
                          className="rounded-xl border border-danger/30 px-4 py-2.5 text-[11px] font-extrabold text-danger disabled:opacity-50"
                        >
                          Rejeitar
                        </button>
                      </div>
                    ) : null}

                    {!active && request.resolutionNote ? (
                      <p className="mt-3 rounded-xl bg-bg p-3 text-[11px] font-semibold text-muted">
                        Observação: {request.resolutionNote}
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </GuardedPanelShell>
  );
}
