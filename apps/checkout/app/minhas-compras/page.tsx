"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, type Order } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { pedidoGratis, precoOuGratis } from "../../lib/preco";
import {
  erroDoNaoVou,
  SESSAO_EXPIRADA_NAO_VOU,
  textoLiberou,
  textosConfirmacaoNaoVou,
  type ErroNaoVou,
} from "../../lib/nao-vou-mais";
import { Icon, paths } from "../../components/icons";

interface PurchaseRow {
  publicToken: string;
  status: string;
  totalCents: number;
  eventTitle: string;
  startsAt: string | null;
  itemsLabel: string;
  ended: boolean;
  /** reembolso solicitado e ainda em análise — badge âmbar + botão travado */
  refundRequested?: boolean;
  /** último pedido de reembolso foi recusado (2026-10-13): o ingresso segue valendo */
  refundRejected?: boolean;
  /** motivo que a produção escreveu na recusa */
  refundRejectedNote?: string | null;
  /** ingressos do pedido (singular/plural do "Não vou mais") */
  quantidade: number;
  /**
   * "Não vou mais" (2026-10-12): pedido grátis confirmado DA CONTA logada, antes
   * do evento começar. O servidor confere tudo de novo — isto só decide o botão.
   */
  podeNaoVouMais?: boolean;
  /** a pessoa acabou de liberar a vaga por aqui */
  liberou?: { vagas: number; usados: number };
}

const STATUS_LABEL: Record<string, string> = {
  FULFILLED: "Pagamento aprovado",
  PAID: "Pagamento aprovado",
  PAYMENT_PENDING: "Aguardando pagamento",
  EXPIRED: "Expirado",
  REFUNDED: "Reembolsado",
  PARTIALLY_REFUNDED: "Parcialmente reembolsado",
  CANCELED: "Cancelado",
};

/**
 * Selo do pedido (2026-10-11). Pedido de R$ 0 não teve pagamento: aprovado vira
 * "Ingresso garantido", e um pedido de reembolso antigo não vira "Reembolso em
 * análise" — grátis se cancela, não se reembolsa (cancelado já é "Cancelado").
 */
function statusLabel(row: PurchaseRow): string {
  const aprovado = ["PAID", "FULFILLED"].includes(row.status);
  if (aprovado && row.refundRequested && !pedidoGratis(row)) return "Reembolso em análise";
  if (row.ended) return "Evento encerrado";
  if (aprovado && pedidoGratis(row)) return "Ingresso garantido";
  return STATUS_LABEL[row.status] ?? row.status;
}

/** Pedidos lembrados neste aparelho (compra como convidado). */
async function loadDeviceOrders(skip: Set<string>): Promise<PurchaseRow[]> {
  let tokens: string[] = [];
  try {
    tokens = JSON.parse(localStorage.getItem("bf.orders") ?? "[]");
  } catch {
    return [];
  }
  const rows: PurchaseRow[] = [];
  for (const token of tokens) {
    if (skip.has(token)) continue;
    try {
      const order: Order = await api.getOrderStatus(token);
      rows.push({
        publicToken: token,
        status: order.status,
        totalCents: order.totalCents,
        eventTitle: "Pedido #BF-" + token.slice(0, 8).toUpperCase(),
        startsAt: null,
        itemsLabel: (order.items ?? []).map((i) => `${i.quantity}× ingresso`).join(", "),
        ended: false,
        quantidade: (order.items ?? []).reduce((soma, i) => soma + i.quantity, 0),
        // pedido lembrado só no aparelho não é da conta logada: sem "Não vou mais"
        podeNaoVouMais: false,
      });
    } catch {
      /* pedido inacessível — ignora */
    }
  }
  return rows;
}

