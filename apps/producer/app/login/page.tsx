"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { passwordAuth } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { resolveHomePath } from "../../lib/eventContext";
import { AuthShell, inputCls, labelCls, primaryBtn } from "../../components/AuthShell";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // aviso da sessão vencida (2026-10-12): o AuthGuard manda pra cá com
  // ?sessao=expirada. Lido no efeito (e não com useSearchParams) para a página
  // não precisar de Suspense só por causa disso.
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("sessao") === "expirada") {
      setSessionNotice("Sua sessão expirou — entre de novo.");
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await passwordAuth.login(email, password);
      login(res.token, res.user);
      // pós-login vai direto para "Meus eventos" da 1ª organização (decisão v2 #6)
      router.push(await resolveHomePath(res.token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "E-mail ou senha inválidos");
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="text-[26px] font-extrabold">Entrar no painel</h1>
      <p className="mt-1 text-[13px] font-medium text-muted">Gerencie eventos, vendas e repasses.</p>
      {sessionNotice && !error ? (
        <p className="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[12.5px] font-bold text-warning">
          {sessionNotice}
        </p>
      ) : null}
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
