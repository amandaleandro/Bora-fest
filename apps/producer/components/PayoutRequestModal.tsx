"use client";

import { useState } from "react";
import { Modal, ghostBtn, modalInput, modalLabel, solidBtn } from "@/components/Modal";
import { payoutsApi, type BankAccount } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "R$ 1.234,56" → 123456 */
function parseCents(masked: string): number {
  const digits = masked.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

export function PayoutRequestModal({
  organizationId,
  availableCents,
  heldCents = 0,
  settlementMode = "STANDARD",
  account,
  onClose,
  onRequested,
}: {
  organizationId: string;
  availableCents: number;
  /** saldo ainda em janela (libera D+2 pós-evento) — antecipável com taxa */
  heldCents?: number;
  settlementMode?: "STANDARD" | "INSTANT";
  account: BankAccount | null;
  onClose: () => void;
  onRequested: () => void;
}) {
  const { token } = useAuth();
  const [amountCents, setAmountCents] = useState(availableCents);
  const [anticipate, setAnticipate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { needsApproval: boolean; feeCents: number }>(null);
  const [error, setError] = useState<string | null>(null);

  const canAnticipate = settlementMode === "STANDARD" && heldCents > 0;
  const maxCents = anticipate ? availableCents + heldCents : availableCents;

  async function confirm() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await payoutsApi.requestPayout(organizationId, amountCents, token, anticipate);
      setDone({ needsApproval: res.needsApproval, feeCents: res.anticipationFeeCents });
      onRequested();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível solicitar o saque");
    } finally {
      setBusy(false);
    }
  }

  const invalid = amountCents < 100 || amountCents > maxCents || !account;

  return (
    <Modal
      title="Solicitar saque"
      subtitle={
        <>
          Saldo disponível: <b className="text-ink">{brl(availableCents)}</b> · repasses ficam disponíveis em D+2
          após o evento.
        </>
      }
      onClose={onClose}
      footer={
        done ? (
          <button type="button" onClick={onClose} className={solidBtn}>
            Fechar
          </button>
        ) : (
          <>
            <button type="button" onClick={onClose} className={ghostBtn}>
              Cancelar
            </button>
            <button type="button" onClick={confirm} disabled={busy || invalid} className={solidBtn}>
              {busy ? "Enviando…" : "Confirmar saque"}
            </button>
          </>
        )
      }
    >
      {done ? (
        <p className="flex items-center gap-2 rounded-xl border border-success/20 bg-success/10 px-4 py-3.5 text-[13px] font-bold text-success">
          {done.needsApproval
            ? `✓ Saque em análise — você recebe assim que a BoraFest aprovar${done.feeCents > 0 ? ` (taxa de antecipação: ${brl(done.feeCents)})` : ""}`
            : "✓ Saque aprovado — o Pix está a caminho da sua conta"}
        </p>
      ) : (
        <>
          <label className={modalLabel} htmlFor="payout-amount">
            Valor do saque
          </label>
          <input
            id="payout-amount"
            inputMode="numeric"
            value={brl(amountCents)}
            onChange={(e) => setAmountCents(Math.min(parseCents(e.target.value), maxCents))}
            className={`${modalInput} text-[18px] font-extrabold`}
          />

          {canAnticipate ? (
            <label className="mt-3.5 flex items-start gap-2.5 rounded-[13px] border-[1.5px] border-line-input px-4 py-3.5 text-[12.5px] font-semibold text-ink-soft">
              <input
                type="checkbox"
                checked={anticipate}
                onChange={(e) => {
                  setAnticipate(e.target.checked);
                  setAmountCents(e.target.checked ? availableCents + heldCents : availableCents);
                }}
                className="mt-0.5 h-4 w-4 accent-[#D9128F]"
              />
              <span>
                Antecipar o saldo ainda em janela ({brl(heldCents)})
                <span className="block text-[11.5px] font-medium text-muted">
                  Tem taxa de antecipação (1,25% a.m. pró-rata, mostrada antes de cair) e passa pela
                  análise da BoraFest.
                </span>
              </span>
            </label>
          ) : null}

          <p className={`${modalLabel} mt-3.5`}>Conta de destino</p>
          {account ? (
            <div className="rounded-[13px] border-[1.5px] border-line-input px-4 py-3.5">
              <p className="text-[13px] font-bold text-ink">
                Banco {account.bankCode} · ag {account.agency} · {account.accountType} {account.account}
              </p>
              <p className="mt-1 text-[11px] font-medium text-muted-2">
                {account.holderName} · {account.holderDocument}
              </p>
            </div>
          ) : (
            <p className="rounded-[13px] border-[1.5px] border-warning/30 bg-warning/5 px-4 py-3.5 text-[12.5px] font-semibold text-warning">
              Cadastre uma conta bancária padrão antes de solicitar o saque.
            </p>
          )}

          <p className="mt-4 rounded-xl border border-line bg-[#faf9fc] px-3.5 py-3 text-[12px] font-medium leading-relaxed text-muted">
            Repasse em D+2 do evento, via Pix e sem tarifa. Cai em até 1 dia útil. Comprovante disponível aqui no
            Financeiro.
          </p>
          {error ? <p className="mt-3 text-[12px] font-semibold text-danger">{error}</p> : null}
        </>
      )}
    </Modal>
  );
}
