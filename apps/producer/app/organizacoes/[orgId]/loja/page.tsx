"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { GuardedPanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import { storeApi, type StoreProduct, type StoreVariant } from "@/lib/api";

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

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
  const [stock, setStock] = useState(String(variant.stockOnHand));
  const [price, setPrice] = useState((variant.priceCents / 100).toFixed(2).replace(".", ","));
  const [busy, setBusy] = useState(false);
  const available = Math.max(variant.stockOnHand - variant.reservedCount - variant.soldCount, 0);

  async function save() {
    setBusy(true);
    try {
      await storeApi.updateVariant(token, variant.id, {
        stockOnHand: Number(stock),
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", description: "", imageUrl: "" });
  const [variantDrafts, setVariantDrafts] = useState<Record<string, { name: string; sku: string; price: string; stock: string }>>({});

  async function load() {
    if (!token) return;
    const result = await storeApi.list(token, params.orgId);
    setProducts(result);
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
        stockOnHand: Math.max(0, Number(draftVariant.stock) || 0),
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
            (variantSum, variant) => variantSum + Math.max(variant.stockOnHand - variant.reservedCount - variant.soldCount, 0),
            0,
          ),
        0,
      ),
    [products],
  );

  return (
    <GuardedPanelShell title="Loja da Casa" organizationId={params.orgId}>
      <main>
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

        <div className="mt-6 rounded-3xl border border-warning/25 bg-warning/5 p-5">
          <p className="text-[13px] font-extrabold text-ink">Venda direta da loja</p>
          <p className="mt-1 text-[11.5px] font-semibold leading-relaxed text-muted">
            O catálogo e o estoque já ficam permanentes na Casa. A cobrança direta sem ingresso deve reutilizar a infraestrutura financeira com uma ordem de loja própria; não vamos fingir isso usando um evento oculto.
          </p>
        </div>
      </main>
    </GuardedPanelShell>
  );
}
