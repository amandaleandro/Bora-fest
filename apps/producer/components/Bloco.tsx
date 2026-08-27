"use client";

import { useState } from "react";

/**
 * Seção recolhível do painel (2026-08-26). A tela de gerenciar evento
 * empilhava 10 assuntos abertos ao mesmo tempo — o produtor abria e via um
 * paredão. Agora cada assunto é um bloco com título que explica o que faz;
 * o que ele usa toda hora nasce aberto, o que é raro nasce fechado.
 */
export function Bloco({
  titulo,
  descricao,
  aberto = false,
  children,
}: {
  titulo: string;
  descricao?: string;
  aberto?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(aberto);
  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-5 text-left transition-colors hover:bg-bg"
      >
        <span className="min-w-0">
          <span className="block text-[16px] font-extrabold text-ink">{titulo}</span>
          {descricao && (
            <span className="mt-0.5 block text-[12.5px] font-semibold text-muted">{descricao}</span>
          )}
        </span>
        <span
          aria-hidden
          className={`shrink-0 text-[18px] font-extrabold text-muted-2 transition-transform ${open ? "rotate-45" : ""}`}
        >
          +
        </span>
      </button>
      {open && <div className="border-t border-line px-5 pb-5 pt-4">{children}</div>}
    </section>
  );
}
