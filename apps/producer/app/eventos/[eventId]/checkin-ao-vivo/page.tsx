"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth";
import { dashboardApi, validatorConfigApi, type CheckinLive, type CheckinPoint } from "@/lib/api";

function CheckinLiveContent({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const [live, setLive] = useState<CheckinLive | null>(null);
  const [points, setPoints] = useState<CheckinPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    validatorConfigApi.listCheckinPoints(token, eventId).then(setPoints).catch(() => {});
    const fetchLive = () =>
      dashboardApi
        .checkinLive(token, eventId)
        .then((data) => {
          setLive(data);
          setError(null);
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível carregar o check-in ao vivo"))
        .finally(() => setLoading(false));
    fetchLive();
    const id = setInterval(fetchLive, 10_000);
    return () => clearInterval(id);
  }, [token, eventId, attempt]);

  const pointName = (id: string | null) => points.find((p) => p.id === id)?.name ?? "Sem portão";

  if (error && !live) {
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

  if (loading || !live) {
    return (
      <main>
          <p className="mt-6 text-muted">Carregando...</p>
      </main>
    );
  }

  const pct = live.totalTickets ? Math.round((live.checkedIn / live.totalTickets) * 100) : 0;

  return (
    <main>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
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

      {error ? (
        <p className="mt-3 text-[12px] font-semibold text-danger">
          Falha ao atualizar ({error}) — mostrando os últimos dados carregados.
        </p>
      ) : null}

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

      <section className="mt-5 rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-[15px] font-extrabold">Curva de entrada</h2>
        <p className="mt-1 text-[12px] font-semibold text-muted">Check-ins confirmados a cada 5 minutos.</p>
        {live.curve.length === 0 ? (
          <p className="mt-4 text-[13px] font-semibold text-muted">Nenhum check-in registrado ainda.</p>
        ) : (
          <div className="mt-4 flex h-32 items-end gap-1 overflow-x-auto">
            {(() => {
              const max = Math.max(...live.curve.map((b) => b.total), 1);
              return live.curve.map((b) => (
                <div key={b.bucketStart} className="flex min-w-[10px] flex-1 flex-col items-center gap-1" title={`${b.total} check-ins às ${new Date(b.bucketStart).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}>
                  <div
                    className="w-full rounded-t bg-primary"
                    style={{ height: `${Math.max((b.total / max) * 100, 4)}%` }}
                  />
                </div>
              ));
            })()}
          </div>
        )}
        {live.curve.length > 0 && (
          <div className="mt-1 flex justify-between text-[11px] font-semibold text-muted">
            <span>{new Date(live.curve[0].bucketStart).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
            <span>{new Date(live.curve[live.curve.length - 1].bucketStart).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
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
