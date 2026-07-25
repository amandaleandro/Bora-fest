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
  account,
  onClose,
  onRequested,
}: {
  organizationId: string;
  availableCents: number;
  account: BankAccount | null;
  onClose: () => void;
  onRequested: () => void;
}) {
  const { token } = useAuth();
  const [amountCents, setAmountCents] = useState(availableCents);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await payoutsApi.requestPayout(organizationId, amountCents, token);
      setDone(true);
      onRequested();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível solicitar o saque");
    } finally {
      setBusy(false);
    }
  }

  const invalid = amountCents < 100 || amountCents > availableCents || !account;

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
          ✓ Saque solicitado — cai em até 1 dia útil
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
            onChange={(e) => setAmountCents(Math.min(parseCents(e.target.value), availableCents))}
            className={`${modalInput} text-[18px] font-extrabold`}
          />

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
