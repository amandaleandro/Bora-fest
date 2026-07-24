"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { dashboardApi, validatorConfigApi, type CheckinLive, type CheckinPoint } from "@/lib/api";

function CheckinLiveContent({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const [live, setLive] = useState<CheckinLive | null>(null);
  const [points, setPoints] = useState<CheckinPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    validatorConfigApi.listCheckinPoints(token, eventId).then(setPoints).catch(() => {});
    const fetchLive = () =>
      dashboardApi
        .checkinLive(token, eventId)
        .then(setLive)
        .catch(() => {})
        .finally(() => setLoading(false));
    fetchLive();
    const id = setInterval(fetchLive, 10_000);
    return () => clearInterval(id);
  }, [token, eventId]);

  const pointName = (id: string | null) => points.find((p) => p.id === id)?.name ?? "Sem portão";

  if (loading || !live) {
    return (
      <main>
        <Nav />
        <p className="mt-6 text-muted">Carregando...</p>
      </main>
    );
  }

  const pct = live.totalTickets ? Math.round((live.checkedIn / live.totalTickets) * 100) : 0;

  return (
    <main>
      <Nav />
      <div className="mt-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-extrabold">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-success" />
            Check-in ao vivo
          </h1>
          <Link href={`/eventos/${eventId}`} className="text-[13px] font-bold text-primary">
            Voltar ao evento →
          </Link>
        </div>
        <p className="text-[12px] font-bold text-muted">
          Atualizado às {new Date(live.generatedAt).toLocaleTimeString("pt-BR")}
        </p>
      </div>

      <section className="mt-5 rounded-2xl border border-line bg-surface p-8 text-center">
        <p className="text-[13px] font-bold text-muted">Presentes no evento</p>
        <p className="mt-2 text-[56px] font-extrabold leading-none">
          {live.checkedIn}
          <span className="text-[24px] font-bold text-muted">/{live.totalTickets}</span>
        </p>
        <div className="mx-auto mt-5 h-3 max-w-lg rounded-full bg-line">
          <div className="h-3 rounded-full bg-success" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-[13px] font-bold text-muted">{pct}% dos ingressos válidos já entraram</p>
        <div className="mt-6 flex justify-center gap-8 text-[13px] font-bold">
          <p>
            <span className="text-[20px] font-extrabold text-primary">+{live.perMinute}</span>
            <br />
            <span className="text-muted">no último minuto</span>
          </p>
          <p>
            <span className="text-[20px] font-extrabold">{live.remaining}</span>
            <br />
            <span className="text-muted">ainda não chegaram</span>
          </p>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-[15px] font-extrabold">Check-ins por portão</h2>
        {live.byCheckinPoint.length === 0 ? (
          <p className="mt-4 text-[13px] font-semibold text-muted">Nenhum check-in registrado ainda.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {live.byCheckinPoint
              .slice()
              .sort((a, b) => b.count - a.count)
              .map((p) => {
                const barPct = live.checkedIn ? Math.round((p.count / live.checkedIn) * 100) : 0;
                return (
                  <div key={p.checkinPointId ?? "sem-portao"}>
                    <div className="flex justify-between text-[12px] font-bold">
                      <span>{pointName(p.checkinPointId)}</span>
                      <span className="text-muted">{p.count} check-ins</span>
                    </div>
                    <div className="mt-1 h-2.5 rounded-full bg-line">
                      <div className="h-2.5 rounded-full bg-primary" style={{ width: `${barPct}%` }} />
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </section>
    </main>
  );
}

export default function CheckinLivePage({ params }: { params: { eventId: string } }) {
  return (
    <AuthGuard>
      <CheckinLiveContent eventId={params.eventId} />
    </AuthGuard>
  );
}
