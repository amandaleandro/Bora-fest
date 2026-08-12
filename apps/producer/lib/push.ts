/**
 * Helpers de Web Push do painel. Tudo aqui é seguro no servidor (SSR): as
 * funções só tocam em `window`/`navigator` quando chamadas no cliente, e as de
 * detecção devolvem `false` quando esses globais não existem.
 */

import { API_BASE_URL } from "./config";

/**
 * Chave pública VAPID buscada em RUNTIME do backend (GET /v1/push/vapid-public-key).
 * Fazemos por endpoint em vez de NEXT_PUBLIC_* (build-time) para não depender de
 * build-arg do Next — a chave pública não é segredo. Cacheada após a 1ª busca.
 */
let vapidCache: string | null = null;
export async function fetchVapidPublicKey(): Promise<string> {
  if (vapidCache) return vapidCache;
  try {
    const res = await fetch(`${API_BASE_URL}/v1/push/vapid-public-key`, { cache: "no-store" });
    if (!res.ok) return "";
    const data = (await res.json()) as { publicKey?: string | null };
    vapidCache = data.publicKey ?? "";
    return vapidCache;
  } catch {
    return "";
  }
}

/**
 * Converte a chave VAPID (base64url) no Uint8Array que o pushManager exige.
 * Helper padrão da spec de Web Push.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** O navegador tem tudo que Web Push precisa? (falso no servidor.) */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** iPhone/iPad — inclui iPadOS 13+, que se disfarça de Mac com touch. */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOSClassic = /iPad|iPhone|iPod/.test(ua);
  const iPadOS = navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1;
  return iOSClassic || iPadOS;
}

/** Rodando como PWA "adicionado à tela inicial" (standalone)? */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const displayMode = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
  // Safari iOS não implementa display-mode: usa navigator.standalone.
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return Boolean(displayMode || iosStandalone);
}

/**
 * Garante um service worker ativo e devolve o registration. Em produção o
 * PushSetup já registra no boot; aqui cobrimos o caso de ainda não haver um
 * (ex.: primeiro clique antes do register concluir, ou ambiente de dev).
 */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) {
    await navigator.serviceWorker.ready;
    return existing;
  }
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}
