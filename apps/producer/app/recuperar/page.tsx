"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { passwordAuth } from "../../lib/api";
import { AuthShell, inputCls, labelCls, primaryBtn } from "../../components/AuthShell";

function RecoverContent() {
  const params = useSearchParams();
  // ?novo=1: PRIMEIRO ACESSO ao painel (conta única — comprador/promoter que
  // nunca definiu senha). Mesmo fluxo seguro do link por e-mail, texto certo.
  const primeiroAcesso = params.get("novo") === "1";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const prefill = params.get("email");
    if (prefill) setEmail(prefill);
  }, [params]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await passwordAuth.recover(email).catch(() => {});
    setSent(true);
  }

  return (
    <AuthShell>
      <h1 className="text-[26px] font-extrabold">{primeiroAcesso ? "Crie sua senha" : "Recuperar senha"}</h1>
      <p className="mt-1 text-[13px] font-medium text-muted">
        {primeiroAcesso
          ? "Sua conta BoraFest é única — para entrar no painel pela primeira vez, defina uma senha pelo link que enviaremos ao seu e-mail."
          : "Enviamos um link de redefinição para o seu e-mail."}
      </p>
      {sent ? (
        <div className="mt-6 rounded-xl bg-success/10 p-4 text-[13px] font-bold text-success">
          {primeiroAcesso
            ? "Link enviado — abra o e-mail, crie sua senha e você já cai no painel (válido por 30 minutos)."
            : "Se este e-mail tiver conta, o link foi enviado — válido por 30 minutos. Confira a caixa de entrada."}
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className={labelCls}>E-mail</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </div>
          <button type="submit" className={primaryBtn}>{primeiroAcesso ? "Criar minha senha" : "Enviar link"}</button>
        </form>
      )}
      <p className="mt-6 text-center text-[13px] font-semibold text-muted">
        <Link href="/login" className="font-extrabold text-primary">{primeiroAcesso ? "Já tenho senha — entrar" : "Voltar ao login"}</Link>
      </p>
    </AuthShell>
  );
}

export default function RecoverPage() {
  return (
    <Suspense>
      <RecoverContent />
    </Suspense>
  );
}
