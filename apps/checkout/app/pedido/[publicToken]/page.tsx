"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError, type Order, type OrderTicketsResponse, type PixelSettings } from "../../../lib/api";
import { formatCents, formatDateTime } from "../../../lib/format";
import { Icon, paths } from "../../../components/icons";
import { PixelTracker } from "../../../components/PixelTracker";
import { RevealQr } from "../../../components/RevealQr";
import { EventReview } from "../../../components/EventReview";

// entrega por WhatsApp desligada por padrão (decisão 2026-08-15): só aparece com NEXT_PUBLIC_WA_DELIVERY=on
const WA_ON = process.env.NEXT_PUBLIC_WA_DELIVERY === "on";

/** Evento do Chrome/Edge para instalar o PWA (não existe no Safari). */
type InstallPromptEvent = Event & { prompt: () => Promise<void> };

/** Máscara simples de celular BR: "(11) 91234-5678" (aceita colar com +55). */
function maskBrPhone(value: string): string {
  let d = value.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function rememberOrder(token: string) {
  try {
    const list: string[] = JSON.parse(localStorage.getItem("bf.orders") ?? "[]");
    if (!list.includes(token)) localStorage.setItem("bf.orders", JSON.stringify([token, ...list].slice(0, 20)));
  } catch {
    /* ignore */
  }
}

/**
 * Card "Baixe o app": usa o prompt nativo de instalação quando o navegador
 * oferece; sem ele (Safari/iOS, ou já instalado) leva para a home do PWA.
 */
function InstallAppCard() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  return (
    <div className="mt-[22px] flex items-center gap-3.5 rounded-2xl border border-primary/15 bg-primary/[.06] p-4 text-left">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white">
        <Icon d={paths.ticket} size={22} />
      </div>
      <p className="flex-1 text-[13px] font-medium leading-relaxed text-ink-soft">
        <b className="text-ink">Baixe o app BoraFest</b> — entre com o mesmo e-mail e seus ingressos estarão lá,
        prontos para a portaria.
      </p>
      {installPrompt ? (
        <button
          onClick={() => { installPrompt.prompt(); setInstallPrompt(null); }}
          className="h-[38px] shrink-0 rounded-[10px] bg-ink px-4 text-[12px] font-bold text-white"
        >
          Baixar app
        </button>
      ) : (
        <Link href="/" className="flex h-[38px] shrink-0 items-center rounded-[10px] bg-ink px-4 text-[12px] font-bold text-white">
          Baixar app
        </Link>
      )}
    </div>
  );
}

