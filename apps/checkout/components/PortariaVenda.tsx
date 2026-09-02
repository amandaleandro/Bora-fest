"use client";

/**
 * Aba "Vender na porta" da portaria (2026-08-12). Venda presencial de última
 * hora, com CHECK-IN AUTOMÁTICO: o cliente paga (dinheiro ou Pix) e entra na
 * hora.
 *
 * Reuso deliberado:
 * - venda: api.createPdvCashSale / createPdvPixSale (token = sessão da conta);
 * - Pix: api.createPixPayment + api.getOrderStatus (mesmo caminho do checkout
 *   online), + react-qr-code para o QR;
 * - check-in: portariaApi.checkin — EXATAMENTE a mesma chamada que a validação
 *   usa (headers do deviceToken). Nada de check-in reimplementado.
 *
 * A venda na porta EXIGE internet: sem rede a aba é desabilitada lá na page.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { api, ApiError, type AvailabilityItem, type OrderTicket, type PdvSaleResult } from "../lib/api";
import { portariaApi } from "../lib/portaria/api";
import type { Session } from "../lib/portaria/types";

type Mode = "dinheiro" | "pix";
type Phase = "form" | "pix" | "done";

interface Props {
  eventId: string;
  slug?: string;
  /** sessão da conta (bf.token) — autoriza a venda no PDV */
  accountToken: string | null;
  /** sessão da portaria — o deviceToken faz o check-in automático */
  session: Session;
  gateId?: string;
  gateName: string;
  online: boolean;
  /** bump do contador de entradas da page a cada ingresso liberado */
  onCheckedIn?: () => void;
}

interface SaleResult {
  gratis?: boolean;
  /** false = venda de rua: ingresso enviado por e-mail, entrada no dia */
  imediata?: boolean;
  paidVia: Mode;
  buyerName: string;
  lotLabel: string;
  tickets: OrderTicket[];
  entered: number;
}

