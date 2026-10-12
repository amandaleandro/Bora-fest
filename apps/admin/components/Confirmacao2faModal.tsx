"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Input } from "@borafest/ui";
import { ApiError, ERRO_2FA_NAO_ATIVADO, segurancaApi } from "@/lib/api";
import { guardarConfirmacao2fa, registrarPedidoDeCodigo2fa } from "@/lib/confirmacao-2fa";

interface Pedido {
  sessionToken: string;
  resolver: (confirmacao: string | null) => void;
}

/**
 * SEGUNDO FATOR (2026-10-12): pede o código de 6 dígitos do app autenticador
 * quando uma ação de dinheiro precisa de confirmação (lib/api.ts chama). Fica
 * no layout, fora das telas: nenhuma tela precisa saber do 2FA. O código vira
 * uma confirmação de 10 minutos, guardada para as próximas ações.
 */
export function Confirmacao2faModal() {
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [semAtivacao, setSemAtivacao] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(
    () =>
      registrarPedidoDeCodigo2fa(
        (sessionToken) =>
          new Promise<string | null>((resolver) => {
            setCodigo("");
            setErro(null);
            setSemAtivacao(false);
            setPedido({ sessionToken, resolver });
          }),
      ),
    [],
  );

  function fechar(confirmacao: string | null) {
    pedido?.resolver(confirmacao);
    setPedido(null);
    setCodigo("");
    setErro(null);
    setSemAtivacao(false);
  }

  // Esc cancela, como nos diálogos do navegador
  useEffect(() => {
    if (!pedido) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !enviando) fechar(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido, enviando]);

  async function confirmar() {
    if (!pedido || codigo.length !== 6) return;
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await segurancaApi.confirmarAcao(pedido.sessionToken, codigo);
      guardarConfirmacao2fa(resposta.confirmacao, resposta.expiraEm);
      fechar(resposta.confirmacao);
    } catch (err) {
      // sessão vencida: o AuthProvider já manda ao login; a ação não é feita
      if (err instanceof ApiError && err.status === 401) {
        fechar(null);
        return;
      }
      setSemAtivacao(err instanceof ApiError && err.code === ERRO_2FA_NAO_ATIVADO);
      setErro(err instanceof Error ? err.message : "Não foi possível conferir o código");
      setCodigo("");
    } finally {
      setEnviando(false);
    }
  }

  if (!pedido) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-confirmacao-2fa"
    >
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-glass">
        <h2 id="titulo-confirmacao-2fa" className="text-lg font-bold tracking-tight text-white">
          Confirme com o autenticador
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Esta ação mexe com dinheiro. Digite o código de 6 dígitos que aparece agora no seu aplicativo
          autenticador. A confirmação vale por 10 minutos para as próximas ações.
        </p>

        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            confirmar();
          }}
        >
          <Input
            autoFocus
            aria-label="Código de 6 dígitos"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            value={codigo}
            onChange={(event) => setCodigo(event.target.value.replace(/\D/g, "").slice(0, 6))}
            maxLength={6}
            className="text-center text-lg tracking-widest font-mono"
          />

          {erro ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-medium text-rose-400">
              {erro}
              {semAtivacao ? (
                <>
                  {" "}
                  <Link href="/seguranca" className="font-semibold underline" onClick={() => fechar(null)}>
                    Ir para Segurança
                  </Link>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button type="button" variant="ghost" className="flex-1" onClick={() => fechar(null)} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" isLoading={enviando} disabled={enviando || codigo.length !== 6}>
              Confirmar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
