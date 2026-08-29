"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { eventControls, type CancelPreview } from "@/lib/api";

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const CONFIRMACAO = "CANCELAR";

/**
 * Cancelar o evento e devolver o dinheiro de todo mundo (2026-08-29).
 *
 * Existia reembolso pedido a pedido dentro de Vendas, mas nada para o caso que
 * o produtor mais teme: a festa não vai acontecer e todo mundo precisa receber
 * de volta. Fazer isso um a um em centenas de pedidos não é opção.
 *
 * A tela mostra a conta ANTES — quantas pessoas, quanto sai, quanto da taxa a
 * plataforma devolve e como o saldo fica depois — porque é irreversível. Os
 * reembolsos vão em lotes e a barra anda até zerar; se algum pedido falhar, ele
 * aparece nomeado em vez de sumir no silêncio.
 */
export function CancelarEvento({ eventId, jaCancelado }: { eventId: string; jaCancelado: boolean }) {
  const { token } = useAuth();
  const router = useRouter();
  const [previa, setPrevia] = useState<CancelPreview | null>(null);
  const [motivo, setMotivo] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [rodando, setRodando] = useState(false);
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [falhas, setFalhas] = useState<Array<{ orderId: string; message: string }>>([]);
  const [pronto, setPronto] = useState(false);

  async function abrir() {
    if (!token) return;
    setErro(null);
    try {
      setPrevia(await eventControls.cancelPreview(eventId, token));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar a prévia");
    }
  }

  async function cancelar() {
    if (!token || !previa) return;
    setRodando(true);
    setErro(null);
    setFalhas([]);
    const total = previa.orders;
    let feitos = 0;
    setProgresso({ feitos, total });

    try {
      // lotes até zerar: o estorno passa pelo gateway um por pedido e uma casa
      // com muitas vendas não caberia numa requisição só.
      //
      // Os que falham vão para `pular` e saem da fila (revisão 2026-08-29): sem
      // isso, um punhado de pedidos problemáticos no primeiro lote parava o
      // laço logo na primeira volta e TODO o resto ficava sem receber.
      const pular: string[] = [];
      for (let volta = 0; volta < 500; volta++) {
        const r = await eventControls.cancel(
          eventId,
          { reason: motivo.trim(), skipOrderIds: pular },
          token,
        );
        feitos += r.refundedNow;
        setProgresso({ feitos, total });
        if (r.errors.length > 0) {
          pular.push(...r.errors.map((e) => e.orderId));
          setFalhas((antes) => [...antes, ...r.errors]);
        }
        if (r.remaining === 0) break;
      }
      setPronto(true);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao cancelar");
    } finally {
      setRodando(false);
    }
  }

  if (jaCancelado && !previa) {
    return (
      <div className="mt-8 rounded-2xl border border-danger/30 bg-danger/[.04] p-4">
        <p className="text-[13.5px] font-extrabold text-danger">Evento cancelado</p>
        <p className="mt-1 text-[12.5px] font-semibold text-muted">
          Ele saiu do ar e não vende mais.
        </p>
        <button
          type="button"
          onClick={abrir}
          className="mt-3 text-[12.5px] font-extrabold text-danger underline"
        >
          Ver se ficou alguém sem receber
        </button>
      </div>
    );
  }

  return (
    <div className="mt-8 rounded-2xl border border-danger/30 bg-danger/[.04] p-4">
      <p className="text-[13.5px] font-extrabold text-danger">Cancelar o evento</p>
      <p className="mt-1 text-[12.5px] font-semibold text-muted">
        Tira o evento do ar e devolve o dinheiro de todo mundo que comprou. Não tem como desfazer.
      </p>

      {!previa ? (
        <button
          type="button"
          onClick={abrir}
          className="mt-3 h-11 rounded-xl border-[1.5px] border-danger px-5 text-[13.5px] font-extrabold text-danger"
        >
          Cancelar evento
        </button>
      ) : (
        <div className="mt-4 rounded-xl border border-line bg-surface p-4">
          {previa.orders === 0 ? (
            <p className="text-[13px] font-bold">
              {previa.alreadyCanceled
                ? "Todo mundo já recebeu de volta. Não ficou ninguém para trás."
                : "Ninguém comprou ainda — cancelar só tira o evento do ar."}
            </p>
          ) : (
            <>
              <p className="text-[13px] font-bold">
                {previa.orders === 1
                  ? "1 pessoa recebe o dinheiro de volta"
                  : `${previa.orders} pessoas recebem o dinheiro de volta`}
              </p>
              <dl className="mt-3 space-y-1.5 text-[12.5px] font-semibold">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Vai ser devolvido</dt>
                  <dd className="font-extrabold tabular-nums">{brl(previa.refundTotalCents)}</dd>
                </div>
                {previa.feeBackCents > 0 && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">A BoraFest devolve a taxa dela</dt>
                    <dd className="font-extrabold tabular-nums text-success">
                      +{brl(previa.feeBackCents)}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-3 border-t border-line-divider pt-1.5">
                  <dt className="text-muted">Seu saldo depois</dt>
                  <dd
                    className={`font-extrabold tabular-nums ${
                      previa.balanceAfterCents < 0 ? "text-danger" : ""
                    }`}
                  >
                    {brl(previa.balanceAfterCents)}
                  </dd>
                </div>
              </dl>
              {previa.balanceAfterCents < 0 && (
                <p className="mt-3 rounded-lg bg-warning/10 p-2.5 text-[12px] font-bold text-warning">
                  Seu saldo fica negativo em {brl(Math.abs(previa.balanceAfterCents))} porque parte
                  desse dinheiro já foi sacada. As pessoas recebem mesmo assim, e novos saques ficam
                  bloqueados até o saldo voltar ao positivo.
                </p>
              )}
            </>
          )}

          {/* Um evento sem venda nenhuma TAMBÉM precisa poder ser cancelado —
              antes o botão vivia atrás de orders > 0 e o produtor ficava sem
              caminho nenhum, com o evento publicado e vendendo. */}
          {(previa.orders > 0 || !previa.alreadyCanceled) && (
            <>
              <label className="mt-4 mb-1.5 block text-[12px] font-bold text-muted">
                Por que está cancelando?{previa.orders > 0 ? " O comprador vai ler isso." : ""}
              </label>
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: problema na casa de shows"
                className="h-12 w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-3.5 text-[14px] font-bold outline-none focus:border-primary"
              />

              <label className="mt-3 mb-1.5 block text-[12px] font-bold text-muted">
                Digite <span className="font-extrabold text-danger">{CONFIRMACAO}</span> para
                confirmar
              </label>
              <input
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value.toUpperCase())}
                className="h-12 w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-3.5 text-[14px] font-bold outline-none focus:border-danger"
              />
            </>
          )}

          {progresso && (
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-danger transition-[width] duration-300"
                  style={{
                    width: `${progresso.total ? (progresso.feitos / progresso.total) * 100 : 100}%`,
                  }}
                />
              </div>
              <p className="mt-1.5 text-[12px] font-bold text-muted">
                {progresso.feitos} de {progresso.total} reembolsados
              </p>
            </div>
          )}

          {falhas.length > 0 && (
            <div className="mt-3 rounded-lg bg-danger/10 p-2.5">
              <p className="text-[12px] font-extrabold text-danger">
                {falhas.length} não deu para devolver automaticamente:
              </p>
              <ul className="mt-1 space-y-0.5">
                {falhas.slice(0, 5).map((f) => (
                  <li key={f.orderId} className="text-[11.5px] font-semibold text-danger/85">
                    {f.orderId.slice(0, 8)} — {f.message}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11.5px] font-semibold text-muted">
                Dá para tentar de novo pedido a pedido na aba Vendas.
              </p>
            </div>
          )}

          {erro && <p className="mt-3 text-[12.5px] font-bold text-danger">{erro}</p>}
          {pronto && falhas.length === 0 && (
            <p className="mt-3 text-[12.5px] font-bold text-success">
              Evento cancelado e todo mundo reembolsado.
            </p>
          )}

          <div className="mt-4 flex gap-2.5">
            {(previa.orders > 0 || !previa.alreadyCanceled) && (
              <button
                type="button"
                onClick={cancelar}
                disabled={rodando || confirmacao !== CONFIRMACAO || motivo.trim().length < 3}
                className={`h-12 flex-1 rounded-2xl text-[13.5px] font-extrabold text-white ${
                  rodando || confirmacao !== CONFIRMACAO || motivo.trim().length < 3
                    ? "cursor-not-allowed bg-danger/40"
                    : "bg-danger"
                }`}
              >
                {rodando
                  ? "Devolvendo…"
                  : previa.orders > 0
                    ? "Cancelar e devolver tudo"
                    : "Cancelar evento"}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setPrevia(null);
                setProgresso(null);
                setPronto(false);
                setFalhas([]);
              }}
              disabled={rodando}
              className="h-12 rounded-2xl border border-line px-5 text-[13.5px] font-extrabold"
            >
              {pronto ? "Fechar" : "Voltar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
