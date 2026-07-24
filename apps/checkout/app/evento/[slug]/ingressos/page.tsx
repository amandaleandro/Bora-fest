"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type PublicEvent } from "../../../../lib/api";
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
        <TicketSelector event={event} />
      </div>
    </main>
  );
}
