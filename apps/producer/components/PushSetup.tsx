"use client";

import { useEffect } from "react";

/**
 * Registra o service worker do painel — só em produção e só quando o navegador
 * suporta. Em dev o SW cacheia chunks e atrapalha o hot reload, então lá a
 * gente desregistra qualquer SW antigo (mesmo padrão do checkout).
 *
 * Renderiza null: é só efeito. Montado no <body> do layout, roda uma vez no
 * cliente e não quebra o SSR (o efeito só existe no browser).
 */
export function PushSetup() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    } else {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((reg) => reg.unregister()))
        .catch(() => undefined);
    }
  }, []);

  return null;
}
