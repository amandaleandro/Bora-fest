"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
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

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const [pointsList, devicesList] = await Promise.all([
        validatorConfigApi.listCheckinPoints(token, eventId),
        validatorConfigApi.listDevices(token, eventId),
      ]);
      setPoints(pointsList);
      setDevices(devicesList);
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
    await validatorConfigApi.blockDevice(token, eventId, deviceId);
    await load();
  }

  return (
    <main>
      <Nav />
      <h1 className="mt-6 text-xl font-semibold">Portaria e validadores</h1>

      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

      <section className="mt-6">
        <h2 className="text-sm font-medium text-gray-300">Portões</h2>
        <div className="mt-2 flex gap-2">
          <input
            placeholder="Nome do portão (ex.: Portão A)"
            className="flex-1"
            value={pointName}
            onChange={(e) => setPointName(e.target.value)}
          />
          <button
            type="button"
            className="rounded-lg bg-brand px-4 text-sm font-semibold text-brand-dark"
            onClick={handleCreatePoint}
          >
            Adicionar
          </button>
        </div>
        <ul className="mt-3 space-y-1 text-sm text-gray-300">
          {points.map((point) => (
            <li key={point.id}>{point.name}</li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-gray-300">Gerar PIN para a equipe de portaria</h2>
        <div className="mt-2 flex gap-2">
          <input
            placeholder="Rótulo (ex.: Equipe portão A)"
            className="flex-1"
            value={credentialLabel}
            onChange={(e) => setCredentialLabel(e.target.value)}
          />
          <button
            type="button"
            className="rounded-lg bg-brand px-4 text-sm font-semibold text-brand-dark"
            onClick={handleCreateCredential}
          >
            Gerar PIN
          </button>
        </div>
        {generatedPin ? (
          <div className="mt-3 rounded-lg bg-amber-900/40 p-4">
            <p className="text-sm text-amber-200">
              PIN para <strong>{generatedPin.label}</strong> — anote agora, não será mostrado de novo:
            </p>
            <p className="mt-2 text-3xl font-bold tracking-widest">{generatedPin.pin}</p>
          </div>
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-gray-300">Aparelhos registrados</h2>
        {loading ? (
          <p className="mt-2 text-gray-400">Carregando...</p>
        ) : (
          <table className="mt-2">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Status</th>
                <th>Registrado em</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id}>
                  <td>{device.name}</td>
                  <td>{device.status}</td>
                  <td>{new Date(device.registeredAt).toLocaleString("pt-BR")}</td>
                  <td>
                    {device.status === "ACTIVE" ? (
                      <button
                        type="button"
                        className="text-red-400 underline"
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
        )}
        {!loading && devices.length === 0 ? (
          <p className="mt-2 text-gray-500">Nenhum aparelho registrado ainda.</p>
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
