"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "../../lib/api";

/**
 * Destino do link mágico do e-mail "seu ingresso está pronto": clicar prova a
 * posse do e-mail — verifica a conta, loga e abre o pedido.
 */
function AcessoContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setError("Link incompleto — abra o e-mail de novo ou peça um código na página do pedido.");
      return;
    }
    api
      .magicVerify(token)
      .then((res) => {
        localStorage.setItem("bf.token", res.token);
        router.replace(res.orderToken ? `/pedido/${res.orderToken}` : "/perfil");
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Link inválido ou expirado — peça um código na página do pedido."),
      );
  }, [params, router]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-[360px] text-center">
        {error ? (
          <>
            <p className="text-[34px]">😕</p>
            <p className="mt-3 text-[14px] font-semibold text-muted">{error}</p>
          </>
        ) : (
          <>
            <div className="mx-auto h-9 w-9 animate-spin rounded-full border-[3px] border-primary/20 border-t-primary" />
            <p className="mt-4 text-[14px] font-semibold text-muted">Abrindo seu ingresso…</p>
          </>
        )}
      </div>
    </main>
  );
}

export default function AcessoPage() {
  return (
    <Suspense fallback={null}>
      <AcessoContent />
    </Suspense>
  );
}
