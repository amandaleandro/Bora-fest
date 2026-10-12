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

/**
 * Status do REPASSE (2026-10-12): usava o mesmo mapa da solicitação, e o repasse
 * criado e ainda não enviado aparecia como "Em análise" — ele já foi aprovado,
 * só falta a equipe fazer o Pix. FAILED nem tinha rótulo.
 */
const PAYOUT_STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  PENDING: { bg: "bg-warning/10", fg: "text-warning", label: "Aguardando envio" },
  PAID: { bg: "bg-success/10", fg: "text-success", label: "Pago" },
  FAILED: { bg: "bg-danger/10", fg: "text-danger", label: "Falhou — fale com o suporte" },
};

const inputCls =
  "h-[46px] w-full rounded-xl border-[1.5px] border-line-input bg-surface px-3.5 text-[14px] font-medium outline-none focus:border-primary";
const labelCls = "mb-1 block text-[12px] font-bold text-ink-soft";

function StatusChip({ status, styles = STATUS_STYLES }: { status: string; styles?: typeof STATUS_STYLES }) {
  const s = styles[status] ?? { bg: "bg-line", fg: "text-muted", label: status };
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
  // ERRO NÃO VIRA "ZERO" (2026-10-12): falha ao carregar mostrava saldo R$ 0,00 e
  // listas vazias; e as solicitações caíam num .catch(() => []), o que zerava o
  // "já solicitados" e liberava o botão de saque com um saque ainda em andamento.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [requestsError, setRequestsError] = useState<string | null>(null);
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
    setLoadError(null);
    setRequestsError(null);
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
      // falhou só a lista de solicitações: o resto da tela fica de pé, mas com o
      // erro à vista e o saque travado até saber se já há um em andamento
      try {
        setRequests(await payoutsApi.listRequests(orgId, token));
      } catch (err) {
        setRequestsError(err instanceof Error ? err.message : "Não foi possível carregar as solicitações de saque");
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Falha ao carregar o financeiro");
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
  // Antecipação (só plano PADRÃO): o saque pode alcançar até 80% do saldo ainda
  // em janela. Sem contar isso, o botão travava sempre que o disponível era 0
  // (todo o dinheiro em janela antes do D+2) — exatamente quando a antecipação
  // existe pra ajudar; o card de saldo já anuncia "dá pra antecipar no botão".
  const anticipatableCents =
    balance?.settlementMode === "INSTANT" ? 0 : Math.floor((balance?.heldCents ?? 0) * 0.8);
  // 1 saque em andamento por vez (regra do backend): com pendência, o modal só
  // levaria a um 400 — melhor manter travado e mostrar o aviso de andamento.
  // sem a lista de solicitações não dá para saber se já há saque em andamento
  const canWithdraw = !requestsError && pendingCents === 0 && withdrawableCents + anticipatableCents >= 100;
  const lastRequest = requests[0] ?? null;

  return (
    <>
      {error ? <p className="mb-4 text-[13px] font-semibold text-danger">{error}</p> : null}

      {loading ? (
        <p className="text-[13px] font-semibold text-muted">Carregando…</p>
      ) : loadError ? (
        <div className="rounded-[18px] border border-danger/30 bg-danger/5 p-6 text-center">
          <p className="text-[13px] font-bold text-danger">{loadError}</p>
          <button
            type="button"
            onClick={load}
            className="mt-3 h-10 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta"
          >
            Tentar novamente
          </button>
        </div>
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
                  {formatCents(balance?.heldCents ?? 0)} liberam em D+2 úteis após o evento — dá para
                  antecipar com taxa no botão de saque
                </p>
              ) : null}
            </div>
            <div className="rounded-[18px] border border-line bg-surface p-5">
              <p className="text-[12px] font-bold text-muted">Repasse</p>
              {/* 2026-10-12: o Pix é feito pela equipe; o sinal de enviado é o status Pago abaixo */}
              <p className="mt-1 text-[13px] font-semibold leading-snug text-ink-soft">
                {balance?.settlementMode === "INSTANT"
                  ? "Repasse instantâneo: dá para sacar antes da liberação, com taxa de antecipação."
                  : "Vendas liberam 2 dias úteis após o fim do evento."}{" "}
                A equipe BoraFest faz o Pix, sem tarifa.
              </p>
              <button
                type="button"
                onClick={() => setShowWithdraw(true)}
                disabled={!canWithdraw}
                className="mt-3 h-11 w-full rounded-xl bg-primary text-[13px] font-extrabold text-white shadow-cta disabled:bg-line disabled:text-muted disabled:shadow-none"
              >
                Solicitar saque
              </button>
              {lastRequest?.status === "PENDING" ? (
                <p className="mt-2.5 flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2.5 text-[12px] font-bold text-success">
                  ✓ Saque em andamento — acompanhe abaixo
                </p>
              ) : null}
              {requestsError ? (
                <p className="mt-2.5 text-[12px] font-semibold text-warning">
                  Não deu para conferir seus saques em andamento — o botão volta quando a lista carregar.
                </p>
              ) : null}
            </div>
          </div>

          {/* Solicitações de saque */}
          <section className="mt-5 rounded-[18px] border border-line bg-surface p-5">
            <h2 className="text-[15px] font-extrabold">Solicitações de saque</h2>
            {requestsError ? (
              <div className="mt-3 rounded-xl border border-danger/30 bg-danger/5 p-4 text-center">
                <p className="text-[13px] font-bold text-danger">{requestsError}</p>
                <button
                  type="button"
                  onClick={load}
                  className="mt-3 h-10 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta"
                >
                  Tentar novamente
                </button>
              </div>
            ) : requests.length === 0 ? (
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
              Repasses para a sua conta bancária. “Pago” quer dizer que a equipe BoraFest já enviou o Pix.
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
                        <td className="px-4 py-2.5"><StatusChip status={payout.status} styles={PAYOUT_STATUS_STYLES} /></td>
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
                    className="h-11 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta disabled:bg-line disabled:text-muted disabled:shadow-none"
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
          heldCents={balance?.heldCents ?? 0}
          settlementMode={balance?.settlementMode === "INSTANT" ? "INSTANT" : "STANDARD"}
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
