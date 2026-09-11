"use client";

import { useCallback, useEffect, useState } from "react";
import { GuardedPanelShell } from "@/components/PanelShell";
import { useAuth } from "@/lib/auth";
import { API_BASE_URL, CHECKOUT_URL } from "@/lib/config";

interface PublicProfile {
  id: string;
  name: string;
  displayName: string | null;
  slug: string;
  producerType: string | null;
  bio: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  instagramUrl: string | null;
  websiteUrl: string | null;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new Error(data?.message ?? "Não foi possível concluir a operação");
  return data as T;
}

function ImageUploadCard({
  title,
  help,
  imageUrl,
  kind,
  busy,
  onUpload,
}: {
  title: string;
  help: string;
  imageUrl: string | null;
  kind: "logo" | "cover";
  busy: boolean;
  onUpload: (kind: "logo" | "cover", file: File) => Promise<void>;
}) {
  return (
    <div className="rounded-[18px] border border-line bg-surface p-4">
      <div className={`relative overflow-hidden bg-bg ${kind === "logo" ? "h-40 rounded-2xl" : "h-40 rounded-2xl"}`}>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- preview de upload da API
          <img src={imageUrl} alt={title} className={`h-full w-full ${kind === "logo" ? "object-contain p-4" : "object-cover"}`} />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-[12px] font-bold text-muted">
            Nenhuma imagem cadastrada
          </div>
        )}
      </div>
      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-[14px] font-extrabold text-ink">{title}</p>
          <p className="mt-1 text-[11px] font-semibold leading-relaxed text-muted">{help}</p>
        </div>
        <label className="inline-flex h-10 shrink-0 cursor-pointer items-center rounded-xl border border-primary px-3.5 text-[12px] font-extrabold text-primary transition hover:bg-primary/5">
          {busy ? "Enviando…" : imageUrl ? "Trocar" : "Enviar"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void onUpload(kind, file);
            }}
          />
        </label>
      </div>
    </div>
  );
}

