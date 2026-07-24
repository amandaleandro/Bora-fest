"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { passwordAuth } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { AuthShell, inputCls, labelCls, primaryBtn } from "../../components/AuthShell";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await passwordAuth.login(email, password);
      login(res.token, res.user);
      router.push("/organizacoes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "E-mail ou senha inválidos");
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="text-[26px] font-extrabold">Entrar no painel</h1>
      <p className="mt-1 text-[13px] font-medium text-muted">Gerencie eventos, vendas e repasses.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className={labelCls}>E-mail</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="voce@produtora.com" />
        </div>
        <div>
          <label className={labelCls}>Senha</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="••••••••" />
          <div className="mt-1 text-right">
            <Link href="/recuperar" className="text-[12px] font-bold text-primary">Esqueci minha senha</Link>
          </div>
        </div>
        {error && <p className="text-[12px] font-semibold text-danger">{error}</p>}
        <button type="submit" disabled={busy} className={primaryBtn}>{busy ? "Entrando…" : "Entrar"}</button>
      </form>
      <button disabled className="mt-3 h-12 w-full rounded-xl border-[1.5px] border-line-input text-[13px] font-bold text-muted-3">
        Entrar com Google · em breve
      </button>
      <p className="mt-6 text-center text-[13px] font-semibold text-muted">
        Novo por aqui? <Link href="/cadastro" className="font-extrabold text-primary">Criar conta de produtor</Link>
      </p>
    </AuthShell>
  );
}
