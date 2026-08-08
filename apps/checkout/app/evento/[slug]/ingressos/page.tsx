"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type PublicEvent } from "../../../../lib/api";
import { formatDateTime } from "../../../../lib/format";
import { Icon, paths } from "../../../../components/icons";
import { TicketSelector } from "../../../../components/TicketSelector";

export default function SelectTicketsPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const router = useRouter();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getPublicEvent(slug).then(setEvent).catch(() => setError("Evento não encontrado"));
  }, [slug]);

  if (!event) {
    return <main className="flex min-h-dvh items-center justify-center text-[13px] text-muted">{error ?? "Carregando…"}</main>;
  }

  return (
    <main className="mx-auto max-w-[430px] pb-16">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-bg/85 px-5 py-4 backdrop-blur">
        <button onClick={() => router.back()} aria-label="Voltar" className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface">
          <Icon d={paths.back} />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-[16px] font-extrabold">Escolha seus ingressos</h1>
          <p className="truncate text-[12px] font-medium text-muted">{event.title}</p>
        </div>
      </header>
      <div className="px-5 pt-4">
        {/* contexto do evento: quem decide quantos comprar não deve perder de
            vista qual festa é, quando e onde */}
        <div className="mb-4 flex items-center gap-3 rounded-[18px] border border-line bg-surface p-3.5">
          {event.bannerUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={event.bannerUrl}
              alt=""
              className="h-14 w-14 shrink-0 rounded-xl object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[#a855f7] text-[20px] font-extrabold text-white">
              {event.title.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-[13px] font-extrabold leading-tight">
              {formatDateTime(event.startsAt, event.timezone)}
            </p>
            <p className="mt-0.5 truncate text-[12px] font-medium text-muted-2">
              {event.venue
                ? `${event.venue.name} · ${event.venue.city}/${event.venue.state}`
                : "Local a confirmar"}
            </p>
          </div>
        </div>
        <TicketSelector event={event} />
      </div>
    </main>
  );
}