function ProfileEditor({ orgId }: { orgId: string }) {
  const { token } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "cover" | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyProfile = useCallback((data: PublicProfile) => {
    setProfile(data);
    setDisplayName(data.displayName ?? "");
    setBio(data.bio ?? "");
    setInstagramUrl(data.instagramUrl ?? "");
    setWebsiteUrl(data.websiteUrl ?? "");
  }, []);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch(`${API_BASE_URL}/v1/organizations/${orgId}/public-profile`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then((response) => parseResponse<PublicProfile>(response))
      .then(applyProfile)
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível carregar o perfil"))
      .finally(() => setLoading(false));
  }, [token, orgId, applyProfile]);

  async function save() {
    if (!token || saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/v1/organizations/${orgId}/public-profile`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          displayName: displayName.trim() || null,
          bio: bio.trim() || null,
          instagramUrl: instagramUrl.trim() || null,
          websiteUrl: websiteUrl.trim() || null,
        }),
      });
      const updated = await parseResponse<PublicProfile>(response);
      applyProfile(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o perfil");
    } finally {
      setSaving(false);
    }
  }

  async function upload(kind: "logo" | "cover", file: File) {
    if (!token || uploading) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("A imagem deve ter no máximo 5 MB");
      return;
    }
    setUploading(kind);
    setSaved(false);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${API_BASE_URL}/v1/organizations/${orgId}/public-profile/image/${kind}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const updated = await parseResponse<PublicProfile>(response);
      applyProfile(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar a imagem");
    } finally {
      setUploading(null);
    }
  }

  if (loading) return <p className="text-[13px] font-semibold text-muted">Carregando perfil…</p>;
  if (!profile) {
    return (
      <div className="rounded-[18px] border border-danger/30 bg-danger/5 p-6 text-[13px] font-bold text-danger">
        {error ?? "Não foi possível carregar o perfil público."}
      </div>
    );
  }

  const publicUrl = `${CHECKOUT_URL}/casa/${profile.slug}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-[18px] border border-primary/20 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[15px] font-extrabold text-ink">Sua Casa tem uma página permanente</p>
          <p className="mt-1 text-[12px] font-semibold text-muted">
            Eventos entram e saem da agenda, mas este endereço continua sendo o perfil oficial da sua marca na BoraFest.
          </p>
        </div>
        <a
          href={publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-primary px-4 text-[12px] font-extrabold text-white shadow-cta"
        >
          Ver perfil público ↗
        </a>
      </div>

      <section>
        <div className="mb-3">
          <p className="text-[12px] font-extrabold uppercase tracking-[.06em] text-muted-2">Identidade visual</p>
          <h2 className="mt-1 text-[18px] font-extrabold text-ink">Logo e capa</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <ImageUploadCard
            title="Logo da Casa"
            help="JPG, PNG ou WebP. A BoraFest normaliza para 800 × 800 px."
            imageUrl={profile.logoUrl}
            kind="logo"
            busy={uploading === "logo"}
            onUpload={upload}
          />
          <ImageUploadCard
            title="Capa do perfil"
            help="JPG, PNG ou WebP. A BoraFest normaliza para 1600 × 900 px."
            imageUrl={profile.coverUrl}
            kind="cover"
            busy={uploading === "cover"}
            onUpload={upload}
          />
        </div>
      </section>

      <section className="rounded-[18px] border border-line bg-surface p-5">
        <div>
          <p className="text-[12px] font-extrabold uppercase tracking-[.06em] text-muted-2">Informações públicas</p>
          <h2 className="mt-1 text-[18px] font-extrabold text-ink">Como sua Casa aparece</h2>
          <p className="mt-1 text-[12px] font-semibold text-muted">
            O nome cadastral continua protegido no administrativo; o público vê o nome comercial abaixo.
          </p>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className="text-[12px] font-bold text-ink-soft">Nome comercial</span>
            <input
              className="mt-1.5 h-11 w-full rounded-xl border border-line-input bg-bg px-3 text-[13px] text-ink outline-none focus:border-primary"
              maxLength={80}
              placeholder={profile.name}
              value={displayName}
              onChange={(event) => { setDisplayName(event.target.value); setSaved(false); }}
            />
          </label>

          <label className="block md:col-span-2">
            <span className="flex items-center justify-between gap-3 text-[12px] font-bold text-ink-soft">
              <span>Bio</span>
              <span className="font-semibold text-muted">{bio.length}/500</span>
            </span>
            <textarea
              className="mt-1.5 min-h-[130px] w-full resize-y rounded-xl border border-line-input bg-bg px-3 py-3 text-[13px] leading-relaxed text-ink outline-none focus:border-primary"
              maxLength={500}
              placeholder="Conte em poucas linhas o que torna sua Casa, atlética ou produtora especial."
              value={bio}
              onChange={(event) => { setBio(event.target.value); setSaved(false); }}
            />
          </label>

          <label className="block">
            <span className="text-[12px] font-bold text-ink-soft">Instagram</span>
            <input
              type="url"
              className="mt-1.5 h-11 w-full rounded-xl border border-line-input bg-bg px-3 text-[13px] text-ink outline-none focus:border-primary"
              placeholder="https://instagram.com/suacasa"
              value={instagramUrl}
              onChange={(event) => { setInstagramUrl(event.target.value); setSaved(false); }}
            />
          </label>

          <label className="block">
            <span className="text-[12px] font-bold text-ink-soft">Site oficial</span>
            <input
              type="url"
              className="mt-1.5 h-11 w-full rounded-xl border border-line-input bg-bg px-3 text-[13px] text-ink outline-none focus:border-primary"
              placeholder="https://suacasa.com.br"
              value={websiteUrl}
              onChange={(event) => { setWebsiteUrl(event.target.value); setSaved(false); }}
            />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <div>
            {saved ? <p className="text-[12px] font-bold text-success">Perfil atualizado.</p> : null}
            {error ? <p className="text-[12px] font-bold text-danger">{error}</p> : null}
          </div>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="h-11 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar perfil"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function PublicProfilePage({ params }: { params: { orgId: string } }) {
  return (
    <GuardedPanelShell title="Perfil público" organizationId={params.orgId}>
      <ProfileEditor orgId={params.orgId} />
    </GuardedPanelShell>
  );
}
