// Service worker do PAINEL DO PRODUTOR: instalável (PWA) + Web Push de vendas.
//
// O painel é dinâmico e todo autenticado, então — ao contrário do checkout —
// NÃO cacheamos navegações (evita servir uma página logada/vencida). Só os
// assets versionados do Next e os ícones entram em cache (a URL muda a cada
// build), o suficiente para o app "adicionar à tela inicial" abrir rápido.
// O foco aqui é o push: avisar a casa/promoter a cada venda.
const VERSION = "borafest-painel-v1";
const ASSET_PREFIXES = ["/_next/static", "/icons/"];

self.addEventListener("install", (event) => {
  // Sobe já — o painel quer a versão nova sem esperar todas as abas fecharem.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// Cache-first só para assets imutáveis. Sem handler de navegação de propósito:
// cada request de página vai à rede (conteúdo autenticado não pode ficar preso
// em cache). Um fetch handler leve também reforça a instalabilidade do PWA.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (!ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy));
          return res;
        }),
    ),
  );
});

// --- Web Push: uma venda entrou → notifica a casa/promoter. -----------------
// Payload esperado do backend: { title: string, body: string, url?: string }.
// Qualquer coisa fora disso cai no fallback (nunca deixar de notificar).
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_e) {
    // payload não-JSON (ou vazio): usa o texto cru como corpo, se houver.
    payload = { body: event.data && event.data.text ? event.data.text() : "" };
  }

  const title = payload.title || "BoraFest — nova venda";
  const url = payload.url || "/";
  const options = {
    body: payload.body || "Você tem uma nova venda no painel.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url },
    // tag ÚNICA por venda: sem isto as vendas se substituíam (só a última
    // aparecia). Cada venda é uma comemoração — devem empilhar.
    tag: "borafest-venda-" + (payload.id || Date.now() + "-" + Math.random().toString(36).slice(2, 7)),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Clique na notificação: foca uma janela já aberta do painel ou abre uma nova.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        // Já existe uma aba do painel: foca (e navega, se o navegador deixar).
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client && targetUrl !== "/") client.navigate(targetUrl).catch(() => undefined);
          return undefined;
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(targetUrl) : undefined;
    }),
  );
});
