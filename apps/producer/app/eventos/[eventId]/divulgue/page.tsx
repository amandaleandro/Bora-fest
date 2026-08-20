"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth";
import { dashboardApi, organizationsApi, type Dashboard, type SalesPartner } from "@/lib/api";

const CHECKOUT_URL = process.env.NEXT_PUBLIC_CHECKOUT_URL ?? "http://localhost:3000";

function DivulgueContent({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [partners, setPartners] = useState<SalesPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copiedPartnerId, setCopiedPartnerId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    dashboardApi
      .get(token, eventId)
      .then((data) => {
        setDashboard(data);
        return organizationsApi.listSalesPartners(token, data.event.organizationId);
      })
      .then(setPartners)
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível carregar os dados do evento"))
      .finally(() => setLoading(false));
  }, [token, eventId, attempt]);

  if (error) {
    return (
      <main>
        <div className="mt-6 rounded-2xl border border-danger/30 bg-danger/5 p-6 text-center">
          <p className="text-[13px] font-bold text-danger">{error}</p>
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-3 h-10 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta"
          >
            Tentar novamente
          </button>
        </div>
      </main>
    );
  }

  if (loading || !dashboard) {
    return (
      <main>
          <p className="mt-6 text-muted">Carregando...</p>
      </main>
    );
  }

  const slug = (dashboard.event as { slug?: string }).slug ?? "";
  const link = `${CHECKOUT_URL}/${slug}`;
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

  async function copyPartnerLink(partner: SalesPartner) {
    await navigator.clipboard.writeText(`${link}?p=${partner.slug}`);
    setCopiedPartnerId(partner.id);
    setTimeout(() => setCopiedPartnerId(null), 1500);
  }

  const notPublished = dashboard.event.status !== "PUBLISHED";

  return (
    <main>
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
          <code className="min-w-0 flex-1 break-all rounded-xl bg-bg px-4 py-3 text-[13px]">{link}</code>
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

      {partners.length > 0 ? (
        <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-[15px] font-extrabold">Links de parceiros</h2>
          <p className="mt-1 text-[13px] font-semibold text-muted">
            Cada atlética/parceiro tem seu próprio link — vendas por ele contam a comissão automaticamente.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {partners.map((partner) => (
              <div key={partner.id} className="flex flex-wrap items-center gap-3">
                <span className="w-full text-[13px] font-bold sm:w-32 sm:shrink-0">{partner.name}</span>
                <code className="min-w-0 flex-1 break-all rounded-xl bg-bg px-4 py-3 text-[13px]">
                  {link}?p={partner.slug}
                </code>
                <button
                  type="button"
                  onClick={() => copyPartnerLink(partner)}
                  className="rounded-xl bg-primary px-4 py-3 text-[13px] font-bold text-white"
                >
                  {copiedPartnerId === partner.id ? "Copiado!" : "Copiar link"}
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

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
