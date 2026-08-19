"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { API_BASE_URL } from "@/lib/config";

type Banners = { desktopUrl: string | null; mobileUrl: string | null };

const SLOTS: Array<{ slot: "desktop" | "mobile"; titulo: string; dica: string }> = [
  { slot: "desktop", titulo: "Banner desktop", dica: "Faixa larga — recomendado 1600×420 (JPG, PNG ou WebP, até 5MB)" },
  { slot: "mobile", titulo: "Banner mobile", dica: "Formato de post — recomendado 1080×1080 ou 1080×1350 (até 5MB)" },
];

/**
 * Banner de divulgação da home do site (2026-08-17): o Arthur troca a arte
 * quando quiser — uma pro desktop, outra pro mobile. Sem arte no slot, o site
 * usa o banner padrão da marca.
 */
function BannersContent() {
  const { token } = useAuth();
  const [banners, setBanners] = useState<Banners | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(() => {
    fetch(`${API_BASE_URL}/v1/public/banners`)
      .then((r) => r.json())
      .then(setBanners)
      .catch(() => setBanners({ desktopUrl: null, mobileUrl: null }));
  }, []);

  useEffect(load, [load]);

  async function enviar(slot: string, file: File) {
    if (!token) return;
    setBusy(slot);
    setMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const resp = await fetch(`${API_BASE_URL}/v1/admin/banners/${slot}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!resp.ok) throw new Error(String(resp.status));
      setBanners(await resp.json());
      setMsg(`Banner ${slot} atualizado ✓ — já está no ar no site.`);
    } catch {
      setMsg(`Falha ao enviar o banner ${slot} — confira o formato (JPG/PNG/WebP, até 5MB).`);
    } finally {
      setBusy(null);
    }
  }

  async function remover(slot: string) {
    if (!token) return;
    setBusy(slot);
    setMsg(null);
    try {
      const resp = await fetch(`${API_BASE_URL}/v1/admin/banners/${slot}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error(String(resp.status));
      setBanners(await resp.json());
      setMsg(`Banner ${slot} removido — o site voltou pro banner padrão da marca.`);
    } catch {
      setMsg(`Falha ao remover o banner ${slot}.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16">
      <Nav />
      <h1 className="text-xl font-extrabold text-white">Banners do site</h1>
      <p className="mt-1 text-sm text-slate-400">
        A faixa &quot;Produza seu evento&quot; da home. Anexe uma arte pro desktop e outra pro mobile —
        sem arte, o site mostra o banner padrão da marca.
      </p>

      {msg && (
        <p className={`mt-4 rounded-xl border px-4 py-3 text-sm font-semibold ${msg.includes("Falha") ? "border-rose-500/30 bg-rose-500/10 text-rose-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"}`}>
          {msg}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {SLOTS.map(({ slot, titulo, dica }) => {
          const url = banners ? (slot === "desktop" ? banners.desktopUrl : banners.mobileUrl) : null;
          return (
            <section key={slot} className="rounded-2xl border border-white/10 bg-slate-900/50 p-5">
              <h2 className="text-base font-extrabold text-white">{titulo}</h2>
              <p className="mt-0.5 text-xs text-slate-400">{dica}</p>

              <div className="mt-4 overflow-hidden rounded-xl border border-slate-700/60 bg-slate-950/60">
                {banners === null ? (
                  <p className="p-6 text-center text-sm text-slate-500">Carregando…</p>
                ) : url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="" className="h-auto w-full" />
                ) : (
                  <p className="p-6 text-center text-sm text-slate-500">
                    Sem arte anexada — o site está usando o banner padrão.
                  </p>
                )}
              </div>

              <input
                ref={(el) => { inputs.current[slot] = el; }}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) enviar(slot, file);
                  e.target.value = "";
                }}
              />
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={busy === slot}
                  onClick={() => inputs.current[slot]?.click()}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {busy === slot ? "Enviando…" : url ? "Trocar arte" : "Anexar arte"}
                </button>
                {url && (
                  <button
                    type="button"
                    disabled={busy === slot}
                    onClick={() => remover(slot)}
                    className="rounded-lg border border-rose-500/30 px-4 py-2 text-sm font-bold text-rose-400 disabled:opacity-50"
                  >
                    Remover
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}

export default function BannersPage() {
  return (
    <AuthGuard>
      <BannersContent />
    </AuthGuard>
  );
}
