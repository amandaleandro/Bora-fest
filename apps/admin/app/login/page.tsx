"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { identityApi, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

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
    <main className="flex min-h-screen flex-col items-center justify-center">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold">Backoffice BoraFest</h1>
        <p className="mt-1 text-gray-400">Acesso restrito à equipe interna.</p>

        <div className="mt-8 space-y-4">
          <div>
            <label className="mb-1 block text-sm text-gray-300">E-mail</label>
            <input
              type="email"
              className="w-full"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={step === "code"}
            />
          </div>

          {step === "code" ? (
            <div>
              <label className="mb-1 block text-sm text-gray-300">Código recebido por e-mail</label>
              <input
                className="w-full"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6}
              />
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="button"
            className="w-full rounded-lg bg-brand px-6 py-3 font-semibold text-brand-dark disabled:opacity-40"
            onClick={step === "email" ? handleRequestCode : handleVerifyCode}
            disabled={submitting || (step === "email" ? !email.includes("@") : code.length !== 6)}
          >
            {submitting ? "Aguarde..." : step === "email" ? "Enviar código" : "Entrar"}
          </button>
        </div>
      </div>
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
