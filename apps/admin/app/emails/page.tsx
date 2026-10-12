"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import {
  COR_DO_TOM,
  dataHora,
  emailsApi,
  nomeDoCanal,
  nomeDoModelo,
  situacaoDeEntrega,
  type ConsultaDeEmails,
  type NotificacaoComProblema,
} from "./api";

/**
 * E-mails (2026-10-12): o suporte não via e-mail que falhou nem sabia se o
 * e-mail chegou — a tela de filas só mostra contagens. Aqui: (1) o que falhou
 * ou ficou preso na fila, com Reenviar; (2) a busca por destinatário com o
 * retorno real do Resend (entregue, devolvido, spam).
 */
function EmailsContent() {
  const { token } = useAuth();

  // --- com problema (FAILED ou PENDING presa) ---
  const [problemas, setProblemas] = useState<NotificacaoComProblema[]>([]);
  const [carregandoProblemas, setCarregandoProblemas] = useState(true);
  const [erroProblemas, setErroProblemas] = useState<string | null>(null);
  const [reenviando, setReenviando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; ok: boolean } | null>(null);

  // --- busca com estado de entrega ---
  const [destinatario, setDestinatario] = useState("");
  const [consulta, setConsulta] = useState<ConsultaDeEmails | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  const [ultimaBusca, setUltimaBusca] = useState<{ destinatario?: string; soProblemas?: boolean }>({});

  const carregarProblemas = useCallback(() => {
    if (!token) return;
    setCarregandoProblemas(true);
    setErroProblemas(null);
    emailsApi
      .comProblema(token)
      .then(setProblemas)
      .catch((err) =>
        setErroProblemas(err instanceof Error ? err.message : "Não foi possível carregar os envios com problema"),
      )
      .finally(() => setCarregandoProblemas(false));
  }, [token]);

  const buscar = useCallback(
    (filtros: { destinatario?: string; soProblemas?: boolean }) => {
      if (!token) return;
      setBuscando(true);
      setErroBusca(null);
      setUltimaBusca(filtros);
      emailsApi
        .consultar(token, filtros)
        .then(setConsulta)
        .catch((err) => setErroBusca(err instanceof Error ? err.message : "Não foi possível buscar os e-mails"))
        .finally(() => setBuscando(false));
    },
    [token],
  );

  useEffect(() => {
    carregarProblemas();
    // abre já com os últimos e-mails: mostra também se o webhook está chegando
    buscar({});
  }, [carregarProblemas, buscar]);

  async function reenviar(n: NotificacaoComProblema) {
    if (!token) return;
    setReenviando(n.id);
    setAviso(null);
    try {
      await emailsApi.reenviar(token, n.id);
      setAviso({ texto: `${nomeDoModelo(n.template)} para ${n.recipient} voltou para a fila de envio.`, ok: true });
      carregarProblemas();
    } catch (err) {
      setAviso({ texto: err instanceof Error ? err.message : "Não foi possível reenviar", ok: false });
    } finally {
      setReenviando(null);
    }
  }

  const botao =
    "rounded-lg border border-slate-700/50 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50";

  return (
    <main>
      <Nav />
      <h1 className="mt-6 text-xl font-semibold">E-mails</h1>
      <p className="mt-1 text-sm text-slate-400">
        O que não saiu, o que voltou e o que chegou. Para mandar de novo os ingressos de uma compra, use{" "}
        <Link href="/pedidos" className="underline">
          Pedidos
        </Link>
        .
      </p>

      {consulta ? (
        consulta.webhookConfigurado ? (
          <p className="mt-4 text-xs text-slate-400">
            Retorno de entrega do Resend ligado.{" "}
            {consulta.ultimoRetornoEm
              ? `Último retorno recebido em ${dataHora(consulta.ultimoRetornoEm)}.`
              : "Nenhum retorno recebido ainda — confira o webhook no painel do Resend."}
          </p>
        ) : (
          <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-950/30 p-4 text-sm text-amber-200">
            O retorno de entrega do Resend não está configurado (RESEND_WEBHOOK_SECRET). Sem ele o sistema só sabe
            que o e-mail saiu, não se chegou. Veja{" "}
            <Link href="/configuracao" className="underline">
              Configuração
            </Link>
            .
          </div>
        )
      ) : null}

      {/* ----------------------------------------------------------------- */}
      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Falharam ou estão presos na fila</h2>
        <button type="button" onClick={carregarProblemas} disabled={carregandoProblemas} className={botao}>
          Atualizar
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Falhou = o provedor recusou 5 vezes. Preso = esperando há mais de 15 minutos (worker parado ou provedor
        fora do ar).
      </p>

      {aviso ? (
        <p className={`mt-3 text-sm ${aviso.ok ? "text-emerald-400" : "text-amber-300"}`}>{aviso.texto}</p>
      ) : null}

      {carregandoProblemas ? (
        <p className="mt-4 text-gray-400">Carregando...</p>
      ) : erroProblemas ? (
        <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-950/30 p-4 text-sm text-rose-300">
          <p>{erroProblemas}</p>
          <button type="button" onClick={carregarProblemas} className="mt-2 font-semibold underline">
            Tentar novamente
          </button>
        </div>
      ) : problemas.length === 0 ? (
        <p className="mt-4 text-sm text-emerald-400">Nenhum envio falhou ou está preso agora.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800/80 text-left text-xs uppercase text-slate-500">
                <th className="p-3">Criado em</th>
                <th className="p-3">Destinatário</th>
                <th className="p-3">Mensagem</th>
                <th className="p-3">Situação</th>
                <th className="p-3">Erro</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {problemas.map((n) => (
                <tr key={n.id} className="border-b border-slate-800/50 align-top last:border-0">
                  <td className="whitespace-nowrap p-3">{dataHora(n.createdAt)}</td>
                  <td className="p-3 break-all">{n.recipient}</td>
                  <td className="p-3">
                    {nomeDoModelo(n.template)}
                    <span className="block text-xs text-slate-500">{nomeDoCanal(n.channel)}</span>
                  </td>
                  <td className={`p-3 font-medium ${n.status === "FAILED" ? "text-rose-400" : "text-amber-300"}`}>
                    {n.status === "FAILED" ? "Falhou" : "Preso na fila"}
                    <span className="block text-xs font-normal text-slate-500">{n.attempts} tentativa(s)</span>
                  </td>
                  <td className="max-w-xs p-3 text-xs text-slate-400 break-words">{n.error ?? "—"}</td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      onClick={() => reenviar(n)}
                      disabled={reenviando !== null}
                      className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-dark disabled:opacity-50"
                    >
                      {reenviando === n.id ? "Reenviando..." : "Reenviar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      <h2 className="mt-10 text-sm font-semibold text-slate-200">Procurar e-mails enviados</h2>
      <p className="mt-1 text-xs text-slate-500">
        Digite o e-mail (ou parte dele) de quem diz que não recebeu. Mostra os 100 mais recentes.
      </p>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          buscar({ destinatario: destinatario.trim() || undefined });
        }}
      >
        <input
          placeholder="e-mail do destinatário"
          value={destinatario}
          onChange={(e) => setDestinatario(e.target.value)}
          className="min-w-[240px] flex-1 rounded-lg border border-slate-700/60 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
          aria-label="E-mail do destinatário"
        />
        <button type="submit" disabled={buscando} className="rounded-lg bg-brand px-4 text-sm font-semibold text-brand-dark disabled:opacity-50">
          Buscar
        </button>
        <button type="button" disabled={buscando} onClick={() => buscar({ soProblemas: true })} className={botao}>
          Só devolvidos e spam
        </button>
      </form>

      {buscando ? (
        <p className="mt-4 text-gray-400">Buscando...</p>
      ) : erroBusca ? (
        <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-950/30 p-4 text-sm text-rose-300">
          <p>{erroBusca}</p>
          <button type="button" onClick={() => buscar(ultimaBusca)} className="mt-2 font-semibold underline">
            Tentar novamente
          </button>
        </div>
      ) : consulta && consulta.itens.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">Nenhum e-mail encontrado.</p>
      ) : consulta ? (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800/80 text-left text-xs uppercase text-slate-500">
                <th className="p-3">Criado em</th>
                <th className="p-3">Destinatário</th>
                <th className="p-3">Mensagem</th>
                <th className="p-3">Entrega</th>
                <th className="p-3">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {consulta.itens.map((e) => {
                const situacao = situacaoDeEntrega(e);
                return (
                  <tr key={e.id} className="border-b border-slate-800/50 align-top last:border-0">
                    <td className="whitespace-nowrap p-3">{dataHora(e.createdAt)}</td>
                    <td className="p-3 break-all">{e.recipient}</td>
                    <td className="p-3">{nomeDoModelo(e.template)}</td>
                    <td className={`p-3 font-medium ${COR_DO_TOM[situacao.tom]}`}>{situacao.texto}</td>
                    <td className="max-w-xs p-3 text-xs text-slate-400 break-words">
                      {e.error ?? (e.sentAt ? `Saiu em ${dataHora(e.sentAt)}` : "—")}
                      {e.providerMessageId ? (
                        <span className="mt-1 block font-mono text-[10px] text-slate-600">Resend: {e.providerMessageId}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}

export default function EmailsPage() {
  return (
    <AuthGuard>
      <EmailsContent />
    </AuthGuard>
  );
}
