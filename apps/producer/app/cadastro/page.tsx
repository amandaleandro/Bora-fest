"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { passwordAuth } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { AuthShell, inputCls, labelCls, primaryBtn } from "../../components/AuthShell";

export default function RegisterPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError("A senha precisa de pelo menos 8 caracteres"); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await passwordAuth.register({ name, email, password });
      login(res.token, res.user);
      router.push("/organizacoes?onboarding=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a conta");
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="text-[26px] font-extrabold">Criar conta de produtor</h1>
      <p className="mt-1 text-[13px] font-medium text-muted">Publique seu evento em minutos — sem espera de aprovação.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className={labelCls}>Nome completo</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>E-mail</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Senha (mín. 8 caracteres)</label>
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
        </div>
        <label className="flex items-start gap-2 text-[12px] font-medium text-ink-soft">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
          <span>
            Li e aceito os <a href="http://localhost:3000/legal?aba=termos" className="font-bold text-primary">Termos</a> e a{" "}
            <a href="http://localhost:3000/legal" className="font-bold text-primary">Política de Privacidade</a> (LGPD)
          </span>
        </label>
        {error && <p className="text-[12px] font-semibold text-danger">{error}</p>}
        <button type="submit" disabled={busy || !accept} className={primaryBtn}>{busy ? "Criando…" : "Criar conta"}</button>
      </form>
      <p className="mt-6 text-center text-[13px] font-semibold text-muted">
        Já tem conta? <Link href="/login" className="font-extrabold text-primary">Entrar</Link>
      </p>
    </AuthShell>
  );
}
