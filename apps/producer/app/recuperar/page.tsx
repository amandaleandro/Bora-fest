"use client";

import { useState } from "react";
import Link from "next/link";
import { passwordAuth } from "../../lib/api";
import { AuthShell, inputCls, labelCls, primaryBtn } from "../../components/AuthShell";

export default function RecoverPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await passwordAuth.recover(email).catch(() => {});
    setSent(true);
  }

  return (
    <AuthShell>
      <h1 className="text-[26px] font-extrabold">Recuperar senha</h1>
      <p className="mt-1 text-[13px] font-medium text-muted">Enviamos um link de redefinição para o seu e-mail.</p>
      {sent ? (
        <div className="mt-6 rounded-xl bg-success/10 p-4 text-[13px] font-bold text-success">
          Se este e-mail tiver conta, o link foi enviado — válido por 30 minutos. Confira a caixa de entrada.
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className={labelCls}>E-mail</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </div>
          <button type="submit" className={primaryBtn}>Enviar link</button>
        </form>
      )}
      <p className="mt-6 text-center text-[13px] font-semibold text-muted">
        <Link href="/login" className="font-extrabold text-primary">Voltar ao login</Link>
      </p>
    </AuthShell>
  );
}
