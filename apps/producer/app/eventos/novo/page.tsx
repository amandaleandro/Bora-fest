"use client";

import { CHECKOUT_URL } from "@/lib/config";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth";
import { eventsApi, catalogApi, eventControls, addOnsApi, ApiError, UF_LIST, EVENT_CATEGORIES, type EventVenue, type EventCategory, type EventAddOn } from "@/lib/api";

const inputCls = "mt-1 h-[46px] w-full rounded-xl border-[1.5px] border-line-input bg-surface px-3.5 text-[14px] font-medium outline-none focus:border-primary";
const labelCls = "text-[12px] font-bold text-ink-soft";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Aceita "49,90" e "49.90". Inválido/vazio → 0. */
function parsePriceCents(value: string): number {
  const n = Number(value.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

/** Espelho da taxa do SERVIDOR (4,99% com piso R$ 2,49; grátis = 0) — só exibição. */
function serviceFeeCents(priceCents: number): number {
  if (priceCents <= 0) return 0;
  return Math.max(Math.round(priceCents * 0.0499), 249);
}

/** Erros 5xx/rede não têm mensagem útil pra exibir — troca por texto amigável. */
function friendlyError(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status >= 500) return "Erro no servidor. Tente novamente em instantes.";
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

interface DraftLot {
  typeName: string;
  lotName: string;
  price: string;
  capacity: string;
}

function Stepper({ step }: { step: number }) {
  const labels = ["Dados", "Ingressos", "Detalhes finais", "Publicar"];
  return (
    <div className="flex items-center gap-3">
      {labels.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold ${
            i < step ? "bg-success text-white" : i === step ? "bg-primary text-white" : "bg-line text-muted"
          }`}>
            {i < step ? "✓" : i + 1}
          </span>
          <span className={`text-[13px] font-bold ${i <= step ? "text-ink" : "text-muted-3"}`}>{label}</span>
          {i < labels.length - 1 && <span className="h-px w-8 bg-line" />}
        </div>
      ))}
    </div>
  );
}

function NewEventContent() {
  const router = useRouter();
  const { token } = useAuth();
  const orgId = useSearchParams().get("org") ?? "";

  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // etapa 1
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [lineup, setLineup] = useState("");
  const [amenities, setAmenities] = useState("");
  const [minAge, setMinAge] = useState("");
  const [category, setCategory] = useState<EventCategory | "">("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [eventId, setEventId] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);

  // etapa 1 — local do evento (opcional no formulário; sem ele o evento fica
  // fora da busca por cidade no site do comprador)
  const [venueName, setVenueName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [venueMapsUrl, setVenueMapsUrl] = useState("");
  const [venueCity, setVenueCity] = useState("");
  const [venueState, setVenueState] = useState("");
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);

  // Ao trocar a UF, busca as cidades do estado (API do IBGE) para autocompletar.
  useEffect(() => {
    if (!venueState) { setCityOptions([]); return; }
    let cancelled = false;
    setLoadingCities(true);
    fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${venueState}/municipios`)
      .then((res) => res.json())
      .then((data: Array<{ nome: string }>) => {
        if (cancelled) return;
        setCityOptions(data.map((m) => m.nome).sort((a, b) => a.localeCompare(b, "pt-BR")));
      })
      .catch(() => { if (!cancelled) setCityOptions([]); })
      .finally(() => { if (!cancelled) setLoadingCities(false); });
    return () => { cancelled = true; };
  }, [venueState]);

  // etapa 2
  const [lots, setLots] = useState<DraftLot[]>([]);
  const [draft, setDraft] = useState<DraftLot>({ typeName: "Pista", lotName: "1º Lote", price: "", capacity: "" });
  const [createdLots, setCreatedLots] = useState<string[]>([]);

  // etapa 3 — detalhes finais (banner, local, descrição/categoria, itens adicionais)
  const [published, setPublished] = useState(false);
  const [bannerUrl, setBannerUrl] = useState("");
  const [bannerUploading, setBannerUploading] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);

  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsSaved, setDetailsSaved] = useState(false);

  const [addOns, setAddOns] = useState<EventAddOn[]>([]);
  const [addOnName, setAddOnName] = useState("");
  const [addOnPrice, setAddOnPrice] = useState("");
  const [addOnSaving, setAddOnSaving] = useState(false);
  const [addOnError, setAddOnError] = useState<string | null>(null);

  async function saveDetails() {
    if (!token || !eventId) return;
    const venueCoreFilled = [venueName.trim(), venueCity.trim(), venueState].filter(Boolean).length;
    if (venueCoreFilled > 0 && venueCoreFilled < 3) {
      setDetailsError("Complete o local do evento (nome, cidade e UF) ou deixe os campos em branco.");
      return;
    }
    const venue: EventVenue | undefined = venueCoreFilled === 3
      ? {
          name: venueName.trim(),
          address: venueAddress.trim() || undefined,
          mapsUrl: venueMapsUrl.trim() || undefined,
          city: venueCity.trim(),
          state: venueState,
        }
      : undefined;

    setDetailsSaving(true);
    setDetailsError(null);
    setDetailsSaved(false);
    try {
      await eventControls.update(eventId, {
        description: description || undefined,
        lineup: lineup.trim() || undefined,
        amenities: amenities.trim() || undefined,
        minAge: minAge ? Number(minAge) : undefined,
        category: category || undefined,
        venue,
      }, token);
      setDetailsSaved(true);
    } catch (err) {
      setDetailsError(friendlyError(err, "Não foi possível salvar os detalhes"));
    } finally {
      setDetailsSaving(false);
    }
  }

  async function createAddOn() {
    if (!token || !eventId || !addOnName.trim() || !addOnPrice) return;
    setAddOnError(null);
    setAddOnSaving(true);
    try {
      const priceCents = parsePriceCents(addOnPrice);
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
      // silencioso — o toggle é otimista o suficiente pra não precisar bloquear a UI
    }
  }

  async function handleBannerFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !token || !eventId) return;
    setBannerError(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setBannerError("Formato não aceito — envie uma imagem JPG, PNG ou WebP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
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

  async function saveStep1() {
    if (!token || !orgId) { setError("Abra pelo botão Criar evento da organização"); return; }

    if (!category) {
      setError("Escolha a categoria do evento — é ela que define a prateleira da home.");
      return;
    }
    // Local é opcional; endereço e link do Maps são independentes (nenhum dos dois é obrigatório).
    // Mas nome, cidade e UF precisam vir juntos quando algum dado de local é informado.
    const venueCoreFilled = [venueName.trim(), venueCity.trim(), venueState].filter(Boolean).length;
    if (venueCoreFilled > 0 && venueCoreFilled < 3) {
      setError("Complete o local do evento (nome, cidade e UF) ou deixe os campos em branco.");
      return;
    }
    const venue: EventVenue | undefined = venueCoreFilled === 3
      ? {
          name: venueName.trim(),
          address: venueAddress.trim() || undefined,
          mapsUrl: venueMapsUrl.trim() || undefined,
          city: venueCity.trim(),
          state: venueState,
        }
      : undefined;

    setBusy(true);
    setError(null);
    try {
      const event = await eventsApi.create(token, orgId, {
        title,
        description: description || undefined,
        lineup: lineup.trim() || undefined,
        amenities: amenities.trim() || undefined,
        minAge: minAge ? Number(minAge) : undefined,
        category,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        venue,
      }) as { id: string; slug: string };
      setEventId(event.id);
      setSlug(event.slug);
      setStep(1);
    } catch (err) {
      setError(friendlyError(err, "Não foi possível criar o evento"));
    } finally {
      setBusy(false);
    }
  }

  async function addLot() {
    if (!token || !eventId) return;
    setBusy(true);
    setError(null);
    try {
      const type = await catalogApi.createTicketType(token, eventId, { name: draft.typeName }) as { id: string };
      const priceCents = parsePriceCents(draft.price);
      const lot = await catalogApi.createLot(token, type.id, {
        name: draft.lotName,
        priceCents,
        // Taxa é calculada pelo servidor; o valor abaixo é só o espelho do contrato.
        feeCents: serviceFeeCents(priceCents),
        capacity: Number(draft.capacity),
      }) as { id: string };
      await catalogApi.activateLot(token, lot.id);
      setLots((prev) => [...prev, draft]);
      setCreatedLots((prev) => [...prev, lot.id]);
      setDraft({ typeName: draft.typeName, lotName: "", price: "", capacity: "" });
    } catch (err) {
      setError(friendlyError(err, "Não foi possível criar o lote"));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!token || !eventId) return;
    setBusy(true);
    setError(null);
    try {
      await eventsApi.publish(token, eventId);
      setPublished(true);
    } catch (err) {
      setError(friendlyError(err, "Não foi possível publicar"));
    } finally {
      setBusy(false);
    }
  }

  const publicUrl = slug ? `${CHECKOUT_URL}/evento/${slug}` : "";

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-[26px] font-extrabold">Criar evento</h1>
      <div className="mt-4"><Stepper step={step} /></div>
      {error && <p className="mt-3 text-[12px] font-semibold text-danger">{error}</p>}

      {step === 0 && (
        <section className="mt-6 space-y-4 rounded-2xl border border-line bg-surface p-5">
          <div>
            <label className={labelCls}>Nome do evento</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: CIA 2026 · Copa Inter Atléticas" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Início</label>
              <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Término</label>
              <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Descrição</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
              className="mt-1 w-full rounded-xl border-[1.5px] border-line-input bg-surface px-3.5 py-3 text-[14px] font-medium outline-none focus:border-primary" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Atrações / line-up</label>
              <textarea value={lineup} onChange={(e) => setLineup(e.target.value)} rows={3}
                placeholder={"Um por linha. Ex.:\nDJ Fulano\nBanda Tal"}
                className="mt-1 w-full rounded-xl border-[1.5px] border-line-input bg-surface px-3.5 py-3 text-[14px] font-medium outline-none focus:border-primary" />
            </div>
            <div>
              <label className={labelCls}>O que está incluso</label>
              <textarea value={amenities} onChange={(e) => setAmenities(e.target.value)} rows={3}
                placeholder={"Um por linha. Ex.:\nOpen bar até 22h\nEstacionamento"}
                className="mt-1 w-full rounded-xl border-[1.5px] border-line-input bg-surface px-3.5 py-3 text-[14px] font-medium outline-none focus:border-primary" />
            </div>
          </div>
          <div>
            <label className={labelCls}>Idade mínima</label>
            <select value={minAge} onChange={(e) => setMinAge(e.target.value)} className={inputCls}>
              <option value="">Livre</option>
              <option value="14">14+</option>
              <option value="16">16+</option>
              <option value="18">18+</option>
            </select>
            <p className="mt-1 text-[12px] font-semibold text-muted">
              Aparece em destaque na página do evento — evita atrito na portaria.
            </p>
          </div>
          <div>
            <label className={labelCls}>Categoria</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as EventCategory | "")} className={inputCls}>
              <option value="">Escolha a categoria…</option>
              {EVENT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <p className="mt-1 text-[12px] font-semibold text-muted">
              Obrigatória — define em qual prateleira da home seu evento aparece.
            </p>
          </div>
          <fieldset className="rounded-xl border border-line bg-bg p-4">
            <legend className="px-1 text-[13px] font-extrabold">Local do evento</legend>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Nome do lugar</label>
                <input value={venueName} onChange={(e) => setVenueName(e.target.value)} placeholder="Ex.: Arena BSB" className={inputCls} />
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-3">
                <div>
                  <label className={labelCls}>UF</label>
                  <select
                    value={venueState}
                    onChange={(e) => { setVenueState(e.target.value); setVenueCity(""); }}
                    className={inputCls}
                  >
                    <option value="">—</option>
                    {UF_LIST.map((uf) => (
                      <option key={uf} value={uf}>{uf}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Cidade</label>
                  <input
                    list="venue-city-options"
                    value={venueCity}
                    onChange={(e) => setVenueCity(e.target.value)}
                    placeholder={!venueState ? "Selecione a UF primeiro" : loadingCities ? "Carregando cidades…" : "Digite para buscar"}
                    disabled={!venueState}
                    className={`${inputCls} disabled:opacity-50`}
                  />
                  <datalist id="venue-city-options">
                    {cityOptions.map((city) => (
                      <option key={city} value={city} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div>
                <label className={labelCls}>Endereço</label>
                <input
                  value={venueAddress}
                  onChange={(e) => setVenueAddress(e.target.value)}
                  placeholder="Rua, número e bairro (opcional)"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Link do local (Google Maps)</label>
                <input
                  type="url"
                  value={venueMapsUrl}
                  onChange={(e) => setVenueMapsUrl(e.target.value)}
                  placeholder="https://maps.google.com/... (opcional)"
                  className={inputCls}
                />
              </div>
              <p className="text-[12px] font-semibold text-warning">
                Sem local, seu evento não aparece na busca por cidade.
              </p>
            </div>
          </fieldset>
          <p className="text-[12px] font-semibold text-muted">
            O banner do evento é adicionado depois, na página do evento (upload direto do celular).
          </p>
          <button onClick={saveStep1} disabled={busy || title.length < 3 || !startsAt || !endsAt}
            className="h-12 rounded-xl bg-primary px-8 text-[14px] font-extrabold text-white shadow-cta disabled:bg-[#d9d2e8] disabled:shadow-none">
            {busy ? "Salvando…" : "Continuar"}
          </button>
        </section>
      )}

      {step === 1 && (
        <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[16px] font-extrabold">Ingressos</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <input placeholder="Tipo (Pista)" value={draft.typeName} onChange={(e) => setDraft({ ...draft, typeName: e.target.value })} className={inputCls} />
            <input placeholder="Lote (1º Lote)" value={draft.lotName} onChange={(e) => setDraft({ ...draft, lotName: e.target.value })} className={inputCls} />
            <input placeholder="Quanto você quer receber (R$)" inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} className={inputCls} />
            <input placeholder="Qtd" inputMode="numeric" value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: e.target.value })} className={inputCls} />
          </div>
          {draft.price && (
            <p className="mt-2 text-[12px] font-bold text-ink-soft">
              Taxa de serviço (automática): {formatCents(serviceFeeCents(parsePriceCents(draft.price)))} — cobrada do
              comprador, não desconta do seu valor ·{" "}
              <span className="text-success">
                preço final para o comprador {formatCents(parsePriceCents(draft.price) + serviceFeeCents(parsePriceCents(draft.price)))}
              </span>
            </p>
          )}
          <button onClick={addLot} disabled={busy || !draft.typeName || !draft.lotName || !draft.price || !draft.capacity}
            className="mt-3 rounded-xl bg-primary px-5 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-40">
            + Adicionar ingresso
          </button>

          <div className="mt-4 space-y-2">
            {lots.map((lot, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-bg px-4 py-2.5 text-[13px] font-semibold">
                <span>{lot.typeName} — {lot.lotName}</span>
                <span>
                  {formatCents(parsePriceCents(lot.price))} + taxa {formatCents(serviceFeeCents(parsePriceCents(lot.price)))} · {lot.capacity} un ·{" "}
                  <span className="text-success">Disponível</span>
                </span>
              </div>
            ))}
            {lots.length === 0 && <p className="text-[13px] text-muted">Nenhum ingresso ainda — adicione o primeiro acima.</p>}
          </div>

          {lots.length > 0 && (
            <div className="mt-4 rounded-xl bg-bg p-4 text-[13px] font-bold">
              <p className="text-ink-soft">Resumo (se vender tudo, taxa cobrada do comprador)</p>
              <div className="mt-1.5 flex items-center justify-between">
                <span>Total em ingressos</span>
                <span>
                  {formatCents(
                    lots.reduce((sum, l) => sum + parsePriceCents(l.price) * (Number(l.capacity) || 0), 0),
                  )}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-muted">
                <span>Total em taxas</span>
                <span>
                  {formatCents(
                    lots.reduce(
                      (sum, l) => sum + serviceFeeCents(parsePriceCents(l.price)) * (Number(l.capacity) || 0),
                      0,
                    ),
                  )}
                </span>
              </div>
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <button onClick={() => setStep(0)} className="rounded-xl border-[1.5px] border-line-input px-6 py-2.5 text-[13px] font-bold">Voltar</button>
            <button onClick={() => setStep(2)} disabled={createdLots.length === 0}
              className="rounded-xl bg-primary px-6 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-40">
              Continuar
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="mt-6 space-y-4 rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[16px] font-extrabold">Detalhes finais</h2>

          <div>
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
              <label className={`cursor-pointer rounded-xl border-[1.5px] border-line-input px-5 py-2.5 text-[13px] font-bold ${bannerUploading ? "pointer-events-none opacity-60" : ""}`}>
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
            {!bannerUrl && (
              <p className="mt-3 text-[12px] font-bold text-accent">
                Você pode publicar sem banner e adicionar depois, mas um evento sem banner tende a vender menos —
                recomendamos subir a imagem antes de divulgar o link.
              </p>
            )}
          </div>

          <fieldset className="rounded-xl border border-line bg-bg p-4">
            <legend className="px-1 text-[13px] font-extrabold">Descrição e categoria</legend>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Descrição</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
                  className="mt-1 w-full rounded-xl border-[1.5px] border-line-input bg-surface px-3.5 py-3 text-[14px] font-medium outline-none focus:border-primary" />
              </div>
              <div>
                <label className={labelCls}>Atrações / line-up (um por linha)</label>
                <textarea value={lineup} onChange={(e) => setLineup(e.target.value)} rows={3}
                  className="mt-1 w-full rounded-xl border-[1.5px] border-line-input bg-surface px-3.5 py-3 text-[14px] font-medium outline-none focus:border-primary" />
              </div>
              <div>
                <label className={labelCls}>O que está incluso (um por linha)</label>
                <textarea value={amenities} onChange={(e) => setAmenities(e.target.value)} rows={3}
                  className="mt-1 w-full rounded-xl border-[1.5px] border-line-input bg-surface px-3.5 py-3 text-[14px] font-medium outline-none focus:border-primary" />
              </div>
              <div>
                <label className={labelCls}>Idade mínima</label>
                <select value={minAge} onChange={(e) => setMinAge(e.target.value)} className={inputCls}>
                  <option value="">Livre</option>
                  <option value="14">14+</option>
                  <option value="16">16+</option>
                  <option value="18">18+</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Categoria</label>
                <select value={category} onChange={(e) => setCategory(e.target.value as EventCategory | "")} className={inputCls}>
                  <option value="">Escolha a categoria…</option>
                  {EVENT_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </fieldset>

          <fieldset className="rounded-xl border border-line bg-bg p-4">
            <legend className="px-1 text-[13px] font-extrabold">Local do evento</legend>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Nome do lugar</label>
                <input value={venueName} onChange={(e) => setVenueName(e.target.value)} placeholder="Ex.: Arena BSB" className={inputCls} />
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-3">
                <div>
                  <label className={labelCls}>UF</label>
                  <select
                    value={venueState}
                    onChange={(e) => { setVenueState(e.target.value); setVenueCity(""); }}
                    className={inputCls}
                  >
                    <option value="">—</option>
                    {UF_LIST.map((uf) => (
                      <option key={uf} value={uf}>{uf}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Cidade</label>
                  <input
                    list="venue-city-options-step2"
                    value={venueCity}
                    onChange={(e) => setVenueCity(e.target.value)}
                    placeholder={!venueState ? "Selecione a UF primeiro" : loadingCities ? "Carregando cidades…" : "Digite para buscar"}
                    disabled={!venueState}
                    className={`${inputCls} disabled:opacity-50`}
                  />
                  <datalist id="venue-city-options-step2">
                    {cityOptions.map((city) => (
                      <option key={city} value={city} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div>
                <label className={labelCls}>Endereço</label>
                <input
                  value={venueAddress}
                  onChange={(e) => setVenueAddress(e.target.value)}
                  placeholder="Rua, número e bairro (opcional)"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Link do local (Google Maps)</label>
                <input
                  type="url"
                  value={venueMapsUrl}
                  onChange={(e) => setVenueMapsUrl(e.target.value)}
                  placeholder="https://maps.google.com/... (opcional)"
                  className={inputCls}
                />
              </div>
              <p className="text-[12px] font-semibold text-warning">
                Sem local, seu evento não aparece na busca por cidade.
              </p>
            </div>
          </fieldset>

          <div className="rounded-xl border border-line bg-bg p-4">
            <h3 className="text-[13px] font-extrabold">Itens adicionais (upsell)</h3>
            <p className="mt-1 text-[12px] font-semibold text-muted">
              Itens opcionais que o comprador soma ao ingresso no checkout — ex.: camiseta do evento.
            </p>
            <div className="mt-3 space-y-2">
              {addOns.map((addOn) => (
                <div key={addOn.id} className="flex items-center justify-between gap-2 rounded-lg border border-line-input bg-surface px-3 py-2">
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
                className="rounded-lg border border-line-input bg-surface px-3 py-2 text-sm"
                value={addOnName}
                onChange={(e) => setAddOnName(e.target.value)}
              />
              <input
                placeholder="Preço (R$)"
                className="rounded-lg border border-line-input bg-surface px-3 py-2 text-sm"
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

          {detailsError ? <p className="text-[12px] font-semibold text-danger">{detailsError}</p> : null}

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setStep(1)} className="rounded-xl border-[1.5px] border-line-input px-6 py-2.5 text-[13px] font-bold">Voltar</button>
            <button onClick={saveDetails} disabled={detailsSaving}
              className="rounded-xl border-[1.5px] border-line-input px-6 py-2.5 text-[13px] font-bold disabled:opacity-40">
              {detailsSaving ? "Salvando…" : "Salvar detalhes"}
            </button>
            {detailsSaved && <span className="text-[12px] font-bold text-success">✓ Salvo</span>}
            <button onClick={() => setStep(3)}
              className="rounded-xl bg-primary px-6 py-2.5 text-[13px] font-extrabold text-white">
              Continuar
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[16px] font-extrabold">Revisão e publicação</h2>
          <div className="mt-3 space-y-1.5 rounded-xl bg-bg p-4 text-[13px] font-semibold">
            <p><span className="text-muted">Evento:</span> {title}</p>
            <p><span className="text-muted">Início:</span> {startsAt ? new Date(startsAt).toLocaleString("pt-BR") : "—"}</p>
            <p><span className="text-muted">Ingressos:</span> {lots.length} lote(s)</p>
            <p><span className="text-muted">Banner:</span> {bannerUrl ? "Adicionado" : "Não adicionado"}</p>
            <p><span className="text-muted">Hotsite:</span> <code>{publicUrl}</code></p>
          </div>
          <div className="mt-3 rounded-xl border border-success/30 bg-success/5 p-3 text-[12px] font-bold text-success">
            Ao publicar, a venda começa imediatamente — sem espera de aprovação.
          </div>
          {!bannerUrl && (
            <div className="mt-2 rounded-xl border border-accent/30 bg-accent/5 p-3 text-[12px] font-bold text-accent">
              O evento ainda não tem banner. Você pode publicar assim mesmo e adicionar depois, mas um evento sem
              banner tende a vender menos.
            </div>
          )}

          {published ? (
            <div className="mt-4 space-y-3">
              <p className="text-[14px] font-extrabold text-success">✓ Evento publicado!</p>
              <div className="flex gap-2">
                <a href={publicUrl} target="_blank" className="rounded-xl bg-primary px-5 py-2.5 text-[13px] font-extrabold text-white">Ver hotsite</a>
                <button onClick={() => router.push(`/eventos/${eventId}`)} className="rounded-xl border-[1.5px] border-line-input px-5 py-2.5 text-[13px] font-bold">
                  Ir para o evento
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex gap-2">
              <button onClick={() => setStep(2)} className="rounded-xl border-[1.5px] border-line-input px-6 py-2.5 text-[13px] font-bold">Voltar</button>
              <button onClick={() => router.push(`/eventos/${eventId}`)} className="rounded-xl border-[1.5px] border-line-input px-6 py-2.5 text-[13px] font-bold">
                Salvar rascunho
              </button>
              <button onClick={publish} disabled={busy}
                className="rounded-xl bg-success px-6 py-2.5 text-[13px] font-extrabold text-white shadow-cta-green disabled:opacity-40">
                {busy ? "Publicando…" : "Publicar evento"}
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

export default function NewEventPage() {
  return (
    <AuthGuard>
      <Suspense>
        <NewEventContent />
      </Suspense>
    </AuthGuard>
  );
}
