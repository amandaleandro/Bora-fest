"use client";

import { useEffect } from "react";
import type { PixelSettings } from "../lib/api";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    gtag?: (...args: unknown[]) => void;
    ttq?: { track: (...args: unknown[]) => void; load: (id: string) => void; page: () => void };
    dataLayer?: unknown[];
  }
}

/** IDs de pixel vão para dentro de script.innerHTML como string JS — validar o formato
 * antes de interpolar evita que um ID malformado (ou salvo antes da validação existir
 * no backend) quebre pra fora da string e execute JS arbitrário na página pública. */
const SAFE_PIXEL_ID = /^[A-Za-z0-9_-]{1,64}$/;

function injectOnce(id: string, create: () => HTMLElement) {
  if (document.getElementById(id)) return;
  document.head.appendChild(create());
}

function loadMetaPixel(pixelId: string) {
  if (window.fbq) return;
  injectOnce("bf-meta-pixel", () => {
    const script = document.createElement("script");
    script.id = "bf-meta-pixel";
    script.innerHTML = `
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
      n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
      document,'script','https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', '${pixelId}');
    `;
    return script;
  });
}

function loadGa4(measurementId: string) {
  if (window.gtag) return;
  injectOnce("bf-ga4-lib", () => {
    const script = document.createElement("script");
    script.id = "bf-ga4-lib";
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    return script;
  });
  injectOnce("bf-ga4-init", () => {
    const script = document.createElement("script");
    script.id = "bf-ga4-init";
    script.innerHTML = `
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      window.gtag = gtag;
      gtag('js', new Date());
      gtag('config', '${measurementId}');
    `;
    return script;
  });
}

function loadTiktokPixel(pixelId: string) {
  if (window.ttq) return;
  injectOnce("bf-tiktok-pixel", () => {
    const script = document.createElement("script");
    script.id = "bf-tiktok-pixel";
    script.innerHTML = `
      !function (w, d, t) {
        w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
        ttq.load('${pixelId}');
        ttq.page();
      }(window, document, 'ttq');
    `;
    return script;
  });
}

/**
 * Injeta os pixels configurados pelo produtor (painel > evento > Pixels de
 * conversão) e dispara PageView na primeira renderização. Quando `purchase`
 * é passado, dispara o evento de compra uma única vez por pedido (dedupe via
 * sessionStorage, já que a página de confirmação recarrega em polling).
 */
export function PixelTracker({
  pixelSettings,
  purchase,
}: {
  pixelSettings: PixelSettings | null | undefined;
  purchase?: { orderId: string; valueCents: number };
}) {
  useEffect(() => {
    if (!pixelSettings) return;
    if (pixelSettings.metaPixelId && SAFE_PIXEL_ID.test(pixelSettings.metaPixelId)) {
      loadMetaPixel(pixelSettings.metaPixelId);
      window.fbq?.("track", "PageView");
    }
    if (pixelSettings.ga4MeasurementId && SAFE_PIXEL_ID.test(pixelSettings.ga4MeasurementId)) {
      loadGa4(pixelSettings.ga4MeasurementId);
    }
    if (pixelSettings.tiktokPixelId && SAFE_PIXEL_ID.test(pixelSettings.tiktokPixelId)) {
      loadTiktokPixel(pixelSettings.tiktokPixelId);
    }
  }, [pixelSettings]);

  useEffect(() => {
    if (!pixelSettings || !purchase) return;
    const dedupeKey = `bf.pixel.purchased.${purchase.orderId}`;
    if (sessionStorage.getItem(dedupeKey)) return;

    const value = purchase.valueCents / 100;
    if (pixelSettings.metaPixelId && SAFE_PIXEL_ID.test(pixelSettings.metaPixelId)) {
      window.fbq?.("track", "Purchase", { value, currency: "BRL" });
    }
    if (pixelSettings.ga4MeasurementId && SAFE_PIXEL_ID.test(pixelSettings.ga4MeasurementId)) {
      window.gtag?.("event", "purchase", { transaction_id: purchase.orderId, value, currency: "BRL" });
    }
    if (pixelSettings.tiktokPixelId && SAFE_PIXEL_ID.test(pixelSettings.tiktokPixelId)) {
      window.ttq?.track("CompletePayment", { value, currency: "BRL" });
    }
    sessionStorage.setItem(dedupeKey, "1");
  }, [pixelSettings, purchase]);

  return null;
}
