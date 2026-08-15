"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import { api, ApiError } from "../../lib/api";
import { formatCents, formatDateTime } from "../../lib/format";
import { Icon, paths } from "../../components/icons";

const PANEL = process.env.NEXT_PUBLIC_PANEL_URL ?? "http://localhost:3001";
/** versão vigente do aceite de Termos/Privacidade (handoff v2) */
const CONSENT_VERSION = "v2026-07";

type Section = "ingressos" | "compras" | "dados" | "legal";
type MyTicket = Awaited<ReturnType<typeof api.myTickets>>[number];
type MyOrder = Awaited<ReturnType<typeof api.myOrders>>[number];
type Profile = Awaited<ReturnType<typeof api.myProfile>>;

/** dígitos verificadores do CPF — barra typo antes de ir ao servidor */
function isValidCpf(raw: string): boolean {
  const cpf = raw.replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i += 1) sum += Number(cpf[i]) * (len + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(cpf[len])) return false;
  }
  return true;
}

const MENU: Array<{ id: Section; label: string }> = [
  { id: "ingressos", label: "Meus ingressos" },
  { id: "compras", label: "Minhas compras" },
  { id: "dados", label: "Dados pessoais" },
  { id: "legal", label: "Privacidade & Termos" },
];

const ORDER_STATUS: Record<string, string> = {
  FULFILLED: "Aprovado",
  PAID: "Aprovado",
  CREATED: "Aguardando pagamento",
  PAYMENT_PENDING: "Aguardando pagamento",
  EXPIRED: "Expirado",
  REFUNDED: "Reembolsado",
  PARTIALLY_REFUNDED: "Parcialmente reembolsado",
  CANCELED: "Cancelado",
};

const APPROVED = ["PAID", "FULFILLED"];

/** "25 jul 2026" — data curta usada nos cabeçalhos de pedido. */
function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  })
    .format(new Date(iso))
    .replace(/\./g, "");
}

function initials(name: string | null, email: string | null): string {
  const parts = (name ?? email ?? "?").trim().split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Interruptor do handoff: trilho 44×25, botão 19px. */
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[25px] w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-success" : "bg-[#d9d2e8]"}`}
    >
      <span className={`absolute top-[3px] h-[19px] w-[19px] rounded-full bg-white transition-all ${checked ? "left-[22px]" : "left-[3px]"}`} />
    </button>
  );
}

