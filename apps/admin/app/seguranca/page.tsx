"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input } from "@borafest/ui";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { segurancaApi, type Status2fa } from "@/lib/api";
import { guardarConfirmacao2fa } from "@/lib/confirmacao-2fa";

/** "GEZDGNBV..." → "GEZD GNBV ..." — mais fácil de conferir ao digitar no celular */
function agruparChave(chave: string): string {
  return chave.match(/.{1,4}/g)?.join(" ") ?? chave;
}

/**
 * SEGURANÇA (2026-10-12): ativação do segundo fator do backoffice. Aprovar
 * saque, gerar e marcar repasse pago, estornar, aprovar reembolso, mudar taxa
 * ou modo de repasse e aprovar/desbloquear casa pedem o código do app
 * autenticador. Aqui o staff gera a chave, cadastra no app e confirma com o
 * 1º código.
 */
function SegurancaContent() {
  const { token } = useAuth();
  const [status, setStatus] = useState<Status2fa | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ativacao, setAtivacao] = useState<{ segredo: string; otpauthUrl: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<"chave" | "link" | null>(null);
  const [acabouDeAtivar, setAcabouDeAtivar] = useState(false);

  async function load() {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    try {
      setStatus(await segurancaApi.status(token));
    } catch (err) {
      // erro não vira "não ativo": sem status a tela não oferece ativar às cegas
      setLoadError(err instanceof Error ? err.message : "Não foi possível consultar a verificação em duas etapas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function gerarChave() {
    if (!token) return;
    if (
      (ativacao || status?.ativacaoPendente) &&
      !window.confirm(
        "Gerar uma chave nova invalida a anterior. Se você já cadastrou a chave antiga no aplicativo, apague aquela entrada depois. Continuar?",
      )
    ) {
      return;
    }
    setBusy(true);
    setErro(null);
    setCodigo("");
    try {
      const resposta = await segurancaApi.iniciarAtivacao(token);
      setAtivacao({ segredo: resposta.segredo, otpauthUrl: resposta.otpauthUrl });
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível gerar a chave");
    } finally {
      setBusy(false);
    }
  }

  async function confirmar() {
    if (!token || codigo.length !== 6) return;
    setBusy(true);
    setErro(null);
    try {
      const resposta = await segurancaApi.confirmarAtivacao(token, codigo);
      // quem acabou de ativar já sai com 10 minutos de confirmação
      guardarConfirmacao2fa(resposta.confirmacao, resposta.expiraEm);
      setAtivacao(null);
      setCodigo("");
      setAcabouDeAtivar(true);
      await load();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível confirmar o código");
      setCodigo("");
    } finally {
      setBusy(false);
    }
  }

  async function copiar(texto: string, qual: "chave" | "link") {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(qual);
      setTimeout(() => setCopiado((atual) => (atual === qual ? null : atual)), 2000);
    } catch {
      setErro("Não foi possível copiar. Selecione o texto e copie à mão.");
    }
  }

  return (
    <main>
      <Nav />
      <h1 className="mt-6 text-xl font-semibold">Segurança</h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-400">
        Aprovar saque, gerar ou marcar repasse como pago, estornar pedido, aprovar reembolso, mudar
        taxa ou modo de repasse e aprovar ou desbloquear uma casa pedem o código de 6 dígitos de um
        aplicativo autenticador no seu celular (Google Authenticator, Microsoft Authenticator,
        Authy, 1Password ou similar). Assim, quem conseguir entrar no seu e-mail ainda não consegue
        mexer em dinheiro.
      </p>

      <Card className="mt-6 max-w-3xl">
        <h2 className="text-lg font-bold tracking-tight text-white">Verificação em duas etapas</h2>

        {loading ? (
          <p className="mt-4 text-sm text-gray-400">Carregando...</p>
        ) : loadError ? (
          <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-950/30 p-4 text-sm text-rose-300">
            <p>{loadError}</p>
            <button type="button" onClick={load} className="mt-2 font-semibold underline">
              Tentar novamente
            </button>
          </div>
        ) : status?.ativo ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
              <p className="font-semibold">Ativa</p>
              {status.ativoDesde ? (
                <p className="mt-1 text-xs text-emerald-200/80">
                  desde {new Date(status.ativoDesde).toLocaleString("pt-BR")}
                </p>
              ) : null}
              {acabouDeAtivar ? (
                <p className="mt-2 text-xs text-emerald-200/80">
                  Pronto. Nos próximos 10 minutos as ações de dinheiro não vão pedir código; depois,
                  o backoffice pede o código do aplicativo quando precisar.
                </p>
              ) : null}
            </div>
            <p className="text-xs text-slate-400">
              Trocou de celular ou perdeu o aparelho? Peça ao responsável técnico para redefinir a
              verificação desta conta e ative de novo aqui.
            </p>
          </div>
        ) : !status?.servidorPronto ? (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
            O servidor ainda não tem a chave <span className="font-mono">TOTP_ENCRYPTION_KEY</span>{" "}
            configurada. Sem ela ninguém consegue ativar a verificação, e as ações de dinheiro ficam
            bloqueadas. Peça ao responsável técnico para configurar a variável na API.
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-300">
              <li>Instale um aplicativo autenticador no celular.</li>
              <li>Gere a chave abaixo e cadastre no aplicativo.</li>
              <li>Digite o código de 6 dígitos que o aplicativo mostrar.</li>
            </ol>

            {status?.ativacaoPendente && !ativacao ? (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                Uma ativação foi começada e não terminou. Por segurança a chave não é mostrada de
                novo: gere uma nova para concluir.
              </p>
            ) : null}

            {!ativacao ? (
              <Button type="button" onClick={gerarChave} isLoading={busy} disabled={busy}>
                {status?.ativacaoPendente ? "Gerar nova chave" : "Ativar verificação em duas etapas"}
              </Button>
            ) : (
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Chave para digitar no aplicativo
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <code className="select-all break-all rounded-lg border border-slate-700/60 bg-slate-950/70 px-3 py-2 font-mono text-base tracking-wider text-white">
                      {agruparChave(ativacao.segredo)}
                    </code>
                    <Button type="button" variant="outline" size="sm" onClick={() => copiar(ativacao.segredo, "chave")}>
                      {copiado === "chave" ? "Copiada" : "Copiar chave"}
                    </Button>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-400">
                    No aplicativo, escolha “Inserir chave de configuração” (ou “Digitar chave”), use
                    seu e-mail como nome da conta, cole a chave e deixe o tipo “Baseado em tempo”.
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Link de configuração (otpauth)
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <code className="select-all break-all rounded-lg border border-slate-700/60 bg-slate-950/70 px-3 py-2 font-mono text-xs text-slate-200">
                      {ativacao.otpauthUrl}
                    </code>
                    <Button type="button" variant="outline" size="sm" onClick={() => copiar(ativacao.otpauthUrl, "link")}>
                      {copiado === "link" ? "Copiado" : "Copiar link"}
                    </Button>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-400">
                    Aberto no celular, este link cadastra a conta direto no aplicativo. Não mande a
                    chave nem o link para ninguém.
                  </p>
                </div>

                <form
                  className="flex flex-wrap items-end gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    confirmar();
                  }}
                >
                  <div className="w-44">
                    <Input
                      label="Código do aplicativo"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="000000"
                      value={codigo}
                      onChange={(event) => setCodigo(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      maxLength={6}
                      className="text-center text-lg tracking-widest font-mono"
                    />
                  </div>
                  <Button type="submit" isLoading={busy} disabled={busy || codigo.length !== 6}>
                    Confirmar e ativar
                  </Button>
                  <button
                    type="button"
                    onClick={gerarChave}
                    disabled={busy}
                    className="text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
                  >
                    Gerar outra chave
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        {erro ? (
          <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-medium text-rose-400">
            {erro}
          </div>
        ) : null}
      </Card>
    </main>
  );
}

export default function SegurancaPage() {
  return (
    <AuthGuard>
      <SegurancaContent />
    </AuthGuard>
  );
}
