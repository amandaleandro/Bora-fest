"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import {
  financeApi,
  payoutsApi,
  bankAccountsApi,
  type Balance,
  type LedgerEntry,
  type Payout,
} from "@/lib/api";

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

const PAYOUT_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  PENDING: { bg: "bg-warning/10", fg: "text-warning", label: "Pendente" },
  PAID: { bg: "bg-success/10", fg: "text-success", label: "Pago" },
};

interface BankAccount {
  id: string;
  bankCode: string;
  agency: string;
  account: string;
  holderName: string;
  isDefault: boolean;
}

function FinanceContent({ orgId }: { orgId: string }) {
  const { token } = useAuth();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAccountForm, setShowAccountForm] = useState(false);
  const [bankCode, setBankCode] = useState("");
  const [agency, setAgency] = useState("");
  const [account, setAccount] = useState("");
  const [holderName, setHolderName] = useState("");
  const [isDefault, setIsDefault] = useState(true);
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
    if (!bankCode || !agency || !account || holderName.trim().length < 2) {
      setError("Preencha banco, agência, conta e titular");
      return;
    }
    setSavingAccount(true);
    try {
      await bankAccountsApi.add(orgId, { bankCode, agency, account, holderName, isDefault }, token);
      setBankCode("");
      setAgency("");
      setAccount("");
      setHolderName("");
      setIsDefault(true);
      setShowAccountForm(false);
      setAccounts(await bankAccountsApi.list(orgId, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar a conta bancária");
    } finally {
      setSavingAccount(false);
    }
  }

  return (
    <main>
      <Nav />
      <h1 className="mt-6 text-[22px] font-extrabold">Financeiro</h1>

      {error ? <p className="mt-4 text-[13px] font-semibold text-danger">{error}</p> : null}

      {loading ? (
        <p className="mt-6 text-muted">Carregando...</p>
      ) : (
        <>
          {/* Saldo (KPIs) */}
          <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-[15px] font-extrabold text-primary">
                R$
              </div>
              <p className="text-[12px] font-bold text-muted">Saldo</p>
              <p className="mt-0.5 text-[22px] font-extrabold">{formatCents(balance?.balanceCents ?? 0)}</p>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-success/10 text-[15px] font-extrabold text-success">
                ✓
              </div>
              <p className="text-[12px] font-bold text-muted">Disponível para repasse</p>
              <p className="mt-0.5 text-[22px] font-extrabold">{formatCents(balance?.availableForPayoutCents ?? 0)}</p>
            </div>
          </div>

          {/* Lançamentos */}
          <section className="mt-5 rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-[15px] font-extrabold">Lançamentos</h2>
            {entries.length === 0 ? (
              <p className="mt-4 text-[13px] font-semibold text-muted">Nenhum lançamento ainda.</p>
            ) : (
              <div className="mt-3 overflow-hidden rounded-xl border border-line">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-bg/60 text-[12px] font-bold text-muted">
                      <th className="px-4 py-2.5">Tipo</th>
                      <th className="px-4 py-2.5">Valor</th>
                      <th className="px-4 py-2.5">Referência</th>
                      <th className="px-4 py-2.5">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id} className="border-b border-line last:border-0">
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

          {/* Repasses (payouts) — leitura; criação é do backoffice */}
          <section className="mt-5 rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-[15px] font-extrabold">Repasses</h2>
            <p className="mt-1 text-[12px] font-semibold text-muted">
              Histórico de repasses para sua conta bancária. A liberação segue o calendário da BoraFest.
            </p>
            {payouts.length === 0 ? (
              <p className="mt-4 text-[13px] font-semibold text-muted">Nenhum repasse realizado ainda.</p>
            ) : (
              <div className="mt-3 overflow-hidden rounded-xl border border-line">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-bg/60 text-[12px] font-bold text-muted">
                      <th className="px-4 py-2.5">Valor</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">Solicitado em</th>
                      <th className="px-4 py-2.5">Pago em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payouts.map((payout) => {
                      const s = PAYOUT_STYLES[payout.status] ?? { bg: "bg-line", fg: "text-muted", label: payout.status };
                      return (
                        <tr key={payout.id} className="border-b border-line last:border-0">
                          <td className="px-4 py-2.5 font-bold">{formatCents(payout.amountCents)}</td>
                          <td className="px-4 py-2.5">
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${s.bg} ${s.fg}`}>{s.label}</span>
                          </td>
                          <td className="px-4 py-2.5 text-muted">{formatDate(payout.requestedAt)}</td>
                          <td className="px-4 py-2.5 text-muted">{formatDate(payout.paidAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Dados bancários */}
          <section className="mt-5 rounded-2xl border border-line bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-extrabold">Dados bancários</h2>
              <button
                type="button"
                onClick={() => setShowAccountForm((v) => !v)}
                className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-bold text-muted"
              >
                + Nova conta
              </button>
            </div>

            {showAccountForm ? (
              <div className="mt-3 space-y-2 rounded-xl bg-bg p-4">
                <div className="flex gap-2">
                  <input
                    placeholder="Código do banco"
                    className="w-40 rounded-lg border border-line-input px-3 py-2 text-[13px]"
                    value={bankCode}
                    onChange={(e) => setBankCode(e.target.value)}
                  />
                  <input
                    placeholder="Agência"
                    className="w-32 rounded-lg border border-line-input px-3 py-2 text-[13px]"
                    value={agency}
                    onChange={(e) => setAgency(e.target.value)}
                  />
                  <input
                    placeholder="Conta"
                    className="flex-1 rounded-lg border border-line-input px-3 py-2 text-[13px]"
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                  />
                </div>
                <input
                  placeholder="Nome do titular"
                  className="w-full rounded-lg border border-line-input px-3 py-2 text-[13px]"
                  value={holderName}
                  onChange={(e) => setHolderName(e.target.value)}
                />
                <label className="flex items-center gap-2 text-[13px] font-semibold text-muted">
                  <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
                  Conta padrão para repasses
                </label>
                <button
                  type="button"
                  onClick={addBankAccount}
                  disabled={savingAccount}
                  className="rounded-lg bg-primary px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40"
                >
                  {savingAccount ? "Salvando..." : "Salvar conta"}
                </button>
              </div>
            ) : null}

            <div className="mt-4 space-y-2">
              {accounts.length === 0 ? (
                <p className="text-[13px] font-semibold text-muted">Nenhuma conta bancária cadastrada.</p>
              ) : (
                accounts.map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between rounded-lg bg-bg px-4 py-2.5 text-[13px]">
                    <span className="font-bold">{acc.holderName}</span>
                    <span className="text-muted">
                      Banco {acc.bankCode} · Ag {acc.agency} · Conta {acc.account}
                    </span>
                    {acc.isDefault ? <span className="font-bold text-primary">Padrão</span> : null}
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

export default function FinancePage({ params }: { params: { orgId: string } }) {
  return (
    <AuthGuard>
      <FinanceContent orgId={params.orgId} />
    </AuthGuard>
  );
}