function OrganizerCard() {
  return (
    <div className="rounded-[18px] bg-[#17131f] p-[18px]">
      <p className="text-[14px] font-extrabold leading-tight text-white">Também organiza eventos?</p>
      <p className="mt-1.5 text-[12px] font-medium leading-relaxed text-white/55">
        Ative o perfil de produtor nesta mesma conta.
      </p>
      <a
        href={`${PANEL}/cadastro`}
        className="mt-3 flex h-[42px] w-full items-center justify-center rounded-[11px] bg-primary text-[13px] font-bold text-white"
      >
        Produza seu evento
      </a>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [section, setSection] = useState<Section>("ingressos");

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tickets, setTickets] = useState<MyTicket[] | null>(null);
  const [orders, setOrders] = useState<MyOrder[] | null>(null);
  const [resentFor, setResentFor] = useState<string | null>(null);

  // transferência de ingresso (painel inline por cartão)
  const [transferFor, setTransferFor] = useState<string | null>(null); // ticket.id com painel aberto
  const [transferEmail, setTransferEmail] = useState("");
  // transferência POR CPF (decisão 2026-08-15): o ingresso passa pro nome+CPF de quem recebe
  const [transferCpf, setTransferCpf] = useState("");
  // convite de promoter pendente — o aceite é no PAINEL; aqui só avisamos
  const [promoterInvites, setPromoterInvites] = useState(0);
  // verificação da conta (CPF em Dados pessoais)
  const [cpfInput, setCpfInput] = useState("");
  const [cpfSaving, setCpfSaving] = useState(false);
  const [cpfMsg, setCpfMsg] = useState<string | null>(null);
  const [transferSending, setTransferSending] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferNeedsAccount, setTransferNeedsAccount] = useState(false); // 404: destino sem conta
  const [transferredTo, setTransferredTo] = useState<string | null>(null); // e-mail destino do sucesso

  const [waNotif, setWaNotif] = useState(true);
  const [emailOffers, setEmailOffers] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("bf.token");
    setToken(t);
    setWaNotif(localStorage.getItem("bf.pref.wa") !== "off");
    setEmailOffers(localStorage.getItem("bf.pref.offers") === "on");
    if (!t) return;
    api
      .myProfile(t)
      .then((p) => {
        setProfile(p);
        // a conta manda nas preferências; o localStorage é só espelho local
        if (typeof p.notifyWhatsapp === "boolean") setWaNotif(p.notifyWhatsapp);
        if (typeof p.notifyEmailOffers === "boolean") setEmailOffers(p.notifyEmailOffers);
      })
      .catch(() => {
        // sessão inválida: limpa o token (comportamento original)
        localStorage.removeItem("bf.token");
        setToken(null);
      });
    api
      .myPromoterInvites(t)
      .then((inv) => setPromoterInvites(inv.length))
      .catch(() => undefined);
  }, []);

  // carrega cada aba na primeira visita (o ref evita disparar de novo enquanto a resposta não chega)
  const requested = useRef<Set<Section>>(new Set());
  useEffect(() => {
    if (!token) return;
    if (section === "ingressos" && !requested.current.has("ingressos")) {
      requested.current.add("ingressos");
      api.myTickets(token).then(setTickets).catch(() => setTickets([]));
    }
    if (section === "compras" && !requested.current.has("compras")) {
      requested.current.add("compras");
      api.myOrders(token).then(setOrders).catch(() => setOrders([]));
    }
  }, [token, section]);

  async function login() {
    setError(null);
    try {
      if (!otpSent) {
        await api.requestOtp(email);
        setOtpSent(true);
      } else {
        const res = await api.verifyOtp(email, code);
        localStorage.setItem("bf.token", res.token);
        setToken(res.token);
        setProfile(await api.myProfile(res.token));
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha no login");
    }
  }

  /** Preferência é de conta (handoff §8): grava na API e espelha no aparelho. */
  async function savePrefs(next: { notifyWhatsapp: boolean; notifyEmailOffers: boolean }) {
    setWaNotif(next.notifyWhatsapp);
    setEmailOffers(next.notifyEmailOffers);
    localStorage.setItem("bf.pref.wa", next.notifyWhatsapp ? "on" : "off");
    localStorage.setItem("bf.pref.offers", next.notifyEmailOffers ? "on" : "off");
    if (!token) return;
    try {
      await api.updatePreferences(token, next);
    } catch {
      /* rota ainda não publicada (404): o espelho local basta */
    }
  }

  async function downloadData() {
    if (!token) return;
    const data = await api.myDataExport(token);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "meus-dados-borafest.json";
    a.click();
  }

  async function deleteAccount() {
    if (!token) return;
    try {
      await api.deleteAccount(token);
      localStorage.clear();
      router.push("/");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao excluir");
    }
  }

  function logout() {
    localStorage.removeItem("bf.token");
    setToken(null);
    setProfile(null);
    setTickets(null);
    setOrders(null);
    requested.current.clear();
  }

  function openTransfer(ticketId: string) {
    setTransferFor(ticketId);
    setTransferEmail("");
    setTransferError(null);
    setTransferNeedsAccount(false);
    setTransferredTo(null);
  }

  function closeTransfer() {
    setTransferFor(null);
    setTransferEmail("");
    setTransferError(null);
    setTransferNeedsAccount(false);
  }

  async function doTransfer(ticket: MyTicket) {
    const toCpf = transferCpf.replace(/\D/g, "");
    setTransferError(null);
    setTransferNeedsAccount(false);
    if (toCpf.length !== 11) {
      setTransferError("Informe o CPF da conta destino (11 dígitos)");
      return;
    }
    if (!isValidCpf(toCpf)) {
      setTransferError("CPF inválido — confira os números digitados");
      return;
    }
    const cpfExibicao = `${toCpf.slice(0, 3)}.***.***-${toCpf.slice(9)}`;
    const ok = window.confirm(
      `Transferir o ingresso de ${ticket.event.title} para o CPF ${cpfExibicao}?\n\nO ingresso passa para o nome e CPF de quem recebe, o QR atual deixa de valer e a ação não pode ser desfeita.`,
    );
    if (!ok) return;
    if (!token) {
      setTransferError("Sessão expirada — entre novamente para transferir");
      return;
    }
    setTransferSending(true);
    try {
      await api.transferTicket(ticket.id, { orderPublicToken: ticket.orderPublicToken, toCpf }, token);
      const keptInWallet = (profile?.cpf ?? "") === toCpf;
      setTransferredTo(cpfExibicao);
      setTransferFor(null);
      setTransferCpf("");
      if (!keptInWallet) {
        setTickets((prev) => (prev ? prev.filter((t) => t.id !== ticket.id) : prev));
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // destino ainda não tem conta BoraFest: aviso amigável em vez de erro
        setTransferNeedsAccount(true);
        setTransferError(e.message);
      } else {
        setTransferError(e instanceof ApiError ? e.message : "Não foi possível transferir agora");
      }
    } finally {
      setTransferSending(false);
    }
  }

  async function resend(publicToken: string) {
    setResentFor(null);
    try {
      await api.resendTickets(publicToken);
      setResentFor(publicToken);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível reenviar agora");
    }
  }

  // --- não logado: login por código -----------------------------------------
  if (!token) {
    return (
      <main className="px-5 pb-16 pt-6 lg:mx-auto lg:max-w-[1160px] lg:px-6 lg:pt-14">
        <div className="lg:mx-auto lg:w-[440px] lg:rounded-3xl lg:border lg:border-line lg:bg-surface lg:p-8 lg:shadow-card">
          <header className="flex items-center gap-3">
            <button onClick={() => router.back()} aria-label="Voltar" className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface lg:hidden"><Icon d={paths.back} /></button>
            <h1 className="text-[20px] font-extrabold lg:text-[21px]">Entrar na BoraFest</h1>
          </header>
          <p className="mt-4 text-[13px] font-medium leading-relaxed text-muted lg:mt-3 lg:text-[13.5px]">
            Sem senha: enviamos um código para o seu e-mail. A mesma conta vale aqui no site e no app.
          </p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@email.com"
            className="mt-4 h-[50px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary"
          />
          {otpSent && (
            <input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="Código de 6 dígitos"
              className="mt-3 h-[56px] w-full rounded-2xl border-[1.5px] border-line-input bg-surface px-4 text-center text-[20px] font-extrabold tracking-[8px] outline-none focus:border-primary"
            />
          )}
          {error && <p className="mt-2 text-[12px] font-semibold text-danger">{error}</p>}
          <button onClick={login} className="mt-4 h-14 w-full rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta">
            {otpSent ? "Entrar" : "Receber código"}
          </button>
          <p className="mt-5 text-center text-[12px] font-medium text-muted-2">
            Organizador?{" "}
            <a href={`${PANEL}/login`} className="font-bold text-primary">Acesse o painel do produtor</a>
          </p>
        </div>
      </main>
    );
  }

  // --- logado: hub ----------------------------------------------------------
  return (
    <main className="px-5 pb-16 pt-6 lg:mx-auto lg:max-w-[1160px] lg:px-6 lg:pb-14 lg:pt-8">
      <header className="flex items-center gap-3 lg:mb-6 lg:justify-between lg:gap-0">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} aria-label="Voltar" className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface lg:hidden"><Icon d={paths.back} /></button>
          <h1 className="text-[20px] font-extrabold lg:text-[24px]">Minha conta</h1>
        </div>
        <span className="hidden text-[12px] font-semibold text-muted-2 lg:block">Conta única · vale no site e no app</span>
      </header>

      <div className="lg:flex lg:items-start lg:gap-[22px]">
        {/* menu lateral (desktop) / cabeçalho + abas (mobile) */}
        <aside className="lg:w-[280px] lg:shrink-0 lg:space-y-3">
          <div className="mt-5 flex items-center gap-3.5 rounded-[18px] border border-line bg-surface p-[18px] lg:mt-0">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-[16px] font-extrabold text-white">
              {initials(profile?.name ?? null, profile?.email ?? null)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-extrabold leading-tight">{profile?.name ?? "Sem nome"}</p>
              <p className="mt-0.5 truncate text-[11.5px] font-medium text-muted-2">{profile?.email}</p>
            </div>
          </div>

          <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:mt-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:rounded-[18px] lg:border lg:border-line lg:bg-surface lg:pb-0">
            {MENU.map((item) => (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={`shrink-0 rounded-xl px-4 py-2.5 text-[13px] font-bold lg:w-full lg:rounded-none lg:border-b lg:border-line-divider lg:px-4 lg:py-3.5 lg:text-left ${
                  section === item.id ? "bg-primary text-white lg:bg-primary/[.07] lg:text-primary" : "bg-surface text-muted lg:bg-transparent lg:text-ink-soft"
                }`}
              >
                {item.label}
                {item.id === "dados" && profile && !profile.cpf ? (
                  <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-warning text-[10px] font-extrabold text-white">!</span>
                ) : null}
              </button>
            ))}
            <button onClick={logout} className="hidden px-4 py-3.5 text-left text-[13px] font-semibold text-danger lg:block">
              Sair
            </button>
          </nav>

          <div className="hidden lg:block">
            <OrganizerCard />
          </div>
        </aside>

        {/* conteúdo */}
        <div className="mt-6 lg:mt-0 lg:flex-1">
          {section === "ingressos" && (
            <section>
              {promoterInvites > 0 && (
                <a
                  // conta é ÚNICA: quem já tem senha vai direto ao login do
                  // painel; 1º acesso cria a senha (link seguro por e-mail)
                  href={
                    profile?.hasPassword
                      ? `${process.env.NEXT_PUBLIC_PANEL_URL ?? "https://painel.borafest.com.br"}/login`
                      : `${process.env.NEXT_PUBLIC_PANEL_URL ?? "https://painel.borafest.com.br"}/recuperar?email=${encodeURIComponent(profile?.email ?? "")}&novo=1`
                  }
                  className="mb-3.5 block rounded-2xl border border-primary/30 bg-primary/[.06] p-3.5"
                >
                  <span className="block text-[13px] font-extrabold text-primary">
                    Você foi convidada(o) para ser promoter! 🎉
                  </span>
                  <span className="mt-0.5 block text-[12px] font-semibold leading-relaxed text-ink-soft">
                    {profile?.hasPassword
                      ? "Aceite no painel — entre com este mesmo e-mail e sua senha. Toque aqui →"
                      : "Primeiro acesso ao painel: toque aqui, crie sua senha (mesma conta, mesmo e-mail) e aceite o convite →"}
                  </span>
                </a>
              )}
              {profile && !profile.cpf && (
                <button
                  type="button"
                  onClick={() => setSection("dados")}
                  className="mb-3.5 w-full rounded-2xl border border-warning/40 bg-warning/10 p-3.5 text-left"
                >
                  <span className="block text-[13px] font-extrabold text-warning">Verifique sua conta</span>
                  <span className="mt-0.5 block text-[12px] font-semibold leading-relaxed text-ink-soft">
                    Informe seu CPF em Dados pessoais para <b>receber ingressos transferidos</b> e agilizar a
                    portaria. Toque aqui — leva 10 segundos →
                  </span>
                </button>
              )}
              {transferredTo && (
                <p className="mb-3.5 rounded-2xl bg-success/10 p-3.5 text-[12.5px] font-bold leading-relaxed text-success break-words">
                  Ingresso transferido para {transferredTo} — já está na conta dela 🎟️
                </p>
              )}
              {tickets === null ? (
                <p className="py-10 text-center text-[13px] text-muted">Carregando seus ingressos…</p>
              ) : tickets.length === 0 ? (
                <div className="rounded-[22px] border border-line bg-surface px-8 py-14 text-center">
                  <div className="mx-auto flex h-[110px] w-[110px] items-center justify-center rounded-[30px] bg-[#efedf5] text-muted-4">
                    <Icon d={paths.ticket} size={54} stroke={1.6} />
                  </div>
                  <p className="mt-6 text-[19px] font-extrabold">Você ainda não tem ingressos</p>
                  <p className="mx-auto mt-2 max-w-[380px] text-[14px] font-medium leading-relaxed text-muted">
                    Quando você comprar, seus ingressos aparecem aqui com QR code pronto para a portaria.
                  </p>
                  <Link href="/" className="mt-6 inline-flex h-[50px] items-center rounded-[14px] bg-primary px-7 text-[15px] font-extrabold text-white shadow-cta">
                    Explorar eventos
                  </Link>
                </div>
              ) : (
                <div className="space-y-3.5">
                  {tickets.map((ticket) => (
                    <article key={ticket.id} className="overflow-hidden rounded-[22px] border border-line bg-surface lg:flex">
                      <div className="bg-brand-gradient p-5 lg:flex lg:w-[240px] lg:shrink-0 lg:flex-col lg:justify-center">
                        <p className="text-[16px] font-extrabold leading-tight text-white">{ticket.event.title}</p>
                        <p className="mt-1.5 text-[11.5px] font-semibold text-white/80">{formatDateTime(ticket.event.startsAt)}</p>
                      </div>
                      <div className="flex flex-col items-center gap-4 border-t border-dashed border-line p-5 text-center lg:flex-1 lg:flex-row lg:items-center lg:gap-[18px] lg:border-l lg:border-t-0 lg:px-[22px] lg:text-left">
                        <div className={`shrink-0 rounded-xl border border-line bg-white p-2 ${
                          ["CANCELED", "REFUNDED"].includes(ticket.status) ? "opacity-25" : ""
                        }`}>
                          <QRCode value={ticket.qrToken} size={140} className="h-auto w-[140px] lg:w-[88px]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap justify-center gap-2 lg:justify-start">
                            <span className="rounded-full bg-primary/[.09] px-2.5 py-1.5 text-[11px] font-bold text-primary">
                              {ticket.typeName} · {ticket.lotName}
                            </span>
                            <span className={`rounded-full px-2.5 py-1.5 text-[11px] font-bold ${
                              ticket.status === "CHECKED_IN" ? "bg-line text-muted-2" :
                              ["CANCELED", "REFUNDED"].includes(ticket.status) ? "bg-danger/10 text-danger" :
                              "bg-success/10 text-success"
                            }`}>
                              {ticket.status === "CHECKED_IN" ? "Utilizado" :
                                ticket.status === "REFUNDED" ? "Reembolsado" :
                                ticket.status === "CANCELED" ? "Cancelado" : "Válido"}
                            </span>
                          </div>
                          <p className="mt-2 truncate text-[15px] font-extrabold">{ticket.attendeeName ?? profile?.name ?? "Portador"}</p>
                          <p className="mt-1 text-[12px] font-medium text-muted-2">Código {ticket.code}</p>
                          {["CANCELED", "REFUNDED"].includes(ticket.status) && (
                            <p className="mt-2 text-[12px] font-semibold text-danger">
                              Este ingresso foi {ticket.status === "REFUNDED" ? "reembolsado" : "cancelado"} — o QR não vale na portaria.
                            </p>
                          )}
                          <div className={`mt-3 flex flex-wrap justify-center gap-2 lg:justify-start ${
                            ["CANCELED", "REFUNDED"].includes(ticket.status) ? "hidden" : ""
                          }`}>
                            <button disabled className="h-10 rounded-[11px] bg-ink px-[15px] text-[12px] font-bold text-white opacity-50">
                              Apple/Google Wallet · em breve
                            </button>
                            <Link href="/minhas-compras" className="flex h-10 items-center rounded-[11px] border-[1.5px] border-line-input px-[15px] text-[12px] font-bold text-ink">
                              Reenviar
                            </Link>
                            {ticket.transferable && (
                              <button
                                onClick={() => (transferFor === ticket.id ? closeTransfer() : openTransfer(ticket.id))}
                                className="h-10 rounded-[11px] border-[1.5px] border-line-input px-[15px] text-[12px] font-bold text-ink"
                              >
                                Transferir
                              </button>
                            )}
                          </div>
                          {transferFor === ticket.id && (
                            <div className="mt-3 rounded-2xl border border-line bg-[#faf9fd] p-4 text-left">
                              <p className="text-[12px] font-semibold leading-relaxed text-ink-soft">
                                Transferência por CPF: o ingresso passa para o <b>nome e CPF</b> de quem recebe e o
                                QR antigo deixa de valer. A pessoa precisa ter conta BoraFest <b>verificada</b> (CPF
                                em Dados pessoais).
                              </p>
                              <input
                                inputMode="numeric"
                                value={transferCpf}
                                onChange={(e) => setTransferCpf(e.target.value.replace(/\D/g, "").slice(0, 11))}
                                placeholder="CPF da conta destino (só números)"
                                disabled={transferSending}
                                className="mt-3 h-12 w-full rounded-xl border-[1.5px] border-line-input bg-surface px-3.5 text-[13px] font-medium outline-none focus:border-primary"
                              />
                              {transferError &&
                                (transferNeedsAccount ? (
                                  <p className="mt-2.5 rounded-xl bg-warning/10 p-3 text-[12px] font-semibold leading-relaxed text-warning">
                                    {transferError} Dica: compartilhe borafest.com.br/perfil — criar a conta e
                                    informar o CPF em Dados pessoais leva menos de um minuto.
                                  </p>
                                ) : (
                                  <p className="mt-2.5 text-[12px] font-semibold leading-relaxed text-danger">{transferError}</p>
                                ))}
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  onClick={() => doTransfer(ticket)}
                                  disabled={transferSending}
                                  className="h-11 rounded-xl bg-primary px-[18px] text-[13px] font-bold text-white disabled:opacity-60"
                                >
                                  {transferSending ? "Enviando…" : "Confirmar transferência"}
                                </button>
                                <button
                                  onClick={closeTransfer}
                                  disabled={transferSending}
                                  className="h-11 rounded-xl border-[1.5px] border-line-input px-[18px] text-[13px] font-bold text-ink disabled:opacity-60"
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {section === "compras" && (
            <section>
              {orders === null ? (
                <p className="py-10 text-center text-[13px] text-muted">Carregando suas compras…</p>
              ) : orders.length === 0 ? (
                <div className="rounded-[22px] border border-line bg-surface px-8 py-12 text-center">
                  <Icon d={paths.ticket} size={44} className="mx-auto text-muted-4" />
                  <p className="mt-4 text-[17px] font-extrabold">Nenhuma compra nesta conta</p>
                  <p className="mx-auto mt-2 max-w-[420px] text-[13.5px] font-medium leading-relaxed text-muted">
                    Comprou como convidado antes de entrar? As compras feitas neste aparelho continuam acessíveis.
                  </p>
                  <div className="mt-6 flex flex-wrap justify-center gap-2.5">
                    <Link href="/" className="flex h-[46px] items-center rounded-[13px] bg-primary px-6 text-[14px] font-extrabold text-white shadow-cta">
                      Explorar eventos
                    </Link>
                    <Link href="/minhas-compras" className="flex h-[46px] items-center rounded-[13px] border-[1.5px] border-line-input px-6 text-[14px] font-bold text-ink">
                      Compras deste aparelho
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="space-y-3.5">
                  {orders.map((order) => {
                    const ended = new Date(order.event.endsAt).getTime() < Date.now();
                    const qty = order.items.reduce((sum, i) => sum + i.quantity, 0);
                    return (
                      <article key={order.id} className={`rounded-[20px] border border-line bg-surface p-[22px] ${ended ? "opacity-85" : ""}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[12.5px] font-bold text-muted-2">
                            #BF-{order.publicToken.slice(0, 8).toUpperCase()} · {shortDate(order.createdAt)}
                          </span>
                          <span className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${
                            order.refundRequested && APPROVED.includes(order.status) ? "bg-warning/10 text-warning" :
                            ended ? "bg-line text-muted-2" :
                            APPROVED.includes(order.status) ? "bg-success/10 text-success" :
                            order.status === "PAYMENT_PENDING" || order.status === "CREATED" ? "bg-warning/10 text-warning" :
                            order.status === "REFUNDED" ? "bg-danger/10 text-danger" :
                            "bg-line text-muted-2"
                          }`}>
                            {order.refundRequested && APPROVED.includes(order.status)
                              ? "Reembolso em análise"
                              : ended ? "Evento encerrado" : ORDER_STATUS[order.status] ?? order.status}
                          </span>
                        </div>
                        <p className="mt-3 text-[16px] font-extrabold leading-tight">{order.event.title}</p>
                        <p className="mt-1 text-[12.5px] font-medium text-muted-2">
                          {formatDateTime(order.event.startsAt)} · {qty} ingresso{qty === 1 ? "" : "s"}
                        </p>
                        <div className="mt-3.5 space-y-2 border-t border-dashed border-line pt-3">
                          {order.items.map((item, i) => (
                            <p key={i} className="text-[13px] font-semibold text-ink-soft">
                              {item.quantity}× {item.ticketLot.name}
                            </p>
                          ))}
                          {order.discountCents > 0 && (
                            <p className="flex justify-between text-[13px] font-bold text-success">
                              <span>Desconto</span><span>−{formatCents(order.discountCents)}</span>
                            </p>
                          )}
                          <p className="flex justify-between border-t border-line-divider pt-2.5 text-[15px] font-extrabold">
                            <span>Total</span><span>{formatCents(order.totalCents)}</span>
                          </p>
                        </div>
                        {resentFor === order.publicToken && (
                          <p className="mt-3 rounded-xl bg-success/10 p-3 text-[12px] font-bold text-success">
                            Ingressos reenviados por e-mail e WhatsApp ✅
                          </p>
                        )}
                        <div className="mt-4 flex flex-wrap gap-2.5">
                          <Link href={`/pedido/${order.publicToken}`} className="flex h-11 items-center rounded-xl border-[1.5px] border-line-input px-[18px] text-[13px] font-bold text-primary">
                            Ver ingressos
                          </Link>
                          <button onClick={() => resend(order.publicToken)} className="h-11 rounded-xl border-[1.5px] border-line-input px-[18px] text-[13px] font-bold text-ink">
                            Reenviar por e-mail
                          </button>
                          {APPROVED.includes(order.status) && !ended && !order.refundRequested && (
                            <Link href="/minhas-compras" className="flex h-11 items-center rounded-xl border-[1.5px] border-[#f5c6cf] px-[18px] text-[13px] font-bold text-danger">
                              Solicitar reembolso
                            </Link>
                          )}
                        </div>
                        <p className="mt-3 text-[11.5px] font-medium leading-relaxed text-muted-2">
                          Reembolso: até 7 dias após a compra e até 48h antes do evento (CDC art. 49). Cancelamento do
                          evento = reembolso integral com taxas.
                        </p>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {section === "dados" && (
            <section className="space-y-3.5 lg:max-w-[560px]">
              {!profile?.cpf && (
                <div className="rounded-[20px] border border-warning/40 bg-warning/10 p-5">
                  <p className="text-[14px] font-extrabold text-warning">Verifique sua conta</p>
                  <p className="mt-1 text-[12.5px] font-semibold leading-relaxed text-ink-soft">
                    Informe seu CPF abaixo para poder <b>receber ingressos transferidos</b> e entrar em eventos
                    com ingresso nominal. Leva 10 segundos.
                  </p>
                </div>
              )}
              <div className="rounded-[20px] border border-line bg-surface p-6">
                <h2 className="text-[16px] font-extrabold">Dados pessoais</h2>
                <div className="mt-[18px] space-y-3.5">
                  <div>
                    <p className="mb-1.5 text-[12px] font-bold text-ink-soft">CPF</p>
                    {profile?.cpf ? (
                      <p className="flex h-12 items-center justify-between rounded-xl border-[1.5px] border-line-input px-3.5 text-[14px] font-medium">
                        <span>{profile.cpf.slice(0, 3)}.***.***-{profile.cpf.slice(9)}</span>
                        <span className="rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-bold text-success">Conta verificada ✓</span>
                      </p>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          inputMode="numeric"
                          value={cpfInput}
                          onChange={(e) => setCpfInput(e.target.value.replace(/\D/g, "").slice(0, 11))}
                          placeholder="000.000.000-00"
                          className="h-12 min-w-0 flex-1 rounded-xl border-[1.5px] border-line-input bg-surface px-3.5 text-[14px] font-medium outline-none focus:border-primary"
                        />
                        <button
                          type="button"
                          disabled={cpfSaving || cpfInput.length !== 11 || !token}
                          onClick={async () => {
                            if (!token) return;
                            setCpfMsg(null);
                            if (!isValidCpf(cpfInput)) {
                              setCpfMsg("CPF inválido — confira os números digitados");
                              return;
                            }
                            setCpfSaving(true);
                            try {
                              const updated = await api.updateMe(token, { cpf: cpfInput });
                              setProfile((prev) => (prev ? { ...prev, cpf: updated.cpf } : prev));
                              setCpfMsg("Conta verificada ✓ — agora você pode receber transferências.");
                            } catch (err) {
                              setCpfMsg(err instanceof ApiError ? err.message : "Não foi possível salvar o CPF");
                            } finally {
                              setCpfSaving(false);
                            }
                          }}
                          className="h-12 shrink-0 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta disabled:bg-line disabled:text-muted disabled:shadow-none"
                        >
                          {cpfSaving ? "Salvando…" : "Verificar"}
                        </button>
                      </div>
                    )}
                    {cpfMsg && <p className="mt-2 text-[12px] font-bold text-ink-soft">{cpfMsg}</p>}
                    <p className="mt-1.5 text-[11px] font-medium text-muted-2">
                      O CPF identifica sua conta em ingressos nominais e transferências. Definido uma vez — para
                      alterar, fale com o suporte.
                    </p>
                  </div>
                  <div>
                    <p className="mb-1.5 text-[12px] font-bold text-ink-soft">Nome completo</p>
                    <p className="flex h-12 items-center rounded-xl border-[1.5px] border-line-input px-3.5 text-[14px] font-medium">{profile?.name ?? "—"}</p>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <div className="flex-[1.3]">
                      <p className="mb-1.5 text-[12px] font-bold text-ink-soft">E-mail</p>
                      <p className="flex h-12 items-center truncate rounded-xl border-[1.5px] border-line-input px-3.5 text-[14px] font-medium">{profile?.email ?? "—"}</p>
                    </div>
                    <div className="flex-1">
                      <p className="mb-1.5 text-[12px] font-bold text-ink-soft">Celular</p>
                      <p className="flex h-12 items-center rounded-xl border-[1.5px] border-line-input px-3.5 text-[14px] font-medium">{profile?.phone ?? "—"}</p>
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-[11.5px] font-medium leading-relaxed text-muted-2">
                  Para alterar e-mail ou celular, entre com o novo contato — a conta é identificada pelo código que
                  enviamos.
                </p>
              </div>

              <div className="rounded-[20px] border border-line bg-surface">
                <h2 className="px-6 pb-1 pt-5 text-[16px] font-extrabold">Notificações</h2>
                <p className="px-6 pb-3 text-[11.5px] font-medium leading-relaxed text-muted-2">
                  Preferência da conta — vale no site e no app. Avisos do ingresso e lembretes do evento são sempre
                  enviados.
                </p>
                <div className="flex items-center gap-3 border-t border-line-divider px-6 py-4">
                  <span className="flex-1">
                    <span className="block text-[14px] font-bold">Avisos por WhatsApp</span>
                    <span className="mt-1 block text-[11px] font-medium text-muted-2">Ingressos e lembretes do evento</span>
                  </span>
                  <Toggle
                    label="Avisos por WhatsApp"
                    checked={waNotif}
                    onChange={(v) => savePrefs({ notifyWhatsapp: v, notifyEmailOffers: emailOffers })}
                  />
                </div>
                <div className="flex items-center gap-3 border-t border-line-divider px-6 py-4">
                  <span className="flex-1">
                    <span className="block text-[14px] font-bold">Ofertas por e-mail</span>
                    <span className="mt-1 block text-[11px] font-medium text-muted-2">Novidades e pré-vendas (opcional)</span>
                  </span>
                  <Toggle
                    label="Ofertas por e-mail"
                    checked={emailOffers}
                    onChange={(v) => savePrefs({ notifyWhatsapp: waNotif, notifyEmailOffers: v })}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-line bg-surface p-6">
                <p className="text-[12.5px] font-medium text-muted-2">Não quer mais usar a BoraFest?</p>
                <button onClick={() => setConfirmDelete(true)} className="text-[12.5px] font-bold text-danger">
                  Excluir minha conta
                </button>
              </div>
            </section>
          )}

          {section === "legal" && (
            <section className="grid gap-3.5 lg:grid-cols-2">
              <div className="rounded-[20px] border border-line bg-surface p-[22px]">
                <h2 className="text-[15px] font-extrabold">Privacidade (LGPD)</h2>
                <p className="mt-3.5 text-[13px] font-medium leading-relaxed text-ink-soft">
                  Coletamos nome, e-mail e telefone para emitir e entregar ingressos; CPF apenas em eventos nominais.
                  O organizador recebe nome e tipo de ingresso para controle de acesso. Você pode acessar, corrigir,
                  portar e excluir seus dados (Lei 13.709/2018) — a exclusão remove dados pessoais em até 30 dias.
                </p>
                <div className="mt-3.5 flex flex-wrap gap-2.5">
                  <Link href="/legal" className="flex h-10 items-center rounded-[11px] border-[1.5px] border-line-input px-4 text-[12.5px] font-bold text-primary">
                    Política completa
                  </Link>
                  <button onClick={downloadData} className="h-10 rounded-[11px] border-[1.5px] border-line-input px-4 text-[12.5px] font-bold text-ink">
                    Baixar meus dados
                  </button>
                </div>
              </div>
              <div className="rounded-[20px] border border-line bg-surface p-[22px]">
                <h2 className="text-[15px] font-extrabold">Termos de Uso</h2>
                <p className="mt-3.5 text-[13px] font-medium leading-relaxed text-ink-soft">
                  A BoraFest intermedeia a venda entre você e o organizador. Preço e taxa são exibidos antes de pagar.
                  Reembolso em até 7 dias (CDC art. 49, até 48h antes do evento). Meia-entrada conforme a Lei
                  12.933/2013, com documento na portaria. QR codes são únicos; revenda acima do valor de face
                  invalida o ingresso.
                </p>
                <div className="mt-3.5">
                  <Link href="/legal?aba=termos" className="flex h-10 w-fit items-center rounded-[11px] border-[1.5px] border-line-input px-4 text-[12.5px] font-bold text-primary">
                    Termos completos
                  </Link>
                </div>
              </div>
              <p className="text-center text-[11.5px] font-medium text-muted-3 lg:col-span-2">
                Versão {CONSENT_VERSION} · DPO: privacidade@borafest.com
              </p>
            </section>
          )}

          {error && <p className="mt-4 text-center text-[12px] font-semibold text-danger">{error}</p>}

          {/* card do produtor e saída ficam no fim da página no mobile */}
          <div className="mt-6 lg:hidden">
            <OrganizerCard />
          </div>
          <button onClick={logout} className="mt-6 h-12 w-full rounded-2xl border-[1.5px] border-line-input text-[14px] font-bold text-ink lg:hidden">
            Sair da conta
          </button>
          <p className="mt-8 text-center text-[11px] font-medium text-muted-3 lg:hidden">BoraFest v1.0.0</p>
        </div>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 lg:items-center" onClick={() => setConfirmDelete(false)}>
          <div className="w-full max-w-[430px] rounded-t-3xl bg-surface p-6 lg:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[18px] font-extrabold">Excluir sua conta?</h2>
            <p className="mt-2 text-[13px] font-medium leading-relaxed text-muted">
              Seus dados pessoais são removidos em até 30 dias (LGPD). Ingressos de eventos futuros são
              cancelados sem reembolso. Essa ação não pode ser desfeita.
            </p>
            <button onClick={deleteAccount} className="mt-5 h-14 w-full rounded-2xl bg-danger text-[15px] font-extrabold text-white">
              Excluir definitivamente
            </button>
            <button onClick={() => setConfirmDelete(false)} className="mt-2 h-12 w-full rounded-2xl border-[1.5px] border-line-input text-[14px] font-bold">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
