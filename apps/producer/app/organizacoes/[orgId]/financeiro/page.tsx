"use client";

import { useEffect, useState } from "react";
import { GuardedPanelShell } from "@/components/PanelShell";
import { PayoutRequestModal } from "@/components/PayoutRequestModal";
import { useAuth } from "@/lib/auth";
import {
  financeApi,
  payoutsApi,
  bankAccountsApi,
  type Balance,
  type BankAccount,
  type LedgerEntry,
  type Payout,
  type PayoutRequest,
} from "@/lib/api";

const BANKS = [
  ["001", "Banco do Brasil"], ["104", "Caixa"], ["237", "Bradesco"], ["341", "Itaú"],
  ["033", "Santander"], ["260", "Nubank"], ["077", "Inter"], ["336", "C6 Bank"],
] as const;

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

const LEDGER_LABELS: Record<string, string> = {
  SALE_CREDIT: "Venda",
  PLATFORM_FEE: "Comissão BoraFest",
  REFUND_DEBIT: "Reembolso",
  PAYOUT_DEBIT: "Repasse",
};

const STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  PENDING: { bg: "bg-warning/10", fg: "text-warning", label: "Em análise" },
  APPROVED: { bg: "bg-primary/10", fg: "text-primary", label: "Aprovado" },
  REJECTED: { bg: "bg-danger/10", fg: "text-danger", label: "Recusado" },
  PAID: { bg: "bg-success/10", fg: "text-success", label: "Pago" },
};

const inputCls =
  "h-[46px] w-full rounded-xl border-[1.5px] border-line-input bg-surface px-3.5 text-[14px] font-medium outline-none focus:border-primary";
const labelCls = "mb-1 block text-[12px] font-bold text-ink-soft";

