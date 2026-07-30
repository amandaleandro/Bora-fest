"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { identityApi, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, Input } from "@borafest/ui";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    searchParams.get("erro") === "sem-acesso" ? "Sua conta não tem acesso ao backoffice." : null,
  );

  async function handleRequestCode() {
    setError(null);
    setSubmitting(true);
    try {
      await identityApi.requestOtp(email);
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar o código");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyCode() {
    setError(null);
    setSubmitting(true);
    try {
      const response = await identityApi.verifyOtp(email, code);
      if (!response.user.platformRole) {
        setError("Sua conta não tem acesso ao backoffice.");
        return;
      }
      login(response.token, response.user);
      router.push("/organizacoes");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Código inválido");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4 relative overflow-hidden">
      {/* Background Orbs */}
      <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-brand/20 blur-3xl" />
      <div className="absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-accent/15 blur-3xl" />

      <Card className="w-full max-w-md relative z-10 p-8 shadow-glow-brand/20">
        <div className="text-center space-y-2 mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-brand to-brand-light text-xl font-extrabold text-white shadow-glow-brand mb-2">
            BF
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">Backoffice BoraFest</h1>
          <p className="text-sm text-slate-400">Acesso exclusivo e seguro à equipe interna.</p>
        </div>

        <div className="space-y-5">
          <Input
            label="E-mail Corporativo"
            type="email"
            placeholder="seu.nome@borafest.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={step === "code"}
          />

          {step === "code" && (
            <Input
              label="Código OTP de Acesso"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              className="text-center text-lg tracking-widest font-mono"
            />
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-400 font-medium">
              {error}
            </div>
          )}

          <Button
            type="button"
            className="w-full mt-2"
            isLoading={submitting}
            onClick={step === "email" ? handleRequestCode : handleVerifyCode}
            disabled={submitting || (step === "email" ? !email.includes("@") : code.length !== 6)}
          >
            {step === "email" ? "Enviar Código de Acesso" : "Entrar no Sistema"}
          </Button>

          {step === "code" && (
            <button
              type="button"
              onClick={() => setStep("email")}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-200 font-medium transition-colors mt-2"
            >
              ← Alterar e-mail
            </button>
          )}
        </div>
      </Card>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
