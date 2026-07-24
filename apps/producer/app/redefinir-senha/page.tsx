"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { passwordAuth } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { AuthShell, inputCls, labelCls, primaryBtn } from "../../components/AuthShell";

function ResetContent() {
  const router = useRouter();
  const { login } = useAuth();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await passwordAuth.reset(token, password);
      login(res.token, res.user);
      router.push("/organizacoes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Link inválido ou expirado");
    }
  }

  return (
    <AuthShell>
      <h1 className="text-[26px] font-extrabold">Definir nova senha</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className={labelCls}>Nova senha (mín. 8 caracteres)</label>
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
        </div>
        {error && <p className="text-[12px] font-semibold text-danger">{error}</p>}
        <button type="submit" className={primaryBtn}>Salvar e entrar</button>
      </form>
    </AuthShell>
  );
}

export default function ResetPage() {
  return (
    <Suspense>
      <ResetContent />
    </Suspense>
  );
}
