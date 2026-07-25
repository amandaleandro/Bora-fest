// Service worker da v1: instalável + offline real do app shell.
//
// Estratégia por tipo de requisição:
// - assets versionados do Next e ícones → cache-first (a URL muda a cada build);
// - navegações → rede primeiro, cache como rede de segurança e, por último,
//   /portaria (se a rota for da portaria) ou /offline.
// A portaria PRECISA abrir sem rede: é o requisito que define a superfície.
const VERSION = "borafest-v3";
const SHELL = ["/", "/portaria", "/offline", "/manifest.json", "/portaria.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => undefined)));
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

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/icons/")) {
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
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy));
          return res;
        })
        .catch(
          async () =>
            (await caches.match(request)) ??
            (await caches.match(url.pathname.startsWith("/portaria") ? "/portaria" : "/offline")) ??
            Response.error(),
        ),
    );
  }
});
