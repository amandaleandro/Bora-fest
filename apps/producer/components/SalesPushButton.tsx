"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { pushApi, type PushSubscriptionPayload } from "@/lib/api";
import {
  fetchVapidPublicKey,
  ensureServiceWorker,
  isIOS,
  isStandalone,
  pushSupported,
  urlBase64ToUint8Array,
} from "@/lib/push";

type State =
  | "checking" // montando: ainda decidindo o que mostrar
  | "unsupported" // navegador sem Web Push
  | "ios-hint" // iOS Safari fora da tela inicial (push só no PWA instalado)
  | "idle" // pode ativar
  | "working" // pedindo permissão / assinando
  | "enabled" // já inscrito neste aparelho
  | "denied"; // permissão bloqueada pelo usuário

const BellIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
);

function toPayload(sub: PushSubscription): PushSubscriptionPayload | null {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

/**
 * Botão "Ativar notificações de venda". Cuida de:
 *  - navegador sem suporte  → esconde/explica;
 *  - iPhone fora do PWA     → dica "adicione à tela inicial primeiro";
 *  - permissão negada       → orienta a reabrir nas configurações;
 *  - já inscrito            → estado "Ativado" + desativar neste aparelho.
 * Nunca quebra o SSR: toda a detecção roda dentro de useEffect/handlers.
 */
export function SalesPushButton() {
  const { token } = useAuth();
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);

  // Decide o estado inicial no cliente (nada disso existe no servidor).
  useEffect(() => {
    let cancelled = false;

    async function detect() {
      if (!pushSupported()) {
        // iPhone/iPad no Safari só ganham Web Push quando o app está na tela
        // inicial — antes disso PushManager nem existe. Mostra a dica certa.
        if (!cancelled) setState(isIOS() && !isStandalone() ? "ios-hint" : "unsupported");
        return;
      }
      if (isIOS() && !isStandalone()) {
        if (!cancelled) setState("ios-hint");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (!cancelled) setState(sub ? "enabled" : "idle");
      } catch {
        if (!cancelled) setState("idle");
      }
    }

    detect();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setError(null);
    if (!token) {
      setError("Faça login novamente para ativar as notificações.");
      return;
    }
    const vapidKey = await fetchVapidPublicKey();
    if (!vapidKey) {
      setError("Notificações indisponíveis no momento. Tente mais tarde.");
      return;
    }
    setState("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "idle");
        return;
      }

      const reg = await ensureServiceWorker();
      // Reaproveita a inscrição existente; só cria uma nova se não houver.
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          // cast: o TS 5.7+ tipa Uint8Array como <ArrayBufferLike>; em runtime é
          // um BufferSource válido (ArrayBufferView) — que é o que a spec pede.
          applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
        }));

      const payload = toPayload(sub);
      if (!payload) {
        setError("Não consegui ler a inscrição do navegador. Tente de novo.");
        setState("idle");
        return;
      }

      await pushApi.subscribe(token, payload);
      setState("enabled");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível ativar as notificações.");
      setState("idle");
    }
  }, [token]);

  const disable = useCallback(async () => {
    setError(null);
    setState("working");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => undefined);
        if (token) await pushApi.unsubscribe(token, endpoint).catch(() => undefined);
      }
      setState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível desativar.");
      setState("enabled");
    }
  }, [token]);

  // Nada a mostrar em navegador sem suporte de desktop (não é iPhone): evita
  // um card morto. No mobile iOS mostramos a dica, que é acionável.
  if (state === "checking" || state === "unsupported") return null;

  return (
    <div className="rounded-[18px] border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white">
            {BellIcon}
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-extrabold text-ink">Notificações de venda</p>
            <p className="mt-0.5 text-[12px] font-semibold text-muted">
              {state === "enabled"
                ? "Ativado neste aparelho — você recebe um aviso a cada venda paga."
                : state === "ios-hint"
                  ? "No iPhone, toque em Compartilhar e “Adicionar à Tela de Início” para liberar os avisos."
                  : state === "denied"
                    ? "Bloqueado. Reative nas configurações do site (cadeado ao lado do endereço)."
                    : "Receba um aviso na hora em que uma venda for paga."}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {state === "idle" || state === "working" ? (
            <button
              type="button"
              onClick={enable}
              disabled={state === "working"}
              className="h-11 w-full rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta transition-colors hover:bg-primary-hover disabled:opacity-60 sm:w-auto"
            >
              {state === "working" ? "Ativando…" : "Ativar notificações"}
            </button>
          ) : null}

          {state === "enabled" ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-success/10 px-3 py-2 text-[12px] font-extrabold text-success">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Ativado
              </span>
              <button
                type="button"
                onClick={disable}
                className="h-9 rounded-xl border border-line-input px-3 text-[12px] font-bold text-muted transition-colors hover:text-ink"
              >
                Desativar
              </button>
            </>
          ) : null}
        </div>
      </div>

      {error ? <p className="mt-3 text-[12px] font-bold text-danger">{error}</p> : null}
    </div>
  );
}