function StatusChip({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? { bg: "bg-line", fg: "text-muted", label: status };
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${s.bg} ${s.fg}`}>{s.label}</span>;
}

function FinanceContent({ orgId }: { orgId: string }) {
  const { token } = useAuth();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWithdraw, setShowWithdraw] = useState(false);

  const [showAccountForm, setShowAccountForm] = useState(false);
  const [bankCode, setBankCode] = useState("341");
  const [agency, setAgency] = useState("");
  const [account, setAccount] = useState("");
  const [accountType, setAccountType] = useState<"corrente" | "poupanca">("corrente");
  const [holderName, setHolderName] = useState("");
  const [holderDocument, setHolderDocument] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);

  async function load() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [b, e, p, a] = await Promise.all([
        financeApi.getBalance(token, orgId),
        financeApi.getLedger(token, orgId),
        payoutsApi.list(orgId, token),
        bankAccountsApi.list(orgId, token),
      ]);
      setBalance(b);
      setEntries(e);
      setPayouts(p);
      setAccounts(a);
      // rota nova: se ainda não estiver publicada, o resto da tela continua de pé
      setRequests(await payoutsApi.listRequests(orgId, token).catch(() => []));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar o financeiro");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, orgId]);

  async function addBankAccount() {
    if (!token) return;
    setError(null);
    const cleanDocument = holderDocument.replace(/\D/g, "");
    if (!bankCode || !agency || !account || holderName.trim().length < 2 || cleanDocument.length < 11) {
      setError("Preencha banco, agência, conta, titular e CPF/CNPJ do titular");
      return;
    }
    setSavingAccount(true);
    try {
      // holderDocument e accountType são obrigatórios no createBankAccountSchema
      await bankAccountsApi.add(
        orgId,
        {
          holderName,
          holderDocument: cleanDocument,
          bankCode,
          agency,
          account,
          accountType,
          pixKey: pixKey || undefined,
        },
        token,
      );
      setAgency("");
      setAccount("");
      setHolderName("");
      setHolderDocument("");
      setPixKey("");
      setShowAccountForm(false);
      setAccounts(await bankAccountsApi.list(orgId, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar a conta bancária");
    } finally {
      setSavingAccount(false);
    }
  }

  const defaultAccount = accounts.find((acc) => acc.isDefault) ?? accounts[0] ?? null;
  const pendingCents = requests
    .filter((r) => r.status === "PENDING")
    .reduce((sum, r) => sum + r.amountCents, 0);
  const withdrawableCents = Math.max((balance?.availableForPayoutCents ?? 0) - pendingCents, 0);
  const lastRequest = requests[0] ?? null;

  return (
    <>
      {error ? <p className="mb-4 text-[13px] font-semibold text-danger">{error}</p> : null}

      {loading ? (
        <p className="text-[13px] font-semibold text-muted">Carregando…</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-[18px] border border-line bg-surface p-5">
              <p className="text-[12px] font-bold text-muted">Saldo</p>
              <p className="mt-1 text-[22px] font-extrabold">{formatCents(balance?.balanceCents ?? 0)}</p>
            </div>
            <div className="rounded-[18px] border border-line bg-surface p-5">
              <p className="text-[12px] font-bold text-muted">Disponível para saque</p>
              <p className="mt-1 text-[22px] font-extrabold text-success">{formatCents(withdrawableCents)}</p>
              {pendingCents > 0 ? (
                <p className="mt-1 text-[11.5px] font-semibold text-warning">
                  {formatCents(pendingCents)} já solicitados
                </p>
              ) : null}
              {balance?.settlementMode === "INSTANT" ? (
                <p className="mt-1 text-[11.5px] font-semibold text-brand">
                  Repasse instantâneo ativo
                  {(balance?.anticipationFeeCents ?? 0) > 0
                    ? ` · antecipação estimada ${formatCents(balance?.anticipationFeeCents ?? 0)}`
                    : ""}
                </p>
              ) : (balance?.heldCents ?? 0) > 0 ? (
                <p className="mt-1 text-[11.5px] font-semibold text-muted">
                  {formatCents(balance?.heldCents ?? 0)} liberam após a janela de reembolso (7 dias da
                  venda)
                </p>
              ) : null}
            </div>
            <div className="rounded-[18px] border border-line bg-surface p-5">
              <p className="text-[12px] font-bold text-muted">Repasse</p>
              <p className="mt-1 text-[13px] font-semibold leading-snug text-ink-soft">
                D+2 do evento, via Pix e sem tarifa.
              </p>
              <button
                type="button"
                onClick={() => setShowWithdraw(true)}
                disabled={withdrawableCents < 100}
                className="mt-3 h-11 w-full rounded-xl bg-primary text-[13px] font-extrabold text-white shadow-cta disabled:bg-[#ecd6e4] disabled:shadow-none"
              >
                Solicitar saque
              </button>
              {lastRequest?.status === "PENDING" ? (
                <p className="mt-2.5 flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2.5 text-[12px] font-bold text-success">
                  ✓ Saque solicitado — cai em até 1 dia útil
                </p>
              ) : null}
            </div>
          </div>

          {/* Solicitações de saque */}
          <section className="mt-5 rounded-[18px] border border-line bg-surface p-5">
            <h2 className="text-[15px] font-extrabold">Solicitações de saque</h2>
            {requests.length === 0 ? (
              <p className="mt-3 text-[13px] font-semibold text-muted">Nenhuma solicitação ainda.</p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[520px] text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-bg/60 text-[11px] font-bold uppercase tracking-[.04em] text-muted-2">
                      <th className="px-4 py-2.5">Valor</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">Solicitado em</th>
                      <th className="px-4 py-2.5">Resolvido em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((req) => (
                      <tr key={req.id} className="border-b border-line-divider last:border-0">
                        <td className="px-4 py-2.5 font-bold">{formatCents(req.amountCents)}</td>
                        <td className="px-4 py-2.5"><StatusChip status={req.status} /></td>
                        <td className="px-4 py-2.5 text-muted">{formatDate(req.createdAt)}</td>
                        <td className="px-4 py-2.5 text-muted">{formatDate(req.resolvedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Repasses efetivados */}
          <section className="mt-5 rounded-[18px] border border-line bg-surface p-5">
            <h2 className="text-[15px] font-extrabold">Repasses</h2>
            <p className="mt-1 text-[12px] font-semibold text-muted">
              Transferências já enviadas para a sua conta bancária.
            </p>
            {payouts.length === 0 ? (
              <p className="mt-3 text-[13px] font-semibold text-muted">Nenhum repasse realizado ainda.</p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[520px] text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-bg/60 text-[11px] font-bold uppercase tracking-[.04em] text-muted-2">
                      <th className="px-4 py-2.5">Valor</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">Solicitado em</th>
                      <th className="px-4 py-2.5">Pago em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payouts.map((payout) => (
                      <tr key={payout.id} className="border-b border-line-divider last:border-0">
                        <td className="px-4 py-2.5 font-bold">{formatCents(payout.amountCents)}</td>
                        <td className="px-4 py-2.5"><StatusChip status={payout.status} /></td>
                        <td className="px-4 py-2.5 text-muted">{formatDate(payout.requestedAt)}</td>
                        <td className="px-4 py-2.5 text-muted">{formatDate(payout.paidAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Lançamentos */}
          <section className="mt-5 rounded-[18px] border border-line bg-surface p-5">
            <h2 className="text-[15px] font-extrabold">Lançamentos</h2>
            {entries.length === 0 ? (
              <p className="mt-3 text-[13px] font-semibold text-muted">Nenhum lançamento ainda.</p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[520px] text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-bg/60 text-[11px] font-bold uppercase tracking-[.04em] text-muted-2">
                      <th className="px-4 py-2.5">Tipo</th>
                      <th className="px-4 py-2.5">Valor</th>
                      <th className="px-4 py-2.5">Referência</th>
                      <th className="px-4 py-2.5">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id} className="border-b border-line-divider last:border-0">
                        <td className="px-4 py-2.5 font-bold">{LEDGER_LABELS[entry.type] ?? entry.type}</td>
                        <td className={`px-4 py-2.5 font-bold ${entry.amountCents < 0 ? "text-danger" : "text-success"}`}>
                          {formatCents(entry.amountCents)}
                        </td>
                        <td className="px-4 py-2.5 text-muted">{entry.referenceType}</td>
                        <td className="px-4 py-2.5 text-muted">{formatDate(entry.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Dados bancários */}
          <section className="mt-5 rounded-[18px] border border-line bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-extrabold">Conta para repasse</h2>
              <button
                type="button"
                onClick={() => setShowAccountForm((v) => !v)}
                className="rounded-lg border-[1.5px] border-line-input px-3 py-1.5 text-[13px] font-bold text-ink-soft"
              >
                + Nova conta
              </button>
            </div>

            {showAccountForm ? (
              <div className="mt-4 grid gap-3 rounded-xl bg-bg p-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Banco</label>
                  <select value={bankCode} onChange={(e) => setBankCode(e.target.value)} className={inputCls}>
                    {BANKS.map(([code, label]) => (
                      <option key={code} value={code}>{code} — {label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Tipo de conta</label>
                  <div className="flex gap-2">
                    {(["corrente", "poupanca"] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setAccountType(type)}
                        className={`h-[46px] flex-1 rounded-xl border-[1.5px] text-[13px] font-bold ${
                          accountType === type ? "border-primary text-primary" : "border-line-input text-muted"
                        }`}
                      >
                        {type === "corrente" ? "Corrente" : "Poupança"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Agência</label>
                  <input value={agency} onChange={(e) => setAgency(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Conta com dígito</label>
                  <input value={account} onChange={(e) => setAccount(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Nome do titular</label>
                  <input value={holderName} onChange={(e) => setHolderName(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>CPF ou CNPJ do titular</label>
                  <input
                    value={holderDocument}
                    onChange={(e) => setHolderDocument(e.target.value)}
                    placeholder="000.000.000-00"
                    className={inputCls}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Chave Pix (opcional)</label>
                  <input value={pixKey} onChange={(e) => setPixKey(e.target.value)} className={inputCls} />
                </div>
                <div className="sm:col-span-2">
                  <p className="mb-2 text-[12px] font-medium text-muted-2">
                    A conta cadastrada passa a ser a padrão dos repasses.
                  </p>
                  <button
                    type="button"
                    onClick={addBankAccount}
                    disabled={savingAccount}
                    className="h-11 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta disabled:bg-[#ecd6e4] disabled:shadow-none"
                  >
                    {savingAccount ? "Salvando…" : "Salvar conta"}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-4 space-y-2">
              {accounts.length === 0 ? (
                <p className="text-[13px] font-semibold text-muted">Nenhuma conta bancária cadastrada.</p>
              ) : (
                accounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-bg px-4 py-3 text-[13px]"
                  >
                    <span className="font-bold">{acc.holderName}</span>
                    <span className="text-muted">
                      Banco {acc.bankCode} · ag {acc.agency} · {acc.accountType} {acc.account}
                    </span>
                    {acc.isDefault ? <span className="font-bold text-primary">Padrão</span> : null}
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}

      {showWithdraw ? (
        <PayoutRequestModal
          organizationId={orgId}
          availableCents={withdrawableCents}
          account={defaultAccount}
          onClose={() => setShowWithdraw(false)}
          onRequested={load}
        />
      ) : null}
    </>
  );
}

export default function FinancePage({ params }: { params: { orgId: string } }) {
  return (
    <GuardedPanelShell title="Financeiro" organizationId={params.orgId}>
      <FinanceContent orgId={params.orgId} />
    </GuardedPanelShell>
  );
}
