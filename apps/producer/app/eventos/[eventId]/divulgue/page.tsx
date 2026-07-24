"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { dashboardApi, type Dashboard } from "@/lib/api";

const CHECKOUT_URL = process.env.NEXT_PUBLIC_CHECKOUT_URL ?? "http://localhost:3000";

function DivulgueContent({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    dashboardApi.get(token, eventId).then(setDashboard).finally(() => setLoading(false));
  }, [token, eventId]);

  if (loading || !dashboard) {
    return (
      <main>
        <Nav />
        <p className="mt-6 text-muted">Carregando...</p>
      </main>
    );
  }

  const slug = (dashboard.event as { slug?: string }).slug ?? "";
  const link = `${CHECKOUT_URL}/evento/${slug}`;
  const shareText = `Vem pro ${dashboard.event.title}! Garanta seu ingresso: ${link}`;

  async function copyLink() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function copyShareText() {
    await navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const notPublished = dashboard.event.status !== "PUBLISHED";

  return (
    <main>
      <Nav />
      <div className="mt-6 flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-extrabold">Divulgue</h1>
          <Link href={`/eventos/${eventId}`} className="text-[13px] font-bold text-primary">
            Voltar ao evento →
          </Link>
        </div>
      </div>

      {notPublished ? (
        <div className="mt-5 rounded-2xl border border-line bg-warning/10 p-4 text-[13px] font-semibold text-warning">
          O evento ainda não está publicado — o link só funciona para o público depois de publicar em
          &quot;{dashboard.event.title}&quot;.
        </div>
      ) : null}

      <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-[15px] font-extrabold">Link do evento</h2>
        <p className="mt-1 text-[13px] font-semibold text-muted">
          Compartilhe este link nas suas redes — ele leva direto para a página de compra.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <code className="flex-1 rounded-xl bg-bg px-4 py-3 text-[13px]">{link}</code>
          <button
            type="button"
            onClick={copyLink}
            className="rounded-xl bg-primary px-4 py-3 text-[13px] font-bold text-white"
          >
            {copied ? "Copiado!" : "Copiar link"}
          </button>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-[15px] font-extrabold">Texto para compartilhar</h2>
        <p className="mt-3 rounded-xl bg-bg p-4 text-[13px] font-semibold">{shareText}</p>
        <button
          type="button"
          onClick={copyShareText}
          className="mt-3 rounded-xl border border-line-input px-4 py-2.5 text-[13px] font-bold"
        >
          {copied ? "Copiado!" : "Copiar texto"}
        </button>
      </section>

      <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-[15px] font-extrabold">Redes sociais</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl bg-success px-4 py-2.5 text-[13px] font-bold text-white"
          >
            WhatsApp
          </a>
          <a
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-line-input px-4 py-2.5 text-[13px] font-bold"
          >
            X (Twitter)
          </a>
          <a
            href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-line-input px-4 py-2.5 text-[13px] font-bold"
          >
            Facebook
          </a>
        </div>
      </section>
    </main>
  );
}

export default function DivulguePage({ params }: { params: { eventId: string } }) {
  return (
    <AuthGuard>
      <DivulgueContent eventId={params.eventId} />
    </AuthGuard>
  );
}
