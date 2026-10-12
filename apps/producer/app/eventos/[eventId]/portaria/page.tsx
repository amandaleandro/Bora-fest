"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth";
import { validatorConfigApi, type CheckinPoint, type ValidatorDevice } from "@/lib/api";

function PortariaContent({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const [points, setPoints] = useState<CheckinPoint[]>([]);
  const [devices, setDevices] = useState<ValidatorDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [pointName, setPointName] = useState("");
  const [credentialLabel, setCredentialLabel] = useState("");
  const [generatedPin, setGeneratedPin] = useState<{ label: string; pin: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ERRO NÃO VIRA "ZERO" (2026-10-12): a falha ao carregar não tinha catch — a tela
  // ficava sem portões e com "Nenhum aparelho registrado ainda", e o produtor
  // recriava portão que já existia. Agora o erro aparece com "Tentar novamente".
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [pointsList, devicesList] = await Promise.all([
        validatorConfigApi.listCheckinPoints(token, eventId),
        validatorConfigApi.listDevices(token, eventId),
      ]);
      setPoints(pointsList);
      setDevices(devicesList);
    } catch (err) {
      setLoadError(
        err instanceof Error && err.message ? err.message : "Não foi possível carregar os portões e aparelhos",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, eventId]);

  async function handleCreatePoint() {
    if (!token || !pointName) return;
    setError(null);
    try {
      await validatorConfigApi.createCheckinPoint(token, eventId, pointName);
      setPointName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o portão");
    }
  }

  async function handleCreateCredential() {
    if (!token || !credentialLabel) return;
    setError(null);
    try {
      const result = await validatorConfigApi.createCredential(token, eventId, credentialLabel);
      setGeneratedPin({ label: result.label, pin: result.pin });
      setCredentialLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar o PIN");
    }
  }

  async function handleBlockDevice(deviceId: string) {
    if (!token) return;
    setError(null);
    try {
      await validatorConfigApi.blockDevice(token, eventId, deviceId);
      await load();
    } catch (err) {
      // bloquear aparelho falhava em silêncio — o produtor achava que bloqueou (2026-10-12)
      setError(err instanceof Error ? err.message : "Não foi possível bloquear o aparelho");
    }
  }

  return (
    <main>
      <h1 className="mt-2 text-xl font-extrabold">Portaria e validadores</h1>

      {error ? <p className="mt-4 text-sm font-semibold text-danger">{error}</p> : null}
      {loadError ? (
        <div className="mt-4 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-center">
          <p className="text-[13px] font-bold text-danger">
            Não deu para carregar os portões e aparelhos ({loadError}) — confira antes de cadastrar de novo.
          </p>
          <button
            type="button"
            onClick={load}
            className="mt-3 h-10 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta"
          >
            Tentar novamente
          </button>
        </div>
      ) : null}

      <section className="mt-6">
        <h2 className="text-sm font-bold">Portões</h2>
        <div className="mt-2 flex gap-2">
          <input
            placeholder="Nome do portão (ex.: Portão A)"
            className="min-w-0 flex-1"
            value={pointName}
            onChange={(e) => setPointName(e.target.value)}
          />
          <button type="button" className="btn-primary" onClick={handleCreatePoint}>
            Adicionar
          </button>
        </div>
        <ul className="mt-3 space-y-1 text-sm font-semibold">
          {points.map((point) => (
            <li key={point.id}>{point.name}</li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-bold">Gerar PIN para a equipe de portaria</h2>
        <div className="mt-2 flex gap-2">
          <input
            placeholder="Rótulo (ex.: Equipe portão A)"
            className="min-w-0 flex-1"
            value={credentialLabel}
            onChange={(e) => setCredentialLabel(e.target.value)}
          />
          <button type="button" className="btn-primary" onClick={handleCreateCredential}>
            Gerar PIN
          </button>
        </div>
        {generatedPin ? (
          <div className="mt-3 rounded-xl border border-warning/30 bg-warning/10 p-4">
            <p className="text-sm font-semibold text-warning">
              PIN para <strong>{generatedPin.label}</strong> — anote agora, não será mostrado de novo:
            </p>
            <p className="mt-2 text-3xl font-bold tracking-widest">{generatedPin.pin}</p>
          </div>
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-bold">Aparelhos registrados</h2>
        {loading ? (
          <p className="mt-2 text-muted">Carregando...</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[12px] font-bold text-muted">
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Registrado em</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <tr key={device.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 font-semibold">{device.name}</td>
                    <td className="px-4 py-3 text-muted">{device.status}</td>
                    <td className="px-4 py-3 text-muted">{new Date(device.registeredAt).toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-3">
                      {device.status === "ACTIVE" ? (
                        <button
                          type="button"
                          className="font-bold text-danger underline"
                          onClick={() => handleBlockDevice(device.id)}
                        >
                          Bloquear
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !loadError && devices.length === 0 ? (
          <p className="mt-2 text-sm font-semibold text-muted">Nenhum aparelho registrado ainda.</p>
        ) : null}
      </section>
    </main>
  );
}

export default function PortariaPage({ params }: { params: { eventId: string } }) {
  return (
    <AuthGuard>
      <PortariaContent eventId={params.eventId} />
    </AuthGuard>
  );
}
