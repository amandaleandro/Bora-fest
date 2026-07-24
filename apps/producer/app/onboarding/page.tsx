"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth";
import { organizationsApi, bankAccountsApi } from "@/lib/api";

const BANKS = [
  ["001", "Banco do Brasil"], ["104", "Caixa"], ["237", "Bradesco"], ["341", "Itaú"],
  ["033", "Santander"], ["260", "Nubank"], ["077", "Inter"], ["336", "C6 Bank"],
] as const;

const inputCls = "mt-1 h-[46px] w-full rounded-xl border-[1.5px] border-line-input bg-surface px-3.5 text-[14px] font-medium outline-none focus:border-primary";
const labelCls = "text-[12px] font-bold text-ink-soft";

function OnboardingContent() {
  const router = useRouter();
  const { token } = useAuth();
  const [kind, setKind] = useState<"INDIVIDUAL" | "COMPANY">("INDIVIDUAL");
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [holderName, setHolderName] = useState("");
  const [bankCode, setBankCode] = useState("341");
  const [agency, setAgency] = useState("");
  const [account, setAccount] = useState("");
  const [accountType, setAccountType] = useState<"corrente" | "poupanca">("corrente");
  const [pixKey, setPixKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const org = await organizationsApi.create(token, { name, kind, document: document.replace(/\D/g, "") });
      if (agency && account) {
        await bankAccountsApi.add((org as { id: string }).id, {
          holderName: holderName || name,
          holderDocument: document.replace(/\D/g, ""),
          bankCode, agency, account, accountType,
          pixKey: pixKey || undefined,
        }, token);
      }
      router.push("/organizacoes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-[26px] font-extrabold">Dados do organizador</h1>

      {/* diferencial de produto (§20): vendas liberadas durante a verificação */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-success/30 bg-success/5 p-4">
        <p className="text-[14px] font-bold text-success">
          Suas vendas NÃO ficam bloqueadas — a verificação roda em segundo plano.
        </p>
        <span className="animate-pulse rounded-full bg-warning/10 px-3 py-1 text-[11px] font-bold text-warning">
          Verificação pendente
        </span>
      </div>

      <form onSubmit={submit} className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[16px] font-extrabold">Dados do organizador</h2>
          <div className="mt-3 flex rounded-xl bg-line p-1">
            {([["INDIVIDUAL", "Pessoa física"], ["COMPANY", "Pessoa jurídica"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={`flex-1 rounded-lg py-2 text-[13px] font-bold ${kind === k ? "bg-surface shadow-sm" : "text-muted"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            <div>
              <label className={labelCls}>{kind === "INDIVIDUAL" ? "Nome completo" : "Razão social"}</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{kind === "INDIVIDUAL" ? "CPF" : "CNPJ"}</label>
              <input required value={document} onChange={(e) => setDocument(e.target.value)}
                placeholder={kind === "INDIVIDUAL" ? "000.000.000-00" : "00.000.000/0001-00"} className={inputCls} />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[16px] font-extrabold">Dados de pagamento</h2>
          <p className="mt-0.5 text-[12px] font-medium text-muted">Para onde vão os repasses (opcional agora).</p>
          <div className="mt-4 space-y-3">
            <div>
              <label className={labelCls}>Banco</label>
              <select value={bankCode} onChange={(e) => setBankCode(e.target.value)} className={inputCls}>
                {BANKS.map(([code, label]) => <option key={code} value={code}>{code} — {label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Favorecido</label>
              <input value={holderName} onChange={(e) => setHolderName(e.target.value)} placeholder="Se diferente do organizador" className={inputCls} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={labelCls}>Agência</label>
                <input value={agency} onChange={(e) => setAgency(e.target.value)} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Conta com dígito</label>
                <input value={account} onChange={(e) => setAccount(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div className="flex gap-2">
              {(["corrente", "poupanca"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setAccountType(t)}
                  className={`flex-1 rounded-xl border-[1.5px] py-2 text-[13px] font-bold ${accountType === t ? "border-primary text-primary" : "border-line-input text-muted"}`}>
                  {t === "corrente" ? "Corrente" : "Poupança"}
                </button>
              ))}
            </div>
            <div>
              <label className={labelCls}>Chave Pix (opcional)</label>
              <input value={pixKey} onChange={(e) => setPixKey(e.target.value)} className={inputCls} />
            </div>
          </div>
        </section>

        <div className="lg:col-span-2">
          {error && <p className="mb-2 text-[12px] font-semibold text-danger">{error}</p>}
          <button type="submit" disabled={busy || name.length < 2 || document.length < 11}
            className="h-12 rounded-xl bg-primary px-8 text-[14px] font-extrabold text-white shadow-cta disabled:bg-[#d9d2e8] disabled:shadow-none">
            {busy ? "Salvando…" : "Salvar dados"}
          </button>
        </div>
      </form>
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <AuthGuard>
      <OnboardingContent />
    </AuthGuard>
  );
}
