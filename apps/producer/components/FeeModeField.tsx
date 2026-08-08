"use client";

import type { FeeMode } from "@/lib/api";

function brl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * "Quem paga pela taxa de serviço?" — toggle BUYER × PRODUCER com a simulação
 * em R$ do lote sendo editado (handoff v2). No modo PRODUCER o comprador paga
 * só o preço e a taxa sai do repasse.
 */
export function FeeModeField({
  value,
  onChange,
  priceCents,
  feeCents,
}: {
  value: FeeMode;
  onChange: (mode: FeeMode) => void;
  priceCents: number;
  feeCents: number;
}) {
  const buyerPaysCents = value === "BUYER" ? priceCents + feeCents : priceCents;
  const producerGetsCents = value === "BUYER" ? priceCents : priceCents - feeCents;

  const options: Array<{ mode: FeeMode; title: string; hint: string }> = [
    { mode: "BUYER", title: "Comprador paga", hint: "Preço final = preço + taxa" },
    { mode: "PRODUCER", title: "Você absorve", hint: "Taxa descontada do repasse" },
  ];

  return (
    <div className="rounded-[18px] border border-line bg-surface p-5">
      <p className="text-[15px] font-extrabold text-ink">Quem paga pela taxa de serviço?</p>
      <p className="mb-4 mt-1.5 text-[13px] font-medium leading-snug text-muted-2">
        Você pode repassar a taxa ao comprador ou absorvê-la no seu repasse.
      </p>

      <div className="flex max-w-[520px] gap-3">
        {options.map((option) => {
          const active = value === option.mode;
          return (
            <button
              key={option.mode}
              type="button"
              onClick={() => onChange(option.mode)}
              aria-pressed={active}
              className={`flex-1 rounded-[13px] border-[1.5px] p-3.5 text-left transition-colors ${
                active ? "border-primary bg-primary text-white" : "border-line-input bg-surface text-ink"
              }`}
            >
              <span className="block text-[14px] font-extrabold">{option.title}</span>
              <span className="mt-1.5 block text-[11px] font-medium leading-snug opacity-75">{option.hint}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3.5 max-w-[520px] rounded-[13px] border border-line bg-[#faf9fc] p-4">
        <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[.04em] text-muted-2">
          Efeito neste lote ({brl(priceCents / 100)} · taxa {brl(feeCents / 100)})
        </p>
        <div className="flex gap-5">
          <div className="flex-1">
            <p className="text-[11.5px] font-medium text-muted-2">Comprador paga</p>
            <p className="mt-1 text-[16px] font-extrabold text-ink">{brl(buyerPaysCents / 100)}</p>
          </div>
          <div className="flex-1">
            <p className="text-[11.5px] font-medium text-muted-2">Você recebe por ingresso</p>
            <p className="mt-1 text-[16px] font-extrabold text-success">{brl(producerGetsCents / 100)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Checkboxes de ingresso nominal / CPF obrigatório (usados junto do FeeModeField). */
export function NominalFields({
  nominal,
  requiresCpf,
  onChange,
}: {
  nominal: boolean;
  requiresCpf: boolean;
  onChange: (next: { nominal: boolean; requiresCpf: boolean }) => void;
}) {
  return (
    <div className="space-y-2.5">
      <label className="flex items-start gap-2.5 text-[13px] font-semibold text-ink">
        <input
          type="checkbox"
          checked={nominal}
          onChange={(e) => onChange({ nominal: e.target.checked, requiresCpf: e.target.checked && requiresCpf })}
          className="mt-0.5 h-4 w-4 accent-[#D9128F]"
        />
        Ingresso nominal — exige nome do participante
      </label>
      <label
        className={`flex items-start gap-2.5 text-[13px] font-semibold ${nominal ? "text-ink" : "text-muted-3"}`}
      >
        <input
          type="checkbox"
          disabled={!nominal}
          checked={requiresCpf}
          onChange={(e) => onChange({ nominal, requiresCpf: e.target.checked })}
          className="mt-0.5 h-4 w-4 accent-[#D9128F]"
        />
        Exigir CPF
      </label>
    </div>
  );
}