export default function PurchasesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<PurchaseRow[] | null>(null);
  const [refundFor, setRefundFor] = useState<string | null>(null);
  const [refundOk, setRefundOk] = useState<string | null>(null);
  const [refundReviewer, setRefundReviewer] = useState<string | null>(null);
  // clique duplo no "Confirmar solicitação" (2026-10-12): a segunda chamada nem
  // sai — o ref vale antes do próximo render; o estado trava o botão na tela
  const [refundEnviando, setRefundEnviando] = useState(false);
  const refundTravado = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // 2026-10-12: sem sessão, a lista vazia convida a entrar — quem comprou com
  // a conta não via as compras e não sabia que era só fazer login
  const [logado, setLogado] = useState(false);
  // API falhou com sessão válida: a lista pode estar incompleta
  const [falhou, setFalhou] = useState(false);
  // "Não vou mais": confirmação no próprio card (como o "Cancelar ingresso" do painel)
  const [naoVouFor, setNaoVouFor] = useState<string | null>(null);
  const [naoVouEnviando, setNaoVouEnviando] = useState(false);
  const [naoVouErro, setNaoVouErro] = useState<ErroNaoVou | null>(null);
  const naoVouTravado = useRef(false);

  useEffect(() => {
    async function load() {
      const token = localStorage.getItem("bf.token");
      let serverRows: PurchaseRow[] = [];
      if (token) {
        try {
          const orders = await api.myOrders(token);
          serverRows = orders.map((o) => ({
            publicToken: o.publicToken,
            status: o.status,
            totalCents: o.totalCents,
            eventTitle: o.event.title,
            startsAt: o.event.startsAt,
            itemsLabel: o.items.map((i) => `${i.quantity}× ${i.ticketLot.name}`).join(", "),
            ended: new Date(o.event.endsAt).getTime() < Date.now(),
            refundRequested: o.refundRequested === true,
            refundRejected: o.refundRequestStatus === "REJECTED",
            refundRejectedNote: o.refundRequestNote ?? null,
            quantidade: o.items.reduce((soma, i) => soma + i.quantity, 0),
            // /v1/me/orders só traz pedidos DESTA conta: grátis, confirmado e antes do início
            podeNaoVouMais:
              pedidoGratis(o) &&
              ["PAID", "FULFILLED"].includes(o.status) &&
              new Date(o.event.startsAt).getTime() > Date.now(),
          }));
          setLogado(true);
        } catch (e) {
          // sessão inválida (401): o convite para entrar está certo. API fora com
          // sessão válida NÃO é "nenhuma compra" (2026-10-12): avisa e deixa tentar
          if (!(e instanceof ApiError && e.status === 401)) setFalhou(true);
        }
      }
      // quem comprou como convidado e só depois entrou por OTP não aparece em
      // /v1/me/orders — por isso o aparelho é sempre consultado e as duas
      // fontes são unidas (sem repetir o mesmo pedido).
      const deviceRows = await loadDeviceOrders(new Set(serverRows.map((r) => r.publicToken)));
      setRows([...serverRows, ...deviceRows]);
    }
    load();
  }, []);

  async function requestRefund(token: string) {
    if (refundTravado.current) return;
    refundTravado.current = true;
    setRefundEnviando(true);
    setError(null);
    try {
      const created = await api.requestRefund(token, "Solicitado pelo comprador no app");
      setRefundReviewer(created.reviewedBy ?? null);
      setRefundOk(token);
      setRefundFor(null);
      // card vira "em análise" na hora, sem esperar recarregar
      setRows((prev) => prev?.map((r) => (r.publicToken === token ? { ...r, refundRequested: true, refundRejected: false } : r)) ?? prev);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível solicitar");
    } finally {
      refundTravado.current = false;
      setRefundEnviando(false);
    }
  }

  function abrirNaoVou(token: string) {
    setNaoVouErro(null);
    setNaoVouFor((atual) => (atual === token ? null : token));
  }

  /** "Não vou mais": libera a vaga do ingresso grátis. O servidor confere dono, prazo e valor. */
  async function liberarVaga(publicToken: string) {
    // clique duplo: a segunda chamada nem sai (o ref vale antes do próximo render)
    if (naoVouTravado.current) return;
    const sessao = localStorage.getItem("bf.token");
    const expirou = { mensagem: SESSAO_EXPIRADA_NAO_VOU, tipo: "sessao" as const };
    if (!sessao) {
      setNaoVouErro(expirou);
      return;
    }
    naoVouTravado.current = true;
    setNaoVouEnviando(true);
    setNaoVouErro(null);
    try {
      const feito = await api.naoVouMais(publicToken, sessao);
      setRows(
        (prev) =>
          prev?.map((r) =>
            r.publicToken === publicToken
              ? {
                  ...r,
                  status: feito.status,
                  podeNaoVouMais: false,
                  liberou: { vagas: feito.vagasLiberadas, usados: feito.ingressosUsados },
                }
              : r,
          ) ?? prev,
      );
      setNaoVouFor(null);
    } catch (e) {
      const erro = erroDoNaoVou(e, expirou);
      setNaoVouErro(erro);
      // recusa do servidor costuma ser porque o pedido mudou (o produtor cancelou,
      // outra aba liberou): relê a situação para o selo não seguir "garantido"
      if (erro.tipo === "definitivo") {
        api
          .getOrderStatus(publicToken)
          .then((o) =>
            setRows((prev) => prev?.map((r) => (r.publicToken === publicToken ? { ...r, status: o.status } : r)) ?? prev),
          )
          .catch(() => undefined);
      }
    } finally {
      naoVouTravado.current = false;
      setNaoVouEnviando(false);
    }
  }

  return (
    <main className="px-5 pb-16 pt-6 lg:mx-auto lg:max-w-[1160px] lg:px-6 lg:pb-14 lg:pt-8">
      <header className="flex items-center gap-3">
        <button onClick={() => router.back()} aria-label="Voltar" className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface lg:hidden"><Icon d={paths.back} /></button>
        <h1 className="text-[20px] font-extrabold lg:text-[24px]">Minhas compras</h1>
        <Link href="/perfil" className="ml-auto hidden text-[13px] font-bold text-primary lg:block">
          Minha conta
        </Link>
      </header>

      {falhou ? (
        <div className="mt-4 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-center">
          <p className="text-[13px] font-bold text-danger">
            Não deu para carregar suas compras agora{rows && rows.length > 0 ? " — algumas podem não aparecer" : ""}.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded-xl border border-line bg-surface px-4 py-2 text-[12.5px] font-bold text-ink"
          >
            Tentar novamente
          </button>
        </div>
      ) : null}

      {rows === null ? (
        <p className="mt-10 text-center text-[13px] text-muted">Carregando…</p>
      ) : rows.length === 0 && falhou ? null : rows.length === 0 ? (
        <div className="mt-16 text-center lg:mt-10 lg:rounded-[22px] lg:border lg:border-line lg:bg-surface lg:py-16">
          <Icon d={paths.ticket} size={48} className="mx-auto text-muted-4" />
          <p className="mt-3 text-[15px] font-bold lg:text-[17px]">Nenhuma compra por aqui</p>
          {logado ? (
            <Link href="/" className="mt-2 inline-block text-[13px] font-bold text-primary">Explorar eventos</Link>
          ) : (
            <>
              {/* /perfil é o login do site (código por e-mail) */}
              <p className="mx-auto mt-2 max-w-[360px] text-[13px] font-medium leading-relaxed text-muted">
                Comprou com sua conta BoraFest? Entre para ver suas compras e ingressos.
              </p>
              <Link href="/perfil" className="mt-4 inline-flex h-[46px] items-center rounded-[13px] bg-primary px-6 text-[14px] font-extrabold text-white shadow-cta">
                Entrar na minha conta
              </Link>
              <Link href="/" className="mt-3 block text-[13px] font-bold text-primary">Explorar eventos</Link>
            </>
          )}
        </div>
      ) : (
        <div className="mt-5 space-y-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
          {rows.map((row) => (
            <article key={row.publicToken} className={`rounded-2xl border border-line bg-surface p-4 lg:p-5 ${row.ended ? "opacity-80" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[14px] font-extrabold lg:text-[15px]">{row.eventTitle}</p>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                  row.refundRequested && ["PAID", "FULFILLED"].includes(row.status) && !pedidoGratis(row) ? "bg-warning/10 text-warning" :
                  ["PAID", "FULFILLED"].includes(row.status) ? "bg-success/10 text-success" :
                  row.status === "PAYMENT_PENDING" ? "bg-warning/10 text-warning" : "bg-line text-muted"
                }`}>
                  {statusLabel(row)}
                </span>
              </div>
              {row.startsAt && <p className="mt-0.5 text-[12px] font-medium text-muted">{formatDateTime(row.startsAt)}</p>}
              <p className="mt-1 text-[12px] font-semibold text-ink-soft">{row.itemsLabel}</p>
              <p className="mt-1 text-[15px] font-extrabold">{precoOuGratis(row.totalCents)}</p>

              {row.liberou && (
                <p className="mt-1 text-[12px] font-semibold text-muted">{textoLiberou(row.liberou)}</p>
              )}

              {/* recusa (2026-10-13): antes seguia "em análise" para sempre; o pedido
                  continua aprovado e o ingresso vale — só explica o que houve */}
              {row.refundRejected && !row.refundRequested && ["PAID", "FULFILLED"].includes(row.status) && !pedidoGratis(row) && (
                <div className="mt-3 rounded-xl bg-line p-3 text-[12px] font-semibold text-ink-soft">
                  <p className="font-bold text-ink">Pedido de reembolso recusado</p>
                  {row.refundRejectedNote && <p className="mt-0.5">Motivo: {row.refundRejectedNote}</p>}
                  <p className="mt-0.5">Seus ingressos continuam valendo. Se tiver dúvida, fale com a produção do evento.</p>
                </div>
              )}

              {refundOk === row.publicToken && (
                <div className="mt-3 rounded-xl bg-success/10 p-3 text-[12px] font-bold text-success">
                  {/* sem prazo prometido (2026-10-12): o servidor só registra o pedido
                      para análise — não há prazo de resposta aplicado em lugar nenhum */}
                  Pedido de reembolso enviado para análise{refundReviewer ? ` de ${refundReviewer}` : ""}. Até a
                  resposta, seus ingressos continuam valendo.
                </div>
              )}

              {["PAID", "FULFILLED"].includes(row.status) && !row.ended && (
                <div className="mt-3 flex gap-2">
                  <Link href={`/pedido/${row.publicToken}`} className="flex-1 rounded-xl bg-primary/10 py-2.5 text-center text-[12px] font-bold text-primary">
                    Ver ingressos
                  </Link>
                  <button
                    onClick={async () => { try { await api.resendTickets(row.publicToken); alert(process.env.NEXT_PUBLIC_WA_DELIVERY === "on" ? "Ingressos reenviados por e-mail e WhatsApp." : "Ingressos reenviados por e-mail."); } catch (e) { alert(e instanceof ApiError ? e.message : "Não foi possível reenviar agora. Tente de novo em instantes."); } }}
                    className="flex-1 rounded-xl border-[1.5px] border-line-input py-2.5 text-[12px] font-bold"
                  >
                    Reenviar ingressos
                  </button>
                  {/* pedido de R$ 0 não tem reembolso nem prazo do CDC: não houve pagamento (2026-10-11) */}
                  {!row.refundRequested && !pedidoGratis(row) && (
                    <button onClick={() => { setError(null); setRefundFor(row.publicToken); }} className="flex-1 rounded-xl border-[1.5px] border-line-input py-2.5 text-[12px] font-bold text-danger">
                      Reembolso
                    </button>
                  )}
                  {/* grátis se cancela, não se reembolsa: a própria pessoa libera a vaga até o início (2026-10-12) */}
                  {row.podeNaoVouMais && (
                    <button
                      type="button"
                      onClick={() => abrirNaoVou(row.publicToken)}
                      aria-expanded={naoVouFor === row.publicToken}
                      className="flex-1 rounded-xl border-[1.5px] border-line-input py-2.5 text-[12px] font-bold"
                    >
                      Não vou mais
                    </button>
                  )}
                </div>
              )}

              {row.podeNaoVouMais && naoVouFor === row.publicToken && ["PAID", "FULFILLED"].includes(row.status) && !row.ended && (
                <div className="mt-3 space-y-2 rounded-xl border-[1.5px] border-danger/35 bg-danger/[.06] p-3.5">
                  <p className="text-[13px] font-extrabold text-ink">{textosConfirmacaoNaoVou(row.quantidade).titulo}</p>
                  <p className="text-[12.5px] font-medium leading-relaxed text-ink-soft">
                    {textosConfirmacaoNaoVou(row.quantidade).explicacao}
                  </p>
                  {naoVouErro && (
                    <p className="text-[12.5px] font-semibold text-danger">
                      {naoVouErro.mensagem}
                      {naoVouErro.tipo === "sessao" && (
                        <>
                          {" "}
                          <Link href="/perfil" className="font-bold text-primary underline">
                            Entrar na minha conta
                          </Link>
                        </>
                      )}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => abrirNaoVou(row.publicToken)}
                      disabled={naoVouEnviando}
                      className="flex-1 rounded-xl border-[1.5px] border-line-input bg-surface py-2.5 text-[12px] font-bold disabled:opacity-40"
                    >
                      Voltar
                    </button>
                    {/* recusa do servidor (evento começou, já cancelado…) não muda tentando de novo */}
                    {naoVouErro?.tipo !== "definitivo" && (
                      <button
                        type="button"
                        onClick={() => liberarVaga(row.publicToken)}
                        disabled={naoVouEnviando}
                        className="flex-1 rounded-xl bg-danger py-2.5 text-[12px] font-bold text-white disabled:opacity-40"
                      >
                        {naoVouEnviando
                          ? "Liberando…"
                          : naoVouErro?.tipo === "tentar"
                            ? "Tentar novamente"
                            : textosConfirmacaoNaoVou(row.quantidade).botao}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {error && !refundFor && <p className="mt-3 text-center text-[12px] font-semibold text-danger">{error}</p>}

      {refundFor && (
        <div
          className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 lg:items-center"
          onClick={() => {
            if (!refundEnviando) setRefundFor(null);
          }}
        >
          <div className="w-full max-w-[430px] rounded-t-3xl bg-surface p-6 lg:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[18px] font-extrabold">Solicitar reembolso</h2>
            {/* TEXTO HONESTO (2026-10-12). Antes prometia reembolso certo para compra
                de até 7 dias e prazo de resposta do produtor — o servidor não aplica
                nenhum dos dois: só registra o pedido para análise do organizador
                (repasse instantâneo) ou da BoraFest. Aprovado, o estorno sai pelo
                gateway; só o estorno TOTAL cancela os ingressos (o parcial os mantém). */}
            <p className="mt-2 text-[13px] font-medium leading-relaxed text-muted">
              Seu pedido vai para análise do organizador do evento ou da BoraFest. Até a resposta, os ingressos
              continuam valendo. Se for aprovado, o valor aprovado volta pelo mesmo meio de pagamento — e, no
              reembolso total, os ingressos do pedido são cancelados.
            </p>
            <p className="mt-2 text-[12px] font-medium leading-relaxed text-muted-2">
              A lei dá 7 dias para desistir de compra feita pela internet (CDC art. 49).
            </p>
            {error && <p className="mt-3 text-[12.5px] font-semibold text-danger">{error}</p>}
            <button
              onClick={() => requestRefund(refundFor)}
              disabled={refundEnviando}
              className="mt-5 h-14 w-full rounded-2xl bg-danger text-[15px] font-extrabold text-white disabled:opacity-60"
            >
              {refundEnviando ? "Enviando…" : "Confirmar solicitação"}
            </button>
            <button
              onClick={() => setRefundFor(null)}
              disabled={refundEnviando}
              className="mt-2 h-12 w-full rounded-2xl border-[1.5px] border-line-input text-[14px] font-bold disabled:opacity-60"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
