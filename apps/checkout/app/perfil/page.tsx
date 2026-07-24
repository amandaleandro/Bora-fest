"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../../lib/api";
import { Icon, paths } from "../../components/icons";

export default function ProfilePage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ name: string | null; email: string | null; phone: string | null } | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waNotif, setWaNotif] = useState(true);
  const [emailOffers, setEmailOffers] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("bf.token");
    setToken(t);
    setWaNotif(localStorage.getItem("bf.pref.wa") !== "off");
    setEmailOffers(localStorage.getItem("bf.pref.offers") === "on");
    if (t) api.myProfile(t).then(setProfile).catch(() => { localStorage.removeItem("bf.token"); setToken(null); });
  }, []);

  async function login() {
    setError(null);
    try {
      if (!otpSent) {
        await api.requestOtp(email);
        setOtpSent(true);
      } else {
        const res = await api.verifyOtp(email, code);
        localStorage.setItem("bf.token", res.token);
        setToken(res.token);
        setProfile(await api.myProfile(res.token));
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha no login");
    }
  }

  async function downloadData() {
    if (!token) return;
    const data = await api.myDataExport(token);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "meus-dados-borafest.json";
    a.click();
  }

  async function deleteAccount() {
    if (!token) return;
    try {
      await api.deleteAccount(token);
      localStorage.clear();
      router.push("/");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao excluir");
    }
  }

  // --- não logado: login por código -----------------------------------------
  if (!token) {
    return (
      <main className="px-5 pb-10 pt-6">
        <header className="flex items-center gap-3">
          <button onClick={() => router.back()} aria-label="Voltar" className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface"><Icon d={paths.back} /></button>
          <h1 className="text-[20px] font-extrabold">Minha conta</h1>
        </header>
        <p className="mt-4 text-[13px] font-medium text-muted">
          Entre com seu e-mail para ver seus ingressos e compras — sem senha.
        </p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@email.com"
          className="mt-4 h-[50px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary"
        />
        {otpSent && (
          <input
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="Código de 6 dígitos"
            className="mt-3 h-[56px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-center text-[20px] font-extrabold tracking-[8px] outline-none focus:border-primary"
          />
        )}
        {error && <p className="mt-2 text-[12px] font-semibold text-danger">{error}</p>}
        <button onClick={login} className="mt-4 h-14 w-full rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta">
          {otpSent ? "Entrar" : "Enviar código"}
        </button>
      </main>
    );
  }

  // --- logado ---------------------------------------------------------------
  return (
    <main className="px-5 pb-16 pt-6">
      <header className="flex items-center gap-3">
        <button onClick={() => router.back()} aria-label="Voltar" className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface"><Icon d={paths.back} /></button>
        <h1 className="text-[20px] font-extrabold">Minha conta</h1>
      </header>

      <div className="mt-5 flex items-center gap-4 rounded-3xl border border-line bg-surface p-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-white">
          <Icon d={paths.user} size={24} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[16px] font-extrabold">{profile?.name ?? "Sem nome"}</p>
          <p className="truncate text-[12px] font-medium text-muted">{profile?.email}</p>
          {profile?.phone && <p className="truncate text-[12px] font-medium text-muted">{profile.phone}</p>}
        </div>
      </div>

      <section className="mt-6">
        <h2 className="text-[13px] font-extrabold uppercase tracking-wide text-muted-2">Conta</h2>
        <div className="mt-2 divide-y divide-line-divider rounded-2xl border border-line bg-surface">
          <Link href="/minhas-compras" className="flex items-center justify-between p-4 text-[14px] font-bold">
            Minhas compras <Icon d={paths.chevron} size={16} className="text-muted-3" />
          </Link>
          <label className="flex items-center justify-between p-4 text-[14px] font-bold">
            Avisos por WhatsApp
            <input type="checkbox" checked={waNotif} onChange={(e) => { setWaNotif(e.target.checked); localStorage.setItem("bf.pref.wa", e.target.checked ? "on" : "off"); }} className="h-5 w-9 accent-primary" />
          </label>
          <label className="flex items-center justify-between p-4 text-[14px] font-bold">
            Ofertas por e-mail
            <input type="checkbox" checked={emailOffers} onChange={(e) => { setEmailOffers(e.target.checked); localStorage.setItem("bf.pref.offers", e.target.checked ? "on" : "off"); }} className="h-5 w-9 accent-primary" />
          </label>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-[13px] font-extrabold uppercase tracking-wide text-muted-2">Privacidade e dados</h2>
        <div className="mt-2 divide-y divide-line-divider rounded-2xl border border-line bg-surface">
          <Link href="/legal" className="flex items-center justify-between p-4 text-[14px] font-bold">
            Política de Privacidade <Icon d={paths.chevron} size={16} className="text-muted-3" />
          </Link>
          <Link href="/legal?aba=termos" className="flex items-center justify-between p-4 text-[14px] font-bold">
            Termos de Uso <Icon d={paths.chevron} size={16} className="text-muted-3" />
          </Link>
          <button onClick={downloadData} className="flex w-full items-center justify-between p-4 text-left text-[14px] font-bold">
            Baixar meus dados <Icon d={paths.chevron} size={16} className="text-muted-3" />
          </button>
        </div>
      </section>

      <button
        onClick={() => { localStorage.removeItem("bf.token"); setToken(null); setProfile(null); }}
        className="mt-6 h-12 w-full rounded-2xl border-[1.5px] border-line-input text-[14px] font-bold text-ink"
      >
        Sair da conta
      </button>
      <button onClick={() => setConfirmDelete(true)} className="mt-3 w-full text-center text-[13px] font-bold text-danger">
        Excluir minha conta
      </button>
      {error && <p className="mt-2 text-center text-[12px] font-semibold text-danger">{error}</p>}
      <p className="mt-8 text-center text-[11px] font-medium text-muted-3">BoraFest v1.0.0</p>

      {confirmDelete && (
        <div className="fixed inset-0 z-20 mx-auto flex max-w-[430px] items-end bg-black/40" onClick={() => setConfirmDelete(false)}>
          <div className="w-full rounded-t-3xl bg-surface p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[18px] font-extrabold">Excluir sua conta?</h2>
            <p className="mt-2 text-[13px] font-medium text-muted">
              Seus dados pessoais são removidos em até 30 dias (LGPD). Ingressos de eventos futuros são
              cancelados sem reembolso. Essa ação não pode ser desfeita.
            </p>
            <button onClick={deleteAccount} className="mt-5 h-14 w-full rounded-2xl bg-danger text-[15px] font-extrabold text-white">
              Excluir definitivamente
            </button>
            <button onClick={() => setConfirmDelete(false)} className="mt-2 h-12 w-full rounded-2xl border-[1.5px] border-line-input text-[14px] font-bold">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
