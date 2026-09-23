"use client";

import { useEffect, useState } from "react";
import { api, type FaceEnrollmentStatus } from "../lib/api";
import {
  captureEnrollmentReference,
  isBrowserFaceBridgeAvailable,
} from "../lib/face-provider";

const CONSENT_VERSION = "face-checkin-v1";

export function FaceEnrollmentButton({ ticketId }: { ticketId: string }) {
  const [status, setStatus] = useState<FaceEnrollmentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const token =
    typeof window !== "undefined" ? window.localStorage.getItem("bf.token") : null;

  useEffect(() => {
    if (!token) return;
    api.getFaceEnrollment(ticketId, token).then(setStatus).catch(() => undefined);
  }, [ticketId, token]);

  async function enroll() {
    if (!token || !status?.capabilities.provider || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const providerReference = await captureEnrollmentReference(
        status.capabilities.provider,
        ticketId,
      );
      await api.enrollFace(
        ticketId,
        {
          provider: status.capabilities.provider,
          providerReference,
          consentVersion: CONSENT_VERSION,
          consent: true,
        },
        token,
      );
      const fresh = await api.getFaceEnrollment(ticketId, token);
      setStatus(fresh);
      setMessage("Check-in facial ativado para este ingresso.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível ativar o facial");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!token || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.revokeFaceEnrollment(ticketId, token);
      const fresh = await api.getFaceEnrollment(ticketId, token);
      setStatus(fresh);
      setMessage("Check-in facial removido. Seu QR continua válido.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível remover o facial");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <p className="mt-3 rounded-xl border border-line bg-bg p-3 text-[11px] font-semibold text-muted">
        Entre na sua conta para ativar o check-in facial. O QR continua sendo a forma padrão de entrada.
      </p>
    );
  }

  if (!status) return null;

  if (!status.eventEnabled || !status.capabilities.enabled) {
    return null;
  }

  const bridgeReady = isBrowserFaceBridgeAvailable();

  return (
    <div className="mt-3 rounded-xl border border-line bg-bg p-3 text-left">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11.5px] font-extrabold text-ink">Check-in facial</p>
          <p className="mt-1 text-[10.5px] font-semibold leading-relaxed text-muted">
            Opcional. Confirma somente se o rosto corresponde a este ingresso. QR e busca manual continuam disponíveis.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[9.5px] font-extrabold ${
            status.enrolled ? "bg-success/10 text-success" : "bg-line text-muted"
          }`}
        >
          {status.enrolled ? "ATIVO" : "OPCIONAL"}
        </span>
      </div>

      {status.enrolled ? (
        <button
          type="button"
          disabled={busy}
          onClick={revoke}
          className="mt-3 text-[11px] font-extrabold text-danger disabled:opacity-50"
        >
          {busy ? "Removendo…" : "Remover check-in facial"}
        </button>
      ) : (
        <button
          type="button"
          disabled={busy || !bridgeReady}
          onClick={enroll}
          className="mt-3 rounded-lg bg-primary px-3 py-2 text-[11px] font-extrabold text-white disabled:opacity-50"
        >
          {busy ? "Abrindo câmera…" : bridgeReady ? "Cadastrar meu rosto" : "Facial indisponível neste navegador"}
        </button>
      )}

      {message ? <p className="mt-2 text-[10.5px] font-semibold text-muted">{message}</p> : null}
    </div>
  );
}