const onlyDigits = (v: string) => v.replace(/\D+/g, "");
const EMAIL_RE = /^\S+@\S+\.\S+$/;

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function PortariaVenda({
  eventId,
  slug,
  accountToken,
  session,
  gateId,
  gateName,
  online,
  onCheckedIn,
}: Props) {
  const [lots, setLots] = useState<AvailabilityItem[]>([]);
  const [loadingLots, setLoadingLots] = useState(false);
  const [lotsError, setLotsError] = useState(false);
  const [lotId, setLotId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [buyerName, setBuyerName] = useState("");
  const [buyerDocument, setBuyerDocument] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [mode, setMode] = useState<Mode>("dinheiro");
  // VENDA DE RUA (2026-08-31, pegada do Arthur): o check-in automático só faz
  // sentido NA PORTA — vender na faculdade dias antes QUEIMARIA o ingresso na
  // hora (o comprador chegaria à festa com QR já usado). Fora do dia do
  // evento, o padrão vira "enviar por e-mail" e o e-mail passa a ser
  // OBRIGATÓRIO (é o único canal de entrega). O promoter pode alternar.
  const diaDoEvento = (() => {
    const ini = session.event.startsAt ? new Date(session.event.startsAt).getTime() : null;
    const fim = session.event.endsAt ? new Date(session.event.endsAt).getTime() : null;
    if (ini === null) return true; // sessão por PIN (sem datas) é operação de porta
    const agora = Date.now();
    return agora >= ini - 12 * 3600_000 && agora <= (fim ?? ini) + 6 * 3600_000;
  })();
  const [entradaImediata, setEntradaImediata] = useState(diaDoEvento);

  const [phase, setPhase] = useState<Phase>("form");
  const [submitting, setSubmitting] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [order, setOrder] = useState<PdvSaleResult | null>(null);
  const [pixCode, setPixCode] = useState<string | null>(null);
  const [pixExpired, setPixExpired] = useState(false);
  const [result, setResult] = useState<SaleResult | null>(null);

  const stoppedRef = useRef(false);

  const carregarLotes = useCallback(() => {
    if (!accountToken) {
      setLotsError(true);
      return;
    }
    setLoadingLots(true);
    setLotsError(false);
    // fonte do BALCÃO (2026-08-31): inclui os lotes só-balcão (cortesia) que a
    // availability pública esconde de propósito
    api
      .getPdvLots(eventId, accountToken)
      .then((items) => setLots(items.filter((i) => i.available > 0)))
      .catch(() => setLotsError(true))
      .finally(() => setLoadingLots(false));
  }, [eventId, accountToken]);

  useEffect(() => {
    carregarLotes();
  }, [carregarLotes]);

  const selectedLot = lots.find((l) => l.lotId === lotId) ?? null;
  const maxQty = selectedLot ? Math.min(20, selectedLot.available) : 1;
  const unitCents = selectedLot ? selectedLot.priceCents + selectedLot.feeCents : 0;
  const totalCents = unitCents * quantity;
  // cortesia (lote R$0): não existe pagamento — só emitir e liberar a entrada
  const gratis = !!selectedLot && unitCents === 0;
  useEffect(() => {
    if (gratis) setMode("dinheiro");
  }, [gratis]);
  // pedido pendente de um Pix que falhou só vale se o formulário não mudou
  useEffect(() => {
    if (phase === "form") setOrder(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotId, quantity, buyerName, buyerEmail, buyerDocument]);

  const emailInvalido = buyerEmail.trim().length > 0 && !EMAIL_RE.test(buyerEmail.trim());
  const emailFaltando = !entradaImediata && !EMAIL_RE.test(buyerEmail.trim());
  const podeVender =
    online &&
    !!accountToken &&
    !!selectedLot &&
    buyerName.trim().length >= 2 &&
    quantity >= 1 &&
    !emailInvalido &&
    !emailFaltando &&
    !submitting;

  function montarPayload() {
    const doc = onlyDigits(buyerDocument);
    return {
      ticketLotId: selectedLot!.lotId,
      quantity,
      buyerName: buyerName.trim(),
      // schema exige 5..20; abaixo disso o campo é opcional, então omite
      buyerDocument: doc.length >= 5 ? doc : undefined,
      buyerEmail: buyerEmail.trim() || undefined,
    };
  }

  function mensagemErro(e: unknown): string {
    if (e instanceof ApiError) return e.message;
    return "Sem conexão. A venda na porta precisa de internet.";
  }

  /** Check-in automático: mesma chamada da validação, com o deviceToken. */
  const checkinPedido = useCallback(
    async (publicToken: string, paidVia: Mode, buyer: string, lotLabel: string, gratis = false, imediata = true) => {
      setCheckingIn(true);
      let tickets: OrderTicket[] = [];
      try {
        const res = await api.getOrderTickets(publicToken);
        tickets = res.tickets ?? [];
      } catch {
        /* pago mesmo assim: mostra o resultado sem a lista de ingressos */
      }

      // venda de RUA: nada de check-in — o ingresso vai por e-mail e a pessoa
      // entra no dia pelo QR na portaria (check-in agora queimaria o ingresso)
      if (!imediata) {
        if (stoppedRef.current) return;
        setResult({ gratis, imediata: false, paidVia, buyerName: buyer, lotLabel, tickets, entered: 0 });
        setCheckingIn(false);
        setSubmitting(false);
        setPhase("done");
        return;
      }

      let entered = 0;
      for (const ticket of tickets) {
        try {
          const r = await portariaApi.checkin(session, {
            qrToken: ticket.qrToken,
            checkinPointId: gateId,
            scannedAt: new Date().toISOString(),
          });
          // já validado também conta como "pode entrar" — não trava a venda
          if (r.result === "VALID") {
            entered += 1;
            onCheckedIn?.();
          } else if (r.result === "ALREADY_USED") {
            entered += 1;
          }
        } catch {
          /* erro de check-in não invalida o pagamento; segue o próximo */
        }
      }

      if (stoppedRef.current) return;
      setResult({ gratis, imediata: true, paidVia, buyerName: buyer, lotLabel, tickets, entered });
      setCheckingIn(false);
      setSubmitting(false);
      setPhase("done");
    },
    [gateId, onCheckedIn, session],
  );

  async function venderDinheiro() {
    if (!podeVender) return;
    // achado 2026-09-01: novaVenda deixa stoppedRef=true e o guard do
    // checkinPedido engolia o RESULTADO de toda venda em dinheiro seguinte —
    // spinner eterno com o dinheiro recebido e o cliente já lá dentro
    stoppedRef.current = false;
    const buyer = buyerName.trim();
    const lotLabel = `${selectedLot!.ticketTypeName} — ${selectedLot!.lotName}`;
    setSubmitting(true);
    setError(null);
    try {
      const sale = await api.createPdvCashSale(eventId, montarPayload(), accountToken!);
      await checkinPedido(sale.publicToken, "dinheiro", buyer, lotLabel, totalCents === 0, entradaImediata);
    } catch (e) {
      setError(mensagemErro(e));
      setSubmitting(false);
    }
  }

  async function venderPix() {
    if (!podeVender) return;
    stoppedRef.current = false;
    setSubmitting(true);
    setError(null);
    setPixExpired(false);
    try {
      // achado 2026-09-01: se o createPixPayment falhou, o pedido pendente já
      // existe segurando estoque — o retry REAPROVEITA em vez de criar outro
      // (o pedido órfão consumia as últimas vagas do lote). Mudou o formulário?
      // O useEffect abaixo zera `order` e cria um novo.
      const sale = order ?? (await api.createPdvPixSale(eventId, montarPayload(), accountToken!));
      setOrder(sale);
      const doc = onlyDigits(buyerDocument);
      const pix = await api.createPixPayment(sale.orderId, {
        payerDocument: doc.length >= 11 ? doc : undefined,
      });
      if (!pix.pixQrCodeText) {
        setError("Não foi possível gerar o Pix agora. Tente de novo em instantes.");
        setSubmitting(false);
        return;
      }
      setPixCode(pix.pixQrCodeText);
      setPhase("pix");
    } catch (e) {
      setError(mensagemErro(e));
    } finally {
      setSubmitting(false);
    }
  }

  function vender() {
    if (mode === "dinheiro") venderDinheiro();
    else venderPix();
  }

  // polling do Pix até aprovar (ou expirar) — check-in automático ao aprovar
  useEffect(() => {
    if (phase !== "pix" || !order) return;
    stoppedRef.current = false;
    const buyer = buyerName.trim();
    const lotLabel = selectedLot
      ? `${selectedLot.ticketTypeName} — ${selectedLot.lotName}`
      : result?.lotLabel ?? "Ingresso";
    const id = setInterval(async () => {
      try {
        const st = await api.getOrderStatus(order.publicToken);
        if (["PAID", "FULFILLED"].includes(st.status)) {
          clearInterval(id);
          await checkinPedido(order.publicToken, "pix", buyer, lotLabel, false, entradaImediata);
        } else if (["CANCELED", "EXPIRED", "REFUNDED"].includes(st.status)) {
          clearInterval(id);
          setPixExpired(true);
        }
      } catch {
        /* mantém o polling; rede pode ter oscilado */
      }
    }, 2500);
    return () => {
      stoppedRef.current = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, order]);

  function novaVenda() {
    stoppedRef.current = true;
    setPhase("form");
    setOrder(null);
    setPixCode(null);
    setPixExpired(false);
    setResult(null);
    setError(null);
    setCopied(false);
    setSubmitting(false);
    setCheckingIn(false);
    setBuyerName("");
    setBuyerDocument("");
    setBuyerEmail("");
    setQuantity(1);
    // a entrega volta ao padrão do dia (achado 2026-09-01: o "Enviar por
    // e-mail" de uma venda antecipada vazava pra venda de porta seguinte)
    setEntradaImediata(diaDoEvento);
    // atualiza a vaga dos lotes para a próxima venda
    carregarLotes();
  }

  // -------------------------------------------------------------------------

  if (!online && phase === "form") {
    return (
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-[22px] bg-warning/[.14] text-[#fbbf24]">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
            <path
              d="M3 3l18 18M8.5 8.6A9 9 0 0 0 4 11M12 5c2.4 0 4.6.9 6.3 2.3M6 14a5 5 0 0 1 3-1.7M15 12.4A5 5 0 0 1 18 14"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
            <circle cx="12" cy="18" r="1.2" fill="currentColor" />
          </svg>
        </div>
        <p className="mb-1.5 text-[17px] font-extrabold">Venda na porta precisa de internet</p>
        <p className="max-w-[280px] text-[13px] font-medium leading-relaxed text-white/50">
          O Pix e a confirmação do pagamento dependem do servidor. A validação de entrada continua
          funcionando offline nas outras abas.
        </p>
      </div>
    );
  }

  // ---- resultado: pago · pode entrar --------------------------------------
  if (phase === "done" && result) {
    return (
      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-4 pb-4">
        <div className="mx-auto mb-5 mt-2 flex h-[92px] w-[92px] items-center justify-center rounded-full bg-success">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <path d="M5 12l5 5 9-11" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="text-center text-[24px] font-extrabold leading-tight">
          {result.gratis ? "Cortesia emitida" : result.paidVia === "dinheiro" ? "Pago em dinheiro" : "Pago"}
          {result.imediata === false ? " · Enviado ✉️" : " · Pode entrar ✅"}
        </h1>
        <p className="mx-auto mt-1.5 max-w-[300px] text-center text-[13px] font-medium text-white/55">
          {result.imediata === false
            ? "O ingresso foi para o e-mail informado. No dia, é só apresentar o QR na portaria."
            : result.entered > 0
              ? `${result.entered} ${result.entered === 1 ? "ingresso liberado" : "ingressos liberados"} na portaria ${gateName}.`
              : "Pagamento confirmado. Confira o check-in no resumo."}
        </p>

        <div className="mt-6 space-y-2.5 rounded-2xl bg-white/[.06] px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[13px] font-medium text-white/55">Comprador</span>
            <span className="text-right text-[14px] font-extrabold">{result.buyerName}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[13px] font-medium text-white/55">Ingresso</span>
            <span className="text-right text-[14px] font-extrabold">{result.lotLabel}</span>
          </div>
        </div>

        {result.tickets.length > 0 && (
          <div className="mt-3 space-y-2">
            {result.tickets.map((ticket) => (
              <div
                key={ticket.id}
                className="flex items-center justify-between gap-3 rounded-2xl border-[1.5px] border-white/10 bg-white/[.05] px-4 py-3"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold">
                  {ticket.attendeeName ?? result.buyerName}
                </span>
                <span className="flex-none rounded-full bg-success/20 px-2.5 py-1 text-[11px] font-bold text-[#4ade80]">
                  {ticket.code}
                </span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={novaVenda}
          className="mt-6 h-[54px] w-full flex-none rounded-2xl bg-primary text-[16px] font-extrabold text-white shadow-cta"
        >
          Nova venda
        </button>
      </div>
    );
  }

  // ---- Pix: QR + polling ---------------------------------------------------
  if (phase === "pix") {
    return (
      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-4 pb-4 text-center">
        {pixExpired ? (
          <>
            <div className="mx-auto mb-5 mt-6 flex h-20 w-20 items-center justify-center rounded-[22px] bg-danger/[.14] text-[#fb7185]">
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-[18px] font-extrabold">Pix não confirmado</p>
            <p className="mx-auto mt-1.5 max-w-[280px] text-[13px] font-medium leading-relaxed text-white/55">
              O pagamento expirou ou foi cancelado. Nenhum ingresso foi emitido — comece uma nova venda.
            </p>
          </>
        ) : (
          <>
            <span className="mx-auto inline-flex items-center gap-2 rounded-full bg-warning/20 px-3 py-1.5 text-[12px] font-bold text-[#fbbf24]">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-warning/30 border-t-[#fbbf24]" />
              Aguardando pagamento
            </span>
            {pixCode && (
              <div className="mx-auto mt-4 w-fit rounded-3xl border border-line bg-white p-4">
                <QRCode value={pixCode} size={196} />
              </div>
            )}
            <button
              onClick={() => {
                if (!pixCode) return;
                navigator.clipboard?.writeText(pixCode);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className={`mx-auto mt-4 inline-flex h-12 items-center gap-2 rounded-2xl border-[1.5px] px-6 text-[14px] font-bold ${
                copied ? "border-success text-[#4ade80]" : "border-white/25 text-white"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                {copied ? (
                  <path d="M5 12l5 5 9-11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <>
                    <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
                    <path d="M5 15V6a2 2 0 0 1 2-2h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </>
                )}
              </svg>
              {copied ? "Código copiado!" : "Copiar código Pix"}
            </button>
            <p className="mt-4 text-[13px] font-semibold text-white/60">Total</p>
            <p className="text-[26px] font-extrabold">{formatCents(totalCents)}</p>
            <p className="mx-auto mt-3 max-w-[280px] text-[12px] font-medium leading-relaxed text-white/45">
              {checkingIn
                ? "Pagamento identificado — liberando a entrada..."
                : "Assim que o Pix cair, o ingresso é emitido e o check-in acontece sozinho."}
            </p>
          </>
        )}

        <button
          onClick={novaVenda}
          className="mt-6 h-12 w-full flex-none rounded-2xl border-[1.5px] border-white/15 text-[14px] font-bold text-white/70"
        >
          {pixExpired ? "Nova venda" : "Cancelar / nova venda"}
        </button>
      </div>
    );
  }

  // ---- formulário ----------------------------------------------------------
  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-4 pb-4">
      <h1 className="text-[20px] font-extrabold">Vender na porta</h1>
      <p className="mb-4 mt-1 text-[13px] font-medium leading-relaxed text-white/50">
        Emite o ingresso e faz o check-in na hora. Escolha o lote, informe o comprador e o pagamento.
      </p>

      {(submitting || checkingIn) && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3">
          <span className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-white/25 border-t-white" />
          <span className="text-[13px] font-bold text-white/80">
            {checkingIn ? "Liberando a entrada..." : mode === "pix" ? "Gerando Pix..." : "Registrando venda..."}
          </span>
        </div>
      )}

      {error && (
        <p className="mb-4 flex-none rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-[12.5px] font-semibold text-[#fb7185]">
          {error}
        </p>
      )}

      {/* lote */}
      <label className="mb-1.5 block text-[12px] font-bold uppercase tracking-wider text-white/40">
        Lote
      </label>
      {loadingLots ? (
        <p className="mb-4 rounded-2xl border-[1.5px] border-white/10 bg-white/[.05] px-4 py-4 text-[13px] font-semibold text-white/45">
          Carregando lotes...
        </p>
      ) : lotsError ? (
        <div className="mb-4 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-4">
          <p className="text-[13px] font-bold text-[#fbbf24]">Não foi possível carregar os lotes.</p>
          <button
            onClick={carregarLotes}
            className="mt-2 rounded-xl bg-white/10 px-4 py-2 text-[12px] font-bold text-white"
          >
            Tentar de novo
          </button>
        </div>
      ) : lots.length === 0 ? (
        <p className="mb-4 rounded-2xl border-[1.5px] border-white/10 bg-white/[.05] px-4 py-4 text-[13px] font-semibold text-white/45">
          Nenhum lote ativo com vaga para vender agora.
        </p>
      ) : (
        <div className="mb-4 space-y-2">
          {lots.map((lot) => {
            const active = lot.lotId === lotId;
            return (
              <button
                key={lot.lotId}
                onClick={() => {
                  setLotId(lot.lotId);
                  setQuantity((q) => Math.min(Math.max(1, q), Math.min(20, lot.available)));
                }}
                className={`flex w-full items-center gap-3 rounded-2xl border-[1.5px] px-4 py-3 text-left ${
                  active ? "border-primary bg-primary/10" : "border-white/10 bg-white/[.05]"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-extrabold">{lot.lotName}</span>
                  <span className="mt-0.5 block truncate text-[12px] font-medium text-white/45">
                    {lot.ticketTypeName} · {lot.available} {lot.available === 1 ? "vaga" : "vagas"}
                  </span>
                </span>
                <span className="flex-none text-[14px] font-extrabold">
                  {formatCents(lot.priceCents + lot.feeCents)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* quantidade */}
      <label className="mb-1.5 block text-[12px] font-bold uppercase tracking-wider text-white/40">
        Quantidade
      </label>
      <div className="mb-4 flex items-center gap-4">
        <button
          onClick={() => setQuantity((q) => Math.max(1, q - 1))}
          disabled={quantity <= 1}
          aria-label="Menos um"
          className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl border-[1.5px] border-white/15 bg-white/[.06] text-[22px] font-extrabold disabled:opacity-30"
        >
          −
        </button>
        <span className="min-w-[40px] text-center text-[24px] font-extrabold tabular-nums">{quantity}</span>
        <button
          onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
          disabled={!selectedLot || quantity >= maxQty}
          aria-label="Mais um"
          className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl border-[1.5px] border-white/15 bg-white/[.06] text-[22px] font-extrabold disabled:opacity-30"
        >
          +
        </button>
        {selectedLot && (
          <span className="ml-auto text-right">
            <span className="block text-[11px] font-medium text-white/45">Total</span>
            <span className="block text-[18px] font-extrabold">{formatCents(totalCents)}</span>
          </span>
        )}
      </div>

      {/* comprador */}
      <label className="mb-1.5 block text-[12px] font-bold uppercase tracking-wider text-white/40">
        Comprador
      </label>
      <input
        value={buyerName}
        onChange={(e) => setBuyerName(e.target.value)}
        placeholder="Nome do comprador (obrigatório)"
        autoCapitalize="words"
        className="mb-2.5 h-12 w-full rounded-2xl border-[1.5px] border-white/15 bg-white/[.07] px-4 text-[15px] font-semibold text-white outline-none placeholder:font-medium placeholder:text-white/30 focus:border-primary"
      />
      <input
        value={buyerDocument}
        onChange={(e) => setBuyerDocument(e.target.value)}
        placeholder="CPF (opcional)"
        inputMode="numeric"
        className="mb-2.5 h-12 w-full rounded-2xl border-[1.5px] border-white/15 bg-white/[.07] px-4 text-[15px] font-semibold text-white outline-none placeholder:font-medium placeholder:text-white/30 focus:border-primary"
      />
      <input
        value={buyerEmail}
        onChange={(e) => setBuyerEmail(e.target.value)}
        placeholder={entradaImediata ? "E-mail para enviar o ingresso (opcional)" : "E-mail do comprador (obrigatório na venda antecipada)"}
        inputMode="email"
        autoCapitalize="off"
        autoCorrect="off"
        className={`h-12 w-full rounded-2xl border-[1.5px] bg-white/[.07] px-4 text-[15px] font-semibold text-white outline-none placeholder:font-medium placeholder:text-white/30 focus:border-primary ${
          emailInvalido ? "border-danger/60" : "border-white/15"
        }`}
      />
      {emailInvalido && (
        <p className="mt-1.5 text-[12px] font-semibold text-[#fb7185]">E-mail inválido — corrija ou deixe em branco.</p>
      )}
      {emailFaltando && buyerName.trim().length >= 2 && (
        <p className="mt-1.5 text-[12px] font-semibold text-[#fbbf24]">
          Venda antecipada precisa do e-mail — é por ele que o ingresso chega.
        </p>
      )}

      {/* entrega: na porta (check-in agora) ou venda de rua (por e-mail) */}
      <label className="mb-1.5 mt-4 block text-[12px] font-bold uppercase tracking-wider text-white/40">
        Entrega
      </label>
      <div className="mb-1 grid grid-cols-2 gap-2.5">
        {([true, false] as const).map((imediata) => {
          const active = entradaImediata === imediata;
          return (
            <button
              key={String(imediata)}
              onClick={() => setEntradaImediata(imediata)}
              className={`flex h-[52px] flex-col items-center justify-center rounded-2xl border-[1.5px] text-[13px] font-extrabold leading-tight ${
                active ? "border-primary bg-primary/15 text-white" : "border-white/12 bg-white/[.05] text-white/60"
              }`}
            >
              {imediata ? "Entra agora" : "Enviar por e-mail"}
              <span className="mt-0.5 text-[10px] font-semibold opacity-60">
                {imediata ? "check-in na hora" : "entra no dia do evento"}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mb-3 text-[11px] font-medium leading-relaxed text-white/40">
        {entradaImediata
          ? diaDoEvento
            ? "Venda na porta: o ingresso é usado agora."
            : "⚠ Atenção: o evento ainda não é hoje — 'Entra agora' QUEIMA o ingresso neste momento. Pra venda antecipada, use 'Enviar por e-mail'."
          : "Venda antecipada: o ingresso vai por e-mail e continua válido pra entrar no dia."}
      </p>

      {/* modo de pagamento — cortesia (R$0) não tem pagamento */}
      {gratis ? (
        <p className="mb-5 mt-4 rounded-2xl border border-success/25 bg-success/[.08] px-4 py-3 text-[12.5px] font-semibold text-[#4ade80]">
          Lote cortesia — sem pagamento. O ingresso é emitido no nome da pessoa e a entrada é liberada na hora.
        </p>
      ) : (
      <>
      <label className="mb-1.5 mt-4 block text-[12px] font-bold uppercase tracking-wider text-white/40">
        Pagamento
      </label>
      <div className="mb-5 grid grid-cols-2 gap-2.5">
        {(["dinheiro", "pix"] as Mode[]).map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex h-[52px] items-center justify-center gap-2 rounded-2xl border-[1.5px] text-[14px] font-extrabold ${
                active ? "border-primary bg-primary/15 text-white" : "border-white/12 bg-white/[.05] text-white/60"
              }`}
            >
              {m === "dinheiro" ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="6" width="18" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
                  <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.8" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3l4.5 4.5M12 21l-4.5-4.5M3 12l4.5-4.5M21 12l-4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M8.5 8.5 12 12l3.5-3.5M8.5 15.5 12 12l3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              {m === "dinheiro" ? "Dinheiro" : "Pix"}
            </button>
          );
        })}
      </div>
      </>
      )}

      <button
        onClick={vender}
        disabled={!podeVender}
        className="h-[54px] w-full flex-none rounded-2xl bg-primary text-[16px] font-extrabold text-white shadow-cta disabled:bg-white/[.08] disabled:text-white/35 disabled:shadow-none"
      >
        {gratis
          ? "Emitir cortesia · grátis"
          : mode === "dinheiro"
            ? `Confirmar venda${selectedLot ? ` · ${formatCents(totalCents)}` : ""}`
            : `Gerar Pix${selectedLot ? ` · ${formatCents(totalCents)}` : ""}`}
      </button>
      <p className="mt-3 text-center text-[11.5px] font-medium leading-relaxed text-white/40">
        {gratis
          ? "Confira o nome — a cortesia sai no nome da pessoa e conta na sua venda."
          : mode === "dinheiro"
            ? "Recebido o dinheiro, confirme: o ingresso é emitido e o cliente entra na hora."
            : "O cliente paga o Pix na hora; a entrada é liberada assim que o pagamento cair."}
      </p>
    </div>
  );
}