export default function OrderPage({ params }: { params: { publicToken: string } }) {
  const { publicToken } = params;
  const [order, setOrder] = useState<Order | null>(null);
  const [ticketsData, setTicketsData] = useState<OrderTicketsResponse | null>(null);
  const [view, setView] = useState<"confirmacao" | "carteira">("confirmacao");
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [transferFor, setTransferFor] = useState<string | null>(null);
  const [transferName, setTransferName] = useState("");
  const [transferEmail, setTransferEmail] = useState("");
  const [transferMsg, setTransferMsg] = useState<string | null>(null);
  const [whatsOpen, setWhatsOpen] = useState(false);
  const [whatsPhone, setWhatsPhone] = useState("");
  const [whatsState, setWhatsState] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [whatsError, setWhatsError] = useState<string | null>(null);
  const [pixelSettings, setPixelSettings] = useState<PixelSettings | null>(null);
  const [protectConfirm, setProtectConfirm] = useState(false);
  const [protectState, setProtectState] = useState<"idle" | "sending" | "done">("idle");
  const [protectError, setProtectError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const o = await api.getOrderStatus(publicToken);
      setOrder(o);
      if (["PAID", "FULFILLED"].includes(o.status)) {
        const t = await api.getOrderTickets(publicToken);
        setTicketsData(t);
        rememberOrder(publicToken);
      }
    } catch {
      setOrder(null);
    }
  }, [publicToken]);

  useEffect(() => {
    load();
  }, [load]);

  // pré-preenche o WhatsApp com o contato do pedido (a API pública expõe)
  useEffect(() => {
    if (order?.contactPhone) setWhatsPhone(maskBrPhone(order.contactPhone));
  }, [order?.contactPhone]);

  // pixels do evento (rota pública já cacheada) só depois que sabemos o slug pelos ingressos
  useEffect(() => {
    if (!ticketsData?.event.slug) return;
    api.getPublicEvent(ticketsData.event.slug).then((e) => setPixelSettings(e.pixelSettings)).catch(() => {});
  }, [ticketsData?.event.slug]);

  // pendente: polling
  useEffect(() => {
    if (!order || !["CREATED", "PAYMENT_PENDING"].includes(order.status)) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [order, load]);

  async function pedirReembolsoProtegido() {
    setProtectState("sending");
    setProtectError(null);
    try {
      await api.requestProtectionRefund(publicToken);
      setProtectState("done");
      const o = await api.getOrderStatus(publicToken);
      setOrder(o);
    } catch (e) {
      setProtectState("idle");
      setProtectError(e instanceof ApiError ? e.message : "Não foi possível reembolsar agora");
    }
  }

  async function resend() {
    setResendMessage(null);
    try {
      await api.resendTickets(publicToken);
      setResendMessage(WA_ON ? "Reenviado por e-mail e WhatsApp ✅" : "Reenviado por e-mail ✅");
    } catch (e) {
      setResendMessage(e instanceof ApiError ? e.message : "Não foi possível reenviar agora");
    }
  }

  async function sendWhatsApp() {
    setWhatsState("sending");
    setWhatsError(null);
    try {
      await api.sendTicketsWhatsApp(publicToken, whatsPhone.replace(/\D/g, ""));
      setWhatsState("ok");
    } catch (e) {
      setWhatsState("error");
      setWhatsError(e instanceof ApiError ? e.message : "Não foi possível enviar agora");
    }
  }

  async function doTransfer() {
    if (!transferFor) return;
    setTransferMsg(null);
    // Transferência agora exige sessão (autorização pelo dono atual do
    // ingresso — auditoria 2026-08-12). Esta página é aberta pelo token do
    // pedido; se o comprador estiver logado, usa a sessão; senão, orienta a
    // entrar (a carteira em /perfil é a superfície logada de transferência).
    const sessao = typeof window !== "undefined" ? localStorage.getItem("bf.token") : null;
    if (!sessao) {
      setTransferMsg(
        "Para transferir, entre na sua conta em Meus ingressos (perfil) — é de lá que a transferência sai com segurança.",
      );
      return;
    }
    try {
      await api.transferTicket(
        transferFor,
        { orderPublicToken: publicToken, toName: transferName, toEmail: transferEmail },
        sessao,
      );
      setTransferMsg("Ingresso transferido! O QR antigo foi invalidado.");
      setTransferFor(null);
      setTransferName("");
      setTransferEmail("");
      load();
    } catch (e) {
      setTransferMsg(e instanceof ApiError ? e.message : "Falha na transferência");
    }
  }

  if (!order) {
    return <main className="flex min-h-dvh items-center justify-center text-[13px] text-muted">Carregando pedido…</main>;
  }

  const pending = ["CREATED", "PAYMENT_PENDING"].includes(order.status);
  const shortId = `#BF-${publicToken.slice(0, 8).toUpperCase()}`;

  // --- pendente ---
  if (pending) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center lg:mx-auto lg:max-w-[560px]">
        <div className="flex h-[92px] w-[92px] items-center justify-center rounded-full bg-warning/10 text-warning">
          <Icon d={paths.clock} size={44} />
        </div>
        <h1 className="mt-5 text-[22px] font-extrabold">Aguardando pagamento</h1>
        <span className="mt-2 rounded-full bg-warning/10 px-3 py-1.5 text-[12px] font-bold text-warning">Aguardando Pix</span>
        <div className="mt-6 w-full rounded-2xl border border-line bg-surface p-4 text-left">
          <p className="text-[12px] font-bold text-muted">Pedido {shortId}</p>
          <p className="mt-1 flex items-center justify-between text-[14px] font-semibold">
            <span>Total</span><span className="font-extrabold">{formatCents(order.totalCents)}</span>
          </p>
        </div>
        <p className="mt-4 text-[12px] font-medium text-muted">Esta página atualiza sozinha quando o pagamento cair.</p>
      </main>
    );
  }

  // --- portão do 1º ingresso: conta criada no checkout ainda não verificada ---
  if (view === "carteira" && ticketsData?.requiresVerification) {
    return (
      <main className="mx-auto max-w-[430px] px-5 pb-16 pt-10">
        <VerificationGate
          publicToken={publicToken}
          contactEmail={ticketsData.contactEmail ?? order?.contactEmail ?? ""}
          onVerified={() => {
            api.getOrderTickets(publicToken).then(setTicketsData).catch(() => undefined);
          }}
        />
      </main>
    );
  }

  // --- carteira ---
  if (view === "carteira" && ticketsData) {
    return (
      <main className="px-5 pb-16 pt-6 lg:mx-auto lg:max-w-[1160px] lg:px-6 lg:pt-8">
        <div className="flex items-center gap-3">
          <button onClick={() => setView("confirmacao")} aria-label="Voltar" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface">
            <Icon d={paths.back} />
          </button>
          <div className="min-w-0">
            <h1 className="text-[22px] font-extrabold lg:text-[24px]">Seus ingressos</h1>
            <p className="mt-0.5 truncate text-[13px] font-medium text-muted">
              {order.contactName ?? order.contactEmail} · {ticketsData.tickets.length} ingresso{ticketsData.tickets.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        {WA_ON && process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ? (
          <a
            href={`https://wa.me/${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}?text=${encodeURIComponent(`Quero meu ingresso do pedido ${publicToken.slice(0, 8).toUpperCase()}`)}`}
            target="_blank"
            rel="noopener"
            className="mt-4 flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#25D366] text-[14px] font-extrabold text-white"
          >
            Receber meus ingressos no WhatsApp
          </a>
        ) : null}

        <div className="mt-5 space-y-6 lg:grid lg:grid-cols-3 lg:gap-6 lg:space-y-0">
          {ticketsData.tickets.map((ticket) => (
            <article key={ticket.id} className="overflow-hidden rounded-3xl bg-surface shadow-card">
              <div className="bg-brand-gradient p-5 text-white">
                <p className="text-[16px] font-extrabold leading-tight">{ticketsData.event.title}</p>
                <p className="mt-1 text-[12px] font-semibold text-white/85">
                  {formatDateTime(ticketsData.event.startsAt)}
                </p>
              </div>
              <div className="ticket-notch border-t-2 border-dashed border-line px-5 pb-5 pt-6 text-center">
                <div className="mx-auto w-fit rounded-2xl border border-line bg-white p-3">
                  <RevealQr value={ticket.qrToken} size={184} className="w-[184px]" />
                </div>
                <p className="mt-3 text-[15px] font-extrabold">{ticket.attendeeName ?? order.contactName ?? "Portador"}</p>
                <p className="text-[12px] font-bold text-muted">{ticket.code}</p>
                <span className="mt-2 inline-block rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">
                  {ticket.typeName} — {ticket.lotName}
                </span>
                <div className={`mt-4 grid gap-2 ${WA_ON ? "grid-cols-3" : "grid-cols-2"}`}>
                  <button disabled className="rounded-xl bg-black py-2.5 text-[11px] font-bold text-white opacity-50">Wallet · breve</button>
                  {WA_ON && (<button onClick={resend} className="rounded-xl border-[1.5px] border-line-input py-2.5 text-[11px] font-bold text-ink">WhatsApp</button>)}
                  <button
                    onClick={() => { setTransferFor(ticket.id); setTransferMsg(null); }}
                    className="rounded-xl border-[1.5px] border-line-input py-2.5 text-[11px] font-bold text-ink"
                  >
                    Transferir
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        {resendMessage && <p className="mt-3 text-center text-[12px] font-semibold text-muted">{resendMessage}</p>}
        {transferMsg && <p className="mt-3 text-center text-[12px] font-semibold text-success">{transferMsg}</p>}

        <EventReview eventId={order.eventId} endsAt={ticketsData.event.endsAt} />

        <Link href="/" className="mt-8 block text-center text-[13px] font-bold text-primary">Explorar mais eventos</Link>

        {/* bottom sheet de transferência */}
        {transferFor && (
          <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 lg:items-center" onClick={() => setTransferFor(null)}>
            <div className="w-full max-w-[430px] rounded-t-3xl bg-surface p-6 lg:rounded-3xl" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-[18px] font-extrabold">Transferir ingresso</h2>
              <p className="mt-1 text-[12px] font-medium text-muted">
                O QR atual é invalidado e um novo é gerado para a pessoa indicada.
              </p>
              <input
                value={transferName}
                onChange={(e) => setTransferName(e.target.value)}
                placeholder="Nome de quem vai usar"
                className="mt-4 h-[50px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary"
              />
              <input
                type="email"
                value={transferEmail}
                onChange={(e) => setTransferEmail(e.target.value)}
                placeholder="E-mail de quem vai usar"
                className="mt-3 h-[50px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary"
              />
              {transferMsg && <p className="mt-2 text-[12px] font-semibold text-danger">{transferMsg}</p>}
              <button
                onClick={doTransfer}
                disabled={transferName.length < 2 || !transferEmail.includes("@")}
                className="mt-4 h-14 w-full rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta disabled:bg-[#d9d2e8]"
              >
                Confirmar transferência
              </button>
            </div>
          </div>
        )}
      </main>
    );
  }

  // --- confirmação (aprovado) ---
  return (
    <main className="flex min-h-dvh flex-col bg-gradient-to-b from-emerald-50 to-bg px-6 pb-10 pt-16 text-center lg:mx-auto lg:max-w-[660px] lg:px-7 lg:pb-16 lg:pt-12">
      <PixelTracker pixelSettings={pixelSettings} purchase={{ orderId: order.id, valueCents: order.totalCents }} />
      <div className="mx-auto flex h-[92px] w-[92px] animate-pop items-center justify-center rounded-full bg-success text-white">
        <Icon d={paths.check} size={44} stroke={2.5} />
      </div>
      <h1 className="mt-5 text-[24px] font-extrabold">Pagamento aprovado!</h1>
      <span className="mx-auto mt-2 rounded-full bg-success/10 px-3 py-1.5 text-[12px] font-bold text-success">
        Pagamento confirmado
      </span>
      <p className="mx-auto mt-4 max-w-[460px] break-words text-[14px] font-medium leading-relaxed text-muted">
        Enviamos seus ingressos para <b className="text-ink">{order.contactEmail}</b>{WA_ON ? " e pelo WhatsApp" : ""} — e eles já
        estão na sua conta, que vale aqui no site e no app BoraFest.
      </p>

      <div className="mt-6 rounded-2xl border border-line bg-surface p-4 text-left">
        <p className="text-[12px] font-bold text-muted">Pedido {shortId}</p>
        <div className="mt-2 space-y-1.5">
          {(order.items ?? []).map((item, i) => (
            <p key={i} className="flex justify-between text-[13px] font-semibold text-ink-soft">
              <span>{item.quantity}× ingresso</span>
              <span>{formatCents((item.priceCents + item.feeCents) * item.quantity)}</span>
            </p>
          ))}
          {(order.discountCents ?? 0) > 0 && (
            <p className="flex justify-between text-[13px] font-bold text-success">
              <span>Desconto</span><span>−{formatCents(order.discountCents!)}</span>
            </p>
          )}
          <p className="flex justify-between border-t border-line-divider pt-2 text-[15px] font-extrabold">
            <span>Total</span><span>{formatCents(order.totalCents)}</span>
          </p>
        </div>
      </div>

      {/* entrega por WhatsApp: texto + QR de cada ingresso, direto no celular */}
      {WA_ON && (
      <div className="mt-6 text-left">
        {whatsState === "ok" ? (
          <p className="flex h-14 items-center justify-center rounded-2xl bg-success/10 text-[14px] font-extrabold text-success">
            Enviado! Confira seu WhatsApp 📱
          </p>
        ) : !whatsOpen ? (
          <button
            onClick={() => setWhatsOpen(true)}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta"
          >
            Receber meus ingressos no WhatsApp
          </button>
        ) : (
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[12px] font-bold text-muted">
              Enviaremos cada ingresso com o QR para este número
            </p>
            <input
              type="tel"
              inputMode="numeric"
              value={whatsPhone}
              onChange={(e) => setWhatsPhone(maskBrPhone(e.target.value))}
              placeholder="(11) 91234-5678"
              className="mt-2 h-[50px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary"
            />
            {whatsState === "error" && whatsError && (
              <p className="mt-2 text-[12px] font-semibold text-danger">{whatsError}</p>
            )}
            <button
              onClick={sendWhatsApp}
              disabled={whatsState === "sending" || whatsPhone.replace(/\D/g, "").length < 11}
              className="mt-3 h-14 w-full rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta disabled:bg-[#d9d2e8]"
            >
              {whatsState === "sending" ? "Enviando…" : "Enviar para o WhatsApp"}
            </button>
          </div>
        )}
      </div>
      )}

      <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:justify-center">
        <Link
          href="/perfil"
          className="flex h-14 items-center justify-center rounded-2xl border-[1.5px] border-line-input bg-surface px-7 text-[14px] font-bold text-ink lg:h-[52px] lg:rounded-[14px]"
        >
          Ver meus ingressos
        </Link>
        <button
          onClick={() => setView("carteira")}
          className="h-14 rounded-2xl border-[1.5px] border-line-input bg-surface px-6 text-[14px] font-bold text-ink lg:h-[52px] lg:rounded-[14px]"
        >
          Ingressos deste pedido
        </button>
      </div>
      {order?.protection?.canRefund && (
        <div className="mt-4 w-full rounded-2xl border-[1.5px] border-line bg-surface p-4 text-left">
          <p className="text-[13.5px] font-extrabold">Proteção de reembolso ativa</p>
          <p className="mt-1 text-[12.5px] font-medium text-muted">
            Não vai poder ir? Você pode pedir o reembolso do ingresso até o início do
            evento. A taxa da proteção não é devolvida.
          </p>
          {protectError && <p className="mt-2 text-[12.5px] font-bold text-danger">{protectError}</p>}
          {!protectConfirm ? (
            <button
              onClick={() => setProtectConfirm(true)}
              className="mt-3 h-11 rounded-xl border-[1.5px] border-primary px-5 text-[13px] font-extrabold text-primary"
            >
              Pedir reembolso do ingresso
            </button>
          ) : (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={pedirReembolsoProtegido}
                disabled={protectState === "sending"}
                className="h-11 flex-1 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta disabled:opacity-60"
              >
                {protectState === "sending" ? "Processando…" : "Confirmar reembolso"}
              </button>
              <button
                onClick={() => setProtectConfirm(false)}
                disabled={protectState === "sending"}
                className="h-11 rounded-xl border-[1.5px] border-line-input px-5 text-[13px] font-extrabold"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}
      {order?.status === "REFUNDED" && protectState === "done" && (
        <div className="mt-4 w-full rounded-2xl border-[1.5px] border-success/40 bg-success/[.06] p-4 text-left">
          <p className="text-[13.5px] font-extrabold text-success">Reembolso confirmado</p>
          <p className="mt-1 text-[12.5px] font-medium text-muted">
            O valor do ingresso está voltando pelo mesmo meio de pagamento.
          </p>
        </div>
      )}

      <Link href="/" className="mt-4 text-[13px] font-bold text-primary">Explorar mais eventos</Link>

      <InstallAppCard />
    </main>
  );
}


/** Portão do 1º ingresso: verificar o e-mail abre o QR (link mágico já foi
 *  por e-mail; aqui dá para pedir código de 6 dígitos ou corrigir o e-mail). */
function VerificationGate({
  publicToken,
  contactEmail,
  onVerified,
}: {
  publicToken: string;
  contactEmail: string;
  onVerified: () => void;
}) {
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [email, setEmail] = useState(contactEmail);
  const [message, setMessage] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setMessage(null);
    try {
      await api.requestOtp(email);
      setCodeSent(true);
      setMessage("Código enviado — confira também o spam.");
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Não foi possível enviar o código");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.verifyOtp(email, code);
      localStorage.setItem("bf.token", res.token);
      onVerified();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Código inválido");
    } finally {
      setBusy(false);
    }
  }

  async function fixEmail() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.correctOrderEmail(publicToken, newEmail);
      setEmail(res.contactEmail);
      setFixing(false);
      setCodeSent(false);
      setMessage("E-mail corrigido — reenviamos o link de acesso para o endereço novo.");
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Não foi possível corrigir o e-mail");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-3xl border border-line bg-surface p-6 text-center">
      <p className="text-[34px]">🎟️</p>
      <h1 className="mt-2 text-[20px] font-extrabold leading-tight">Seu ingresso está guardado na sua conta</h1>
      <p className="mt-2 break-words text-[13.5px] font-medium leading-relaxed text-muted">
        Enviamos um <b>link de acesso</b> para <b className="text-ink">{email}</b> — tocar nele abre o
        ingresso na hora. Se preferir, valide por código aqui:
      </p>

      {codeSent ? (
        <>
          <input
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="••••••"
            className="mt-4 h-[58px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface text-center !text-[24px] font-extrabold tracking-[10px] outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={confirmCode}
            disabled={busy || code.length !== 6}
            className="mt-3 h-13 h-14 w-full rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta disabled:bg-[#ecd6e4] disabled:shadow-none"
          >
            {busy ? "Verificando…" : "Abrir meu ingresso"}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={sendCode}
          disabled={busy}
          className="mt-4 h-14 w-full rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta disabled:opacity-60"
        >
          {busy ? "Enviando…" : "Receber código de 6 dígitos"}
        </button>
      )}

      {message ? <p className="mt-3 text-[12.5px] font-bold text-primary">{message}</p> : null}

      {fixing ? (
        <div className="mt-4 space-y-2">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="e-mail correto"
            className="h-[50px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={fixEmail}
            disabled={busy || !newEmail.includes("@")}
            className="h-11 w-full rounded-xl border border-line text-[13px] font-bold text-primary disabled:opacity-50"
          >
            Corrigir e reenviar
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setFixing(true)}
          className="mt-4 text-[12.5px] font-semibold text-muted underline"
        >
          Não recebeu? Digitou o e-mail errado? Corrija aqui
        </button>
      )}
    </div>
  );
}
