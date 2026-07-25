"use client";

/**
 * PWA de Validação (portaria) — handoff v2, superfície 4.
 *
 * Regra inegociável da v2: **sem manifesto local sincronizado, NUNCA aprovar**.
 * Toda leitura passa por verificação de assinatura Ed25519 + status no
 * manifesto guardado em IndexedDB; sem manifesto o resultado é
 * "Não foi possível verificar" (slate), jamais "Válido".
 *
 * Fluxo: PIN → evento/portão → câmera → scanner (BarcodeDetector ou jsQR) →
 * resultado full-screen → busca manual / fila offline / resumo da portaria.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { isAuthError, portariaApi } from "../../lib/portaria/api";
import * as db from "../../lib/portaria/db";
import { CameraError, startScanner, type ScannerHandle } from "../../lib/portaria/scanner";
import { enqueueCheckin, flushQueue, loadIndex, syncManifest } from "../../lib/portaria/sync";
import type {
  ManifestTicket,
  QueueItem,
  RecentCheckin,
  ScanResult,
  Session,
  SummaryResponse,
} from "../../lib/portaria/types";
import {
  EMPTY_INDEX,
  INVALID_REASON_TEXT,
  lotLabel,
  searchManifest,
  verifyLocally,
  type ManifestIndex,
} from "../../lib/portaria/verify";

type Screen =
  | "pin"
  | "legal"
  | "select"
  | "camera"
  | "scanner"
  | "result"
  | "manual"
  | "offline"
  | "summary"
  | "blocked";

const SESSION_KEY = "bf.portaria.session";
const GATE_KEY = "bf.portaria.portao";

interface EventOption {
  id: string;
  title: string;
  startsAt: string;
  venue: { name: string; city: string } | null;
}

const RESULT_STYLE: Record<
  ScanResult["kind"],
  { title: string; sub: string; accent: string; gradient: string; anim: string }
> = {
  VALID: {
    title: "Válido",
    sub: "Entrada liberada. Bom evento!",
    accent: "#12a150",
    gradient: "linear-gradient(180deg,#12a150,#0f8a45)",
    anim: "animate-pop",
  },
  INVALID: {
    title: "Inválido",
    sub: "Este QR não vale para este evento.",
    accent: "#dc2626",
    gradient: "linear-gradient(180deg,#dc2626,#b91c1c)",
    anim: "animate-shake",
  },
  ALREADY_USED: {
    title: "Já utilizado",
    sub: "Este ingresso já passou pela portaria.",
    accent: "#b45309",
    gradient: "linear-gradient(180deg,#f59e0b,#d97706)",
    anim: "animate-pop",
  },
  CANCELED: {
    title: "Cancelado",
    sub: "Ingresso cancelado ou estornado — entrada não permitida.",
    accent: "#9f1239",
    gradient: "linear-gradient(180deg,#9f1239,#4c0519)",
    anim: "animate-shake",
  },
  UNVERIFIED: {
    title: "Não foi possível verificar",
    sub: "Sem conexão e sem lista local deste evento.",
    accent: "#334155",
    gradient: "linear-gradient(180deg,#334155,#0f172a)",
    anim: "animate-pop",
  },
};

function hora(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export default function PortariaPage() {
  const [screen, setScreen] = useState<Screen>("pin");
  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventQuery, setEventQuery] = useState("");
  const [eventId, setEventId] = useState("");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);

  const [gate, setGate] = useState<{ id?: string; name: string }>({ name: "Sem portão específico" });
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [manifest, setManifest] = useState({ ready: false, tickets: 0, syncedAt: "" });
  const [count, setCount] = useState(0);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const [result, setResult] = useState<ScanResult | null>(null);
  const [cameraError, setCameraError] = useState<CameraError | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  const [manualQuery, setManualQuery] = useState("");
  const [manualResults, setManualResults] = useState<ManifestTicket[]>([]);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [recent, setRecent] = useState<RecentCheckin[]>([]);
  const [blockedMessage, setBlockedMessage] = useState("");

  const indexRef = useRef<ManifestIndex>(EMPTY_INDEX);
  const sessionRef = useRef<Session | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<ScannerHandle | null>(null);
  const busyRef = useRef(false);

  const applyIndex = useCallback((index: ManifestIndex) => {
    indexRef.current = index;
    setManifest({
      ready: index.ready,
      tickets: index.byId.size,
      syncedAt: new Date().toISOString(),
    });
  }, []);

  const goBlocked = useCallback((message: string) => {
    // 401/403 NÃO é "sem rede": os check-ins locais ficam guardados e o
    // operador precisa de um PIN novo (bloqueio remoto ou sessão expirada).
    setBlockedMessage(message);
    scannerRef.current?.stop();
    scannerRef.current = null;
    setScreen("blocked");
  }, []);

  const refreshQueue = useCallback(async () => {
    if (!db.isDbAvailable()) return;
    setQueue(await db.getQueue().catch(() => []));
  }, []);

  const syncNow = useCallback(
    async (target?: Session | null) => {
      const active = target ?? sessionRef.current;
      if (!active) return;
      setSyncing(true);
      try {
        applyIndex(await syncManifest(active));
        await flushQueue(active);
      } catch (error) {
        if (isAuthError(error)) {
          goBlocked((error as ApiError).message);
          return;
        }
        // sem rede: segue com o manifesto que já está no aparelho
        applyIndex(await loadIndex(active));
      } finally {
        setSyncing(false);
        await refreshQueue();
      }
    },
    [applyIndex, goBlocked, refreshQueue],
  );

  // --- montagem: sessão salva, eventos, rede -------------------------------

  useEffect(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(SESSION_KEY) : null;
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Session;
        sessionRef.current = parsed;
        setSession(parsed);
        setScreen("select");
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }
    }
    const savedGate = typeof localStorage !== "undefined" ? localStorage.getItem(GATE_KEY) : null;
    if (savedGate) {
      try {
        setGate(JSON.parse(savedGate));
      } catch {
        /* ignora portão inválido */
      }
    }

    setOnline(navigator.onLine);
    db.getGateCount().then(setCount).catch(() => undefined);
    refreshQueue();
    portariaApi.listEvents().then(setEvents).catch(() => setEvents([]));
  }, [refreshQueue]);

  // rede voltou: ressincroniza manifesto e esvazia a fila automaticamente
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      syncNow();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [syncNow]);

  // --- login ---------------------------------------------------------------

  async function entrar(fullPin: string) {
    if (!eventId || entering) return;
    setEntering(true);
    try {
      const data = await portariaApi.createSession(
        eventId,
        fullPin,
        `Portaria PWA · ${new Date().toLocaleDateString("pt-BR")}`,
      );
      localStorage.setItem(SESSION_KEY, JSON.stringify(data));
      sessionRef.current = data;
      setSession(data);
      setPin("");
      setPinError(null);
      setScreen("select");
      syncNow(data);
    } catch (error) {
      setPin("");
      setPinError(
        error instanceof ApiError
          ? "PIN inválido. Confira o código com o produtor."
          : "Sem conexão para validar o PIN. Tente novamente.",
      );
      setTimeout(() => setPinError(null), 2600);
    } finally {
      setEntering(false);
    }
  }

  function sair() {
    localStorage.removeItem(SESSION_KEY);
    sessionRef.current = null;
    setSession(null);
    indexRef.current = EMPTY_INDEX;
    setManifest({ ready: false, tickets: 0, syncedAt: "" });
    db.clearManifest().catch(() => undefined);
    setScreen("pin");
  }

  // --- validação -----------------------------------------------------------

  const showResult = useCallback((value: ScanResult) => {
    setResult(value);
    setScreen("result");
  }, []);

  const contar = useCallback((delta: number) => {
    setCount((current) => Math.max(0, current + delta));
    db.bumpGateCount(delta)
      .then(setCount)
      .catch(() => undefined);
  }, []);

  const validar = useCallback(
    async (input: { qrToken?: string; code?: string; ticketId?: string }) => {
      const active = sessionRef.current;
      if (!active || busyRef.current) return;
      busyRef.current = true;
      scannerRef.current?.stop();
      scannerRef.current = null;

      try {
        if (navigator.onLine) {
          try {
            const data = await portariaApi.checkin(active, {
              qrToken: input.qrToken,
              // o servidor resolve o ingresso pelo código curto quando não há QR
              code: input.qrToken ? undefined : input.code,
              checkinPointId: gate.id,
              scannedAt: new Date().toISOString(),
            });
            const value: ScanResult = {
              kind: data.result,
              reason: data.reason,
              ticketId: data.ticket?.id,
              code: data.ticket?.code,
              name: data.ticket?.attendeeName,
              lotLabel: data.ticket ? `${data.ticket.typeName} — ${data.ticket.lotName}` : null,
              firstAt: data.firstCheckin?.at ?? null,
              firstGate: data.firstCheckin?.gateName ?? null,
              firstDevice: data.firstCheckin?.deviceName ?? null,
              checkinId: data.checkinId,
            };
            if (value.kind === "VALID") {
              contar(1);
              if (value.ticketId) {
                await db
                  .markTicketCheckedIn(value.ticketId, new Date().toISOString())
                  .catch(() => undefined);
              }
            }
            showResult(value);
            return;
          } catch (error) {
            if (isAuthError(error)) {
              goBlocked((error as ApiError).message);
              return;
            }
            // demais erros (rede caiu, 5xx, timeout): segue no caminho local
          }
        }

        const local = verifyLocally(input, indexRef.current);
        if (local.kind === "VALID" && local.ticketId) {
          const item = await enqueueCheckin({
            ticketId: local.ticketId,
            code: local.code ?? "",
            name: local.name ?? null,
            checkinPointId: gate.id,
            gateName: gate.name,
          });
          if (item) {
            indexRef.current.localCheckins.set(item.ticketId, {
              at: item.scannedAt,
              gate: item.gateName,
            });
            setQueue((prev) => [...prev, item]);
          }
          contar(1);
        }
        showResult(local);
      } finally {
        busyRef.current = false;
      }
    },
    [contar, gate.id, gate.name, goBlocked, showResult],
  );

  // --- scanner -------------------------------------------------------------

  useEffect(() => {
    if (screen !== "scanner") {
      scannerRef.current?.stop();
      scannerRef.current = null;
      return;
    }
    let cancelled = false;
    const video = videoRef.current;
    if (!video) return;

    startScanner(video, (raw) => {
      if (busyRef.current) return;
      validar(raw.startsWith("BF1.") ? { qrToken: raw } : { code: raw });
    })
      .then((handle) => {
        if (cancelled) {
          handle.stop();
          return;
        }
        scannerRef.current = handle;
        setTorchAvailable(handle.torchAvailable);
        setCameraError(null);
      })
      .catch((error) => {
        // câmera negada ou indisponível: cai na busca manual, sem travar
        if (error instanceof CameraError) setCameraError(error);
        setScreen("manual");
      });

    return () => {
      cancelled = true;
      scannerRef.current?.stop();
      scannerRef.current = null;
    };
  }, [screen, validar]);

  // ao voltar para o scanner, atualiza o manifesto por delta
  useEffect(() => {
    if (screen === "scanner") syncNow();
  }, [screen, syncNow]);

  async function alternarLanterna() {
    const handle = scannerRef.current;
    if (!handle) return;
    const next = !torchOn;
    if (await handle.setTorch(next)) setTorchOn(next);
  }

  // --- resumo --------------------------------------------------------------

  const carregarResumo = useCallback(async () => {
    const active = sessionRef.current;
    if (!active) return;
    try {
      const [s, r] = await Promise.all([
        portariaApi.summary(active),
        portariaApi.recentCheckins(active),
      ]);
      setSummary(s);
      setRecent(r);
    } catch (error) {
      if (isAuthError(error)) goBlocked((error as ApiError).message);
    }
  }, [goBlocked]);

  useEffect(() => {
    if (screen === "summary") carregarResumo();
  }, [screen, carregarResumo]);

  async function reverter(checkinId: string) {
    const active = sessionRef.current;
    if (!active) return;
    try {
      await portariaApi.reverse(active, checkinId);
      setRecent((prev) => prev.filter((r) => r.checkinId !== checkinId));
      contar(-1);
      carregarResumo();
    } catch (error) {
      if (isAuthError(error)) goBlocked((error as ApiError).message);
    }
  }

  // --- derivados -----------------------------------------------------------

  const eventosFiltrados = useMemo(() => {
    const term = eventQuery.trim().toLowerCase();
    if (!term) return events.slice(0, 6);
    return events.filter((e) => e.title.toLowerCase().includes(term)).slice(0, 8);
  }, [events, eventQuery]);

  const pendentes = queue.filter((q) => q.state === "PENDING");
  const conflitos = queue.filter((q) => q.state !== "PENDING");
  const eventoSelecionado = events.find((e) => e.id === eventId);

  function buscarManual(value: string) {
    setManualQuery(value);
    setManualResults(searchManifest(indexRef.current, value));
  }

  // -------------------------------------------------------------------------

  const shell = "mx-auto flex min-h-dvh w-full max-w-[430px] flex-col";

  return (
    <>
      {/* mira animada do protótipo (não há keyframe scanline no tema) */}
      <style>{`@keyframes bf-scanline{0%{top:14%}50%{top:80%}100%{top:14%}}`}</style>

      {screen === "pin" && (
        <main className={`${shell} bg-[#16121f] px-7 pb-9 pt-10 text-white`}>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-[18px] bg-primary text-[30px] font-extrabold">
              B
            </div>
            <h1 className="text-[24px] font-extrabold leading-tight">Validação BoraFest</h1>
            <p className="mb-7 mt-1.5 text-[14px] font-medium text-white/55">
              Digite o PIN de acesso fornecido pelo produtor.
            </p>

            <div className="mb-6 w-full text-left">
              {eventoSelecionado ? (
                <button
                  onClick={() => {
                    setEventId("");
                    setEventQuery("");
                  }}
                  className="flex w-full items-center justify-between rounded-2xl border-2 border-primary bg-primary/10 px-4 py-3 text-left"
                >
                  <span className="text-[14px] font-extrabold">{eventoSelecionado.title}</span>
                  <span className="text-[12px] font-bold text-[#a78bfa]">trocar</span>
                </button>
              ) : (
                <>
                  {events.length > 6 && (
                    <input
                      value={eventQuery}
                      onChange={(e) => setEventQuery(e.target.value)}
                      placeholder="Buscar evento pelo nome"
                      className="mb-2 h-12 w-full rounded-2xl border-[1.5px] border-white/15 bg-white/10 px-4 text-[14px] font-semibold text-white placeholder:text-white/35"
                    />
                  )}
                  <div className="max-h-[190px] space-y-2 overflow-y-auto">
                    {eventosFiltrados.map((event) => (
                      <button
                        key={event.id}
                        onClick={() => setEventId(event.id)}
                        className="w-full rounded-2xl border-[1.5px] border-white/12 bg-white/5 px-4 py-3 text-left"
                      >
                        <span className="block text-[14px] font-extrabold">{event.title}</span>
                        <span className="mt-0.5 block text-[12px] font-medium text-white/45">
                          {new Date(event.startsAt).toLocaleDateString("pt-BR")}
                          {event.venue ? ` · ${event.venue.city}` : ""}
                        </span>
                      </button>
                    ))}
                    {eventosFiltrados.length === 0 && (
                      <p className="py-3 text-center text-[12px] font-semibold text-white/40">
                        Nenhum evento encontrado.
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className={`mb-6 flex gap-2.5 ${pinError ? "animate-shake" : ""}`}>
              {Array.from({ length: 6 }).map((_, i) => (
                <span
                  key={i}
                  className={`h-4 w-4 rounded-full ${i < pin.length ? "bg-primary" : "bg-white/[.18]"}`}
                />
              ))}
            </div>

            {pinError && (
              <p className="-mt-2.5 mb-4 flex items-center gap-1.5 text-[13px] font-bold text-[#f87171]">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 7v6M12 16.5v.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
                {pinError}
              </p>
            )}

            <div className="grid grid-cols-3 gap-3.5">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((key, i) => (
                <button
                  key={i}
                  disabled={!key}
                  onClick={() => {
                    setPinError(null);
                    if (key === "⌫") {
                      setPin((p) => p.slice(0, -1));
                      return;
                    }
                    const next = (pin + key).slice(0, 6);
                    setPin(next);
                    if (next.length === 6) entrar(next);
                  }}
                  className="h-16 w-16 rounded-[20px] bg-white/10 text-[24px] font-bold disabled:bg-transparent"
                >
                  {key}
                </button>
              ))}
            </div>
          </div>

          <div>
            <button
              onClick={() => entrar(pin)}
              disabled={pin.length !== 6 || !eventId || entering}
              className={`h-14 w-full rounded-2xl text-[16px] font-extrabold ${
                pin.length === 6 && eventId ? "bg-primary" : "bg-white/[.12]"
              }`}
            >
              {entering ? "Entrando..." : "Entrar"}
            </button>
            <p className="mt-3.5 text-center text-[11px] font-medium leading-relaxed text-white/40">
              Ao entrar, você aceita os termos de operação e a{" "}
              <button onClick={() => setScreen("legal")} className="font-bold text-[#a78bfa]">
                política de privacidade
              </button>
              .
            </p>
          </div>
        </main>
      )}

      {screen === "legal" && (
        <main className={`${shell} bg-bg px-6 pb-10 pt-4`}>
          <div className="mb-4 flex items-center gap-3.5">
            <button
              onClick={() => setScreen(session ? "select" : "pin")}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e6e2f0] bg-white text-ink"
              aria-label="Voltar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <h1 className="text-[18px] font-extrabold text-ink">Privacidade da operação</h1>
          </div>
          <div className="space-y-3">
            {[
              [
                "1. Quem opera este app",
                "O acesso é feito por PIN fornecido pelo organizador do evento. Coletamos apenas o nome do validador e o portão de atuação, para auditoria das entradas.",
              ],
              [
                "2. Dados dos participantes",
                "Nome, tipo de ingresso e status de check-in são tratados em nome do organizador (operador, nos termos da LGPD), exclusivamente para controle de acesso ao evento. O CPF não é enviado para o aparelho.",
              ],
              [
                "3. Modo offline",
                "A lista de ingressos fica guardada no aparelho apenas durante o evento e é apagada automaticamente ao sair da sessão de portaria.",
              ],
              [
                "4. Contato",
                "Dúvidas sobre dados: privacidade@borafest.com. Política completa em borafest.com/privacidade.",
              ],
            ].map(([title, body]) => (
              <div key={title} className="rounded-2xl border border-line bg-white px-[18px] py-4">
                <h2 className="mb-1.5 text-[13px] font-extrabold text-ink">{title}</h2>
                <p className="text-[12.5px] font-medium leading-relaxed text-ink-soft">{body}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-[11px] font-medium text-muted-3">BoraFest Validação v1.0.0</p>
        </main>
      )}

      {screen === "select" && session && (
        <main className={`${shell} bg-bg px-6 pb-10 pt-4`}>
          <div className="flex items-start justify-between">
            <h1 className="text-[22px] font-extrabold leading-tight text-ink">Selecione o ponto</h1>
            <button
              onClick={sair}
              className="flex h-[34px] items-center gap-1.5 rounded-[10px] border border-[#e6e2f0] bg-white px-3 text-[12px] font-bold text-muted"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Sair
            </button>
          </div>
          <p className="mb-5 mt-1 text-[14px] font-medium text-muted">
            Escolha o evento ativo e o portão onde você vai validar.
          </p>

          <h2 className="mb-3 text-[12px] font-bold uppercase tracking-wider text-muted-2">Evento ativo</h2>
          <div className="mb-6 flex items-center gap-3.5 rounded-2xl border-2 border-primary bg-primary/[.04] p-4">
            <span className="h-[46px] w-[46px] flex-none rounded-xl bg-brand-gradient" />
            <div className="flex-1">
              <p className="text-[15px] font-extrabold leading-tight text-ink">{session.event.title}</p>
              <p className="mt-1 text-[12px] font-medium text-muted-2">
                {manifest.ready
                  ? `${manifest.tickets} ingressos na lista local`
                  : syncing
                    ? "Baixando lista de ingressos..."
                    : "Lista local ainda não sincronizada"}
              </p>
            </div>
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-primary">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M5 12l5 5 9-11" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>

          {!manifest.ready && (
            <button
              onClick={() => syncNow()}
              className="mb-6 w-full rounded-2xl border border-warning/25 bg-warning/[.08] px-4 py-3 text-left"
            >
              <p className="text-[13px] font-extrabold text-[#92400e]">Sincronize antes de abrir o portão</p>
              <p className="mt-0.5 text-[12px] font-medium text-warning">
                Sem a lista local o app não pode liberar ninguém. Toque para baixar agora.
              </p>
            </button>
          )}

          <h2 className="mb-3 text-[12px] font-bold uppercase tracking-wider text-muted-2">Portão de entrada</h2>
          <div className="mb-7 space-y-2.5">
            {[{ id: undefined, name: "Sem portão específico" }, ...session.checkinPoints].map((point) => {
              const active = gate.id === point.id;
              return (
                <button
                  key={point.id ?? "none"}
                  onClick={() => {
                    const next = { id: point.id, name: point.name };
                    setGate(next);
                    localStorage.setItem(GATE_KEY, JSON.stringify(next));
                  }}
                  className={`flex w-full items-center gap-3.5 rounded-2xl border-2 p-4 ${
                    active ? "border-primary bg-primary/[.04] text-primary" : "border-line bg-white text-ink"
                  }`}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M4 20V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v14M4 20h12M4 20H2m14 0h6M20 20V9h-4M11 12h.01"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="flex-1 text-left text-[15px] font-extrabold">{point.name}</span>
                  <span
                    className={`h-[22px] w-[22px] flex-none rounded-full border-2 ${
                      active ? "border-primary bg-primary/20" : "border-[#d3cee0] bg-white"
                    }`}
                  />
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setScreen("camera")}
            className="h-[54px] w-full rounded-2xl bg-primary text-[16px] font-extrabold text-white shadow-cta"
          >
            Iniciar validação
          </button>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setScreen("summary")}
              className="h-11 flex-1 rounded-xl border border-line bg-white text-[13px] font-bold text-ink"
            >
              Resumo da portaria
            </button>
            <button
              onClick={() => setScreen("offline")}
              className="h-11 flex-1 rounded-xl border border-line bg-white text-[13px] font-bold text-ink"
            >
              Fila ({pendentes.length})
            </button>
          </div>
        </main>
      )}

      {screen === "camera" && (
        <main className={`${shell} bg-bg-dark px-8 pb-9 pt-10 text-white`}>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="mb-6 flex h-[110px] w-[110px] items-center justify-center rounded-[32px] bg-[#a78bfa]/[.12] text-[#a78bfa]">
              <svg width="52" height="52" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 8a2 2 0 0 1 2-2h1.5l1.2-1.8A2 2 0 0 1 10.4 3h3.2a2 2 0 0 1 1.7 1.2L16.5 6H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="13" r="3.4" stroke="currentColor" strokeWidth="1.7" />
              </svg>
            </div>
            <h1 className="mb-2.5 text-[22px] font-extrabold leading-tight">Permitir acesso à câmera</h1>
            <p className="max-w-[280px] text-[14px] font-medium leading-relaxed text-white/55">
              Usamos a câmera apenas para ler o QR code dos ingressos. Nenhuma foto ou vídeo é gravado ou enviado.
            </p>
          </div>
          <div className="space-y-2.5">
            <button
              onClick={() => setScreen("scanner")}
              className="h-[54px] w-full rounded-2xl bg-primary text-[15px] font-extrabold text-white"
            >
              Permitir acesso
            </button>
            <button
              onClick={() => setScreen("manual")}
              className="h-12 w-full rounded-2xl border-[1.5px] border-white/[.18] text-[13px] font-bold text-white/70"
            >
              Agora não — usar busca manual
            </button>
          </div>
        </main>
      )}

      {screen === "scanner" && session && (
        <main className={`${shell} relative bg-[#0b0910] text-white`}>
          <div className="absolute inset-0 bg-[linear-gradient(135deg,#1a1424,#0b0910)]" />
          <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline />
          {/* escurece o vídeo para a mira e os textos manterem contraste AA */}
          <div className="absolute inset-0 bg-black/45" />

          <div className="relative z-10 flex items-center justify-between px-5 py-3.5">
            <button
              onClick={() => setScreen("select")}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10"
              aria-label="Voltar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-[7px] text-[12px] font-bold ${
                online ? "bg-success/[.18] text-[#4ade80]" : "bg-warning/20 text-[#fbbf24]"
              }`}
            >
              <span className={`h-[7px] w-[7px] rounded-full bg-current ${online ? "animate-pulseDot" : ""}`} />
              {syncing ? "Sincronizando" : online ? "Online" : "Offline"}
            </span>
            <button
              onClick={alternarLanterna}
              disabled={!torchAvailable}
              className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                torchOn ? "bg-white text-[#16121f]" : "bg-white/10 text-white"
              } disabled:opacity-30`}
              aria-label="Lanterna"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-10">
            <p className="mb-2 text-center text-[18px] font-extrabold">Aponte para o QR code</p>
            <p className="mb-7 text-center text-[13px] font-medium text-white/50">
              {session.event.title} · {gate.name}
            </p>

            <div className="relative h-[250px] w-[250px]">
              <span className="absolute left-0 top-0 h-11 w-11 rounded-tl-[14px] border-l-4 border-t-4 border-[#a78bfa]" />
              <span className="absolute right-0 top-0 h-11 w-11 rounded-tr-[14px] border-r-4 border-t-4 border-[#a78bfa]" />
              <span className="absolute bottom-0 left-0 h-11 w-11 rounded-bl-[14px] border-b-4 border-l-4 border-[#a78bfa]" />
              <span className="absolute bottom-0 right-0 h-11 w-11 rounded-br-[14px] border-b-4 border-r-4 border-[#a78bfa]" />
              <span
                className="absolute left-[14%] right-[14%] h-[3px] rounded-sm bg-[linear-gradient(90deg,transparent,#a78bfa,transparent)] shadow-[0_0_14px_#a78bfa]"
                style={{ animation: "bf-scanline 2.6s ease-in-out infinite" }}
              />
            </div>

            {!manifest.ready && (
              <p className="mt-6 max-w-[260px] text-center text-[12px] font-bold text-[#fbbf24]">
                Lista local não sincronizada — nenhuma entrada será liberada até sincronizar.
              </p>
            )}
          </div>

          <div className="relative z-10 px-5 pb-6">
            <div className="flex items-center justify-between rounded-[18px] bg-white/[.08] px-[18px] py-4 backdrop-blur">
              <div>
                <p className="text-[22px] font-extrabold">{count}</p>
                <p className="mt-1 text-[11px] font-medium text-white/50">entradas neste portão</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setScreen("summary")}
                  className="h-11 rounded-xl border-[1.5px] border-white/20 px-4 text-[13px] font-bold"
                >
                  Resumo
                </button>
                <button
                  onClick={() => {
                    setManualQuery("");
                    setManualResults([]);
                    setScreen("manual");
                  }}
                  className="flex h-11 items-center gap-1.5 rounded-xl border-[1.5px] border-white/20 px-4 text-[13px] font-bold"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                    <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Busca manual
                </button>
              </div>
            </div>
          </div>
        </main>
      )}

      {screen === "result" && result && (
        <ResultScreen
          result={result}
          gateName={gate.name}
          onNext={() => setScreen("scanner")}
          onManual={() => {
            setManualQuery("");
            setManualResults([]);
            setScreen("manual");
          }}
          onSync={() => setScreen("offline")}
        />
      )}

      {screen === "manual" && (
        <main className={`${shell} bg-bg px-5 pb-10 pt-4`}>
          <div className="mb-4 flex items-center gap-3.5">
            <button
              onClick={() => setScreen(session ? "scanner" : "pin")}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e6e2f0] bg-white text-ink"
              aria-label="Voltar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <h1 className="text-[18px] font-extrabold text-ink">Busca manual</h1>
          </div>

          {cameraError && (
            <p className="mb-3 rounded-2xl border border-warning/25 bg-warning/[.08] px-4 py-3 text-[12px] font-semibold text-[#92400e]">
              {cameraError.kind === "DENIED"
                ? "Câmera negada neste aparelho. Você pode validar pelo nome ou pelo código."
                : "Câmera indisponível neste navegador. Você pode validar pelo nome ou pelo código."}
            </p>
          )}

          <div className="flex h-[52px] items-center gap-2.5 rounded-2xl border-[1.5px] border-primary bg-white px-4">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="#8b8598" strokeWidth="2" />
              <path d="m20 20-3.5-3.5" stroke="#8b8598" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              value={manualQuery}
              onChange={(e) => buscarManual(e.target.value)}
              placeholder="Nome do participante ou código"
              autoFocus
              className="w-full bg-transparent text-[15px] font-semibold text-ink outline-none placeholder:font-medium placeholder:text-muted-3"
            />
          </div>

          <div className="my-3 flex items-center justify-between px-0.5">
            <span className="text-[12px] font-semibold text-muted-2">
              {!manifest.ready
                ? "Lista local não sincronizada"
                : manualQuery.trim().length < 2
                  ? "Digite ao menos 2 letras"
                  : `${manualResults.length} participante${manualResults.length === 1 ? "" : "s"} encontrado${manualResults.length === 1 ? "" : "s"}`}
            </span>
            {!manifest.ready && (
              <button
                onClick={() => syncNow()}
                className="rounded-[9px] bg-primary/[.08] px-2.5 py-1.5 text-[12px] font-semibold text-primary"
              >
                sincronizar
              </button>
            )}
          </div>

          {manualResults.length > 0 ? (
            <div className="space-y-2.5">
              {manualResults.map((ticket) => {
                const usado =
                  ticket.status === "CHECKED_IN" || indexRef.current.localCheckins.has(ticket.id);
                const cancelado = ticket.status === "CANCELED" || ticket.status === "REFUNDED";
                return (
                  <div
                    key={ticket.id}
                    className="flex items-center gap-3 rounded-2xl border-[1.5px] border-line bg-white px-4 py-3.5"
                  >
                    <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-full bg-brand-gradient text-[14px] font-extrabold text-white">
                      {(ticket.attendeeName ?? ticket.code)
                        .split(" ")
                        .map((part) => part[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </span>
                    <div className="flex-1">
                      <p className="text-[14px] font-extrabold leading-tight text-ink">
                        {ticket.attendeeName ?? "Ingresso não nominal"}
                      </p>
                      <p className="mt-1 text-[12px] font-medium text-muted-2">
                        {lotLabel(indexRef.current, ticket.ticketLotId) ?? "Ingresso"} · {ticket.code}
                      </p>
                    </div>
                    <button
                      onClick={() => validar({ ticketId: ticket.id, code: ticket.code })}
                      disabled={cancelado}
                      className={`h-[38px] rounded-[11px] px-4 text-[12px] font-bold ${
                        cancelado
                          ? "bg-[#f4f2f8] text-[#9f1239]"
                          : usado
                            ? "bg-[#f4f2f8] text-warning"
                            : "bg-success px-4 text-white"
                      }`}
                    >
                      {cancelado ? "Cancelado" : usado ? "Já usado" : "Check-in"}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            manualQuery.trim().length >= 2 && (
              <div className="flex flex-col items-center px-5 py-14 text-center">
                <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-[26px] bg-[#efedf5] text-muted-4">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
                    <path d="m20 20-3-3M8 11h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </div>
                <p className="mb-2 text-[17px] font-extrabold text-ink">Nenhum resultado</p>
                <p className="max-w-[250px] text-[13px] font-medium leading-relaxed text-muted">
                  Nenhum participante encontrado para &ldquo;{manualQuery}&rdquo;. Confira o nome ou o código do
                  ingresso.
                </p>
              </div>
            )
          )}
        </main>
      )}

      {screen === "offline" && (
        <main className={`${shell} bg-bg px-6 pb-10 pt-4`}>
          <h1 className="text-[22px] font-extrabold leading-tight text-ink">
            {online ? "Fila de sincronização" : "Modo offline"}
          </h1>
          <p className="mb-5 mt-1 text-[14px] font-medium text-muted">
            Você continua validando normalmente. Tudo sincroniza quando a conexão voltar.
          </p>

          {!online && (
            <div className="mb-5 flex items-center gap-3.5 rounded-2xl border border-warning/25 bg-warning/[.08] px-[18px] py-4">
              <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-xl bg-warning/15 text-warning">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M3 3l18 18M8.5 8.6A9 9 0 0 0 4 11M12 5c2.4 0 4.6.9 6.3 2.3M6 14a5 5 0 0 1 3-1.7M15 12.4A5 5 0 0 1 18 14"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                  />
                  <circle cx="12" cy="18" r="1.2" fill="currentColor" />
                </svg>
              </span>
              <div className="flex-1">
                <p className="text-[14px] font-extrabold leading-tight text-[#92400e]">
                  Sem conexão com a internet
                </p>
                <p className="mt-1 text-[12px] font-medium leading-snug text-warning">
                  A validação usa a lista salva no aparelho.
                </p>
              </div>
            </div>
          )}

          <div className="mb-4 rounded-[18px] border border-line bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[15px] font-extrabold text-ink">Fila de sincronização</h2>
              <span className="rounded-full bg-warning/[.12] px-2.5 py-1.5 text-[11px] font-bold text-warning">
                {pendentes.length} pendentes
              </span>
            </div>
            {pendentes.length === 0 ? (
              <p className="text-[12px] font-medium text-muted-2">Nada pendente por aqui.</p>
            ) : (
              <div className="space-y-3">
                {pendentes.map((item) => (
                  <div key={item.localSeq} className="flex items-center gap-3">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-warning/10 text-warning">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                        <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </span>
                    <div className="flex-1">
                      <p className="text-[13px] font-bold leading-none text-ink">
                        {item.name ?? item.code}
                      </p>
                      <p className="mt-1 text-[11px] font-medium leading-none text-muted-2">
                        {hora(item.scannedAt)} · {item.gateName ?? "Sem portão"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {conflitos.length > 0 && (
            <div className="mb-4 rounded-[18px] border border-danger/25 bg-danger/[.06] p-5">
              <h2 className="text-[15px] font-extrabold text-ink">
                {conflitos.length} conflito{conflitos.length === 1 ? "" : "s"} de sincronização
              </h2>
              <p className="mb-3 mt-1 text-[12px] font-medium leading-snug text-muted">
                O servidor não confirmou estas entradas (ingresso já usado em outro portão, cancelado ou
                inexistente). Nada foi descartado — mostre esta lista ao organizador.
              </p>
              <div className="space-y-2">
                {conflitos.map((item) => (
                  <div key={item.localSeq} className="flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-bold leading-none text-ink">{item.name ?? item.code}</p>
                      <p className="mt-1 text-[11px] font-medium leading-none text-muted-2">
                        {hora(item.scannedAt)} · {item.code}
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-danger">
                      {item.state === "CONFLICT" ? "conflito" : "não encontrado"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => syncNow()}
            disabled={syncing}
            className="flex h-[54px] w-full items-center justify-center gap-2.5 rounded-2xl bg-primary text-[16px] font-extrabold text-white shadow-cta disabled:opacity-70"
          >
            {syncing && (
              <span className="h-4 w-4 animate-spin rounded-full border-[2.5px] border-white/35 border-t-white" />
            )}
            {syncing ? "Sincronizando..." : "Sincronizar agora"}
          </button>
          <button
            onClick={() => setScreen(session ? "scanner" : "pin")}
            className="mt-3 h-12 w-full rounded-2xl border border-line bg-white text-[13px] font-bold text-ink"
          >
            Voltar ao scanner
          </button>
        </main>
      )}

      {screen === "summary" && session && (
        <main className={`${shell} bg-bg px-6 pb-10 pt-4`}>
          <h1 className="text-[22px] font-extrabold leading-tight text-ink">Resumo da portaria</h1>
          <p className="mb-5 mt-1 text-[14px] font-medium text-muted">
            {session.event.title} · atualizado {hora(new Date().toISOString())}
          </p>

          <div className="mb-4 rounded-[20px] bg-brand-gradient p-[22px] text-white">
            <p className="mb-2 text-[12px] font-semibold text-white/70">Total de presentes</p>
            <div className="flex items-baseline gap-2.5">
              <span className="text-[44px] font-extrabold leading-none">{summary?.checkedIn ?? 0}</span>
              <span className="text-[15px] font-semibold text-white/70">
                / {summary?.totalTickets ?? 0} ingressos
              </span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-white"
                style={{
                  width: `${summary && summary.totalTickets > 0 ? Math.round((summary.checkedIn / summary.totalTickets) * 100) : 0}%`,
                }}
              />
            </div>
          </div>

          <h2 className="mb-3 text-[12px] font-bold uppercase tracking-wider text-muted-2">Por portão</h2>
          <div className="mb-5 space-y-2.5">
            {(summary?.byGate ?? []).map((item) => {
              const max = Math.max(...(summary?.byGate ?? []).map((g) => g.count), 1);
              return (
                <div key={item.gate} className="rounded-2xl border border-line bg-white p-4">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="text-[14px] font-extrabold text-ink">{item.gate}</span>
                    <span className="text-[18px] font-extrabold text-primary">{item.count}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[#efedf5]">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.round((item.count / max) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {(summary?.byGate ?? []).length === 0 && (
              <p className="text-[12px] font-medium text-muted-2">Nenhuma entrada registrada ainda.</p>
            )}
          </div>

          <h2 className="mb-3 text-[12px] font-bold uppercase tracking-wider text-muted-2">Últimas entradas</h2>
          <div className="overflow-hidden rounded-2xl border border-line bg-white">
            {recent.length === 0 && (
              <p className="px-4 py-5 text-[12px] font-medium text-muted-2">Nenhuma entrada nesta sessão.</p>
            )}
            {recent.map((item) => (
              <div
                key={item.checkinId}
                className="flex items-center gap-3 border-b border-[#f4f2f8] px-4 py-3.5 last:border-b-0"
              >
                <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-success/[.12] text-success">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12l5 5 9-11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div className="flex-1">
                  <p className="text-[13px] font-bold leading-none text-ink">{item.name ?? item.code}</p>
                  <p className="mt-1 text-[11px] font-medium leading-none text-muted-2">
                    {item.code} · {hora(item.at)} · {item.gate ?? "Sem portão"}
                  </p>
                </div>
                <button
                  onClick={() => reverter(item.checkinId)}
                  className="rounded-[9px] bg-danger/[.08] px-2.5 py-1.5 text-[11px] font-bold text-danger"
                >
                  Reverter
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={() => setScreen("scanner")}
            className="mt-5 h-12 w-full rounded-2xl border border-line bg-white text-[13px] font-bold text-ink"
          >
            Voltar ao scanner
          </button>
        </main>
      )}

      {screen === "blocked" && (
        <main className={`${shell} bg-bg-dark px-7 pb-9 pt-10 text-white`}>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="mb-6 flex h-[104px] w-[104px] items-center justify-center rounded-[30px] bg-danger/[.14] text-[#fb7185]">
              <svg width="50" height="50" viewBox="0 0 24 24" fill="none">
                <rect x="5" y="10" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
                <path d="M8 10V7a4 4 0 1 1 8 0v3M12 14v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            <h1 className="mb-2.5 text-[23px] font-extrabold leading-tight">Acesso bloqueado</h1>
            <p className="mb-6 max-w-[290px] text-[14px] font-medium leading-relaxed text-white/55">
              Este aparelho foi desconectado pelo organizador ou a sessão expirou. Novas validações estão
              suspensas.
            </p>
            <div className="w-full space-y-3 rounded-2xl bg-white/[.07] px-[18px] py-4 text-left">
              <div className="flex justify-between gap-4 text-[12.5px] font-semibold">
                <span className="text-white/50">Motivo</span>
                <span className="text-right">{blockedMessage || "Dispositivo não autorizado"}</span>
              </div>
              <div className="flex justify-between gap-4 text-[12.5px] font-semibold">
                <span className="text-white/50">Check-ins já feitos</span>
                <span className="text-right text-[#4ade80]">
                  {pendentes.length > 0
                    ? `${pendentes.length} salvos · serão sincronizados`
                    : "Salvos · serão sincronizados"}
                </span>
              </div>
              <div className="flex justify-between gap-4 text-[12.5px] font-semibold">
                <span className="text-white/50">{gate.name}</span>
                <span className="text-right">Segue operando nos demais aparelhos</span>
              </div>
            </div>
          </div>
          <div className="space-y-2.5">
            <button
              onClick={() => {
                // não limpa a fila: os check-ins locais sobrevivem ao novo login
                localStorage.removeItem(SESSION_KEY);
                sessionRef.current = null;
                setSession(null);
                setPin("");
                setScreen("pin");
              }}
              className="h-[54px] w-full rounded-2xl bg-primary text-[15px] font-extrabold text-white"
            >
              Entrar com novo PIN
            </button>
            <a
              href="mailto:privacidade@borafest.com"
              className="flex h-12 w-full items-center justify-center rounded-2xl border-[1.5px] border-white/[.18] text-[13px] font-bold text-white/70"
            >
              Falar com o organizador
            </a>
          </div>
        </main>
      )}
    </>
  );
}

// --- resultado full-screen ---------------------------------------------------

function ResultScreen({
  result,
  gateName,
  onNext,
  onManual,
  onSync,
}: {
  result: ScanResult;
  gateName: string;
  onNext: () => void;
  onManual: () => void;
  onSync: () => void;
}) {
  const style = RESULT_STYLE[result.kind];
  const reason = result.reason ? INVALID_REASON_TEXT[result.reason] : undefined;

  const rows: Array<[string, string]> = [];
  if (result.kind === "VALID") {
    rows.push(["Portador", result.name ?? "Ingresso não nominal"]);
    if (result.lotLabel) rows.push(["Ingresso", result.lotLabel]);
    if (result.code) rows.push(["Código", result.code]);
    if (result.offline) rows.push(["Sincronização", "Na fila — envia quando a rede voltar"]);
  } else if (result.kind === "ALREADY_USED") {
    rows.push(["Portador", result.name ?? result.code ?? "—"]);
    rows.push(["1º uso", hora(result.firstAt)]);
    rows.push(["Portão", result.firstGate ?? result.firstDevice ?? "Não informado"]);
  } else if (result.kind === "CANCELED") {
    rows.push(["Portador", result.name ?? result.code ?? "—"]);
    rows.push(["Status", "Cancelado ou estornado"]);
    rows.push(["O que dizer", '"Este ingresso foi estornado"']);
    rows.push(["Ação", "Encaminhar à bilheteria / organizador"]);
  } else if (result.kind === "UNVERIFIED") {
    rows.push(["Regra", "NUNCA liberar entrada sem verificação"]);
    rows.push(["Motivo", "Manifesto offline não sincronizado"]);
    rows.push(["Ação", "Sincronizar agora ou direcionar a um portão online"]);
  } else {
    rows.push(["Motivo", reason?.motivo ?? "Ingresso inválido"]);
    rows.push(["O que dizer", reason?.dizer ?? '"Não conseguimos validar este ingresso"']);
    rows.push(["Ação", reason?.acao ?? "Conferir a compra na busca manual"]);
  }

  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col text-white"
      style={{ background: style.gradient }}
    >
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <div
          className={`mb-6 flex h-[108px] w-[108px] items-center justify-center rounded-full bg-white ${style.anim}`}
        >
          <ResultIcon kind={result.kind} />
        </div>
        <h1 className="mb-2.5 text-[34px] font-extrabold leading-tight">{style.title}</h1>
        <p className="mb-6 max-w-[280px] text-[15px] font-semibold text-white/85">
          {result.kind === "VALID" && result.offline
            ? "Entrada liberada pela lista local. Bom evento!"
            : style.sub}
        </p>
        <div className="w-full space-y-3 rounded-[18px] bg-white/[.14] p-[18px] backdrop-blur">
          {rows.map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <span className="text-[13px] font-medium text-white/65">{key}</span>
              <span className="text-right text-[14px] font-extrabold leading-tight">{value}</span>
            </div>
          ))}
          {result.kind === "VALID" && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-[13px] font-medium text-white/65">Portão</span>
              <span className="text-right text-[14px] font-extrabold leading-tight">{gateName}</span>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 px-6 pb-8">
        <button
          onClick={onNext}
          className="h-[58px] w-full rounded-2xl bg-white text-[17px] font-extrabold"
          style={{ color: style.accent }}
        >
          Próximo
        </button>
        <div className="flex gap-2">
          {result.kind === "UNVERIFIED" && (
            <button
              onClick={onSync}
              className="h-11 flex-1 rounded-xl bg-white/20 text-[12px] font-bold text-white"
            >
              Sincronizar agora
            </button>
          )}
          {result.kind !== "VALID" && (
            <button
              onClick={onManual}
              className="h-11 flex-1 rounded-xl bg-white/20 text-[12px] font-bold text-white"
            >
              Buscar na lista
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

function ResultIcon({ kind }: { kind: ScanResult["kind"] }) {
  if (kind === "VALID") {
    return (
      <svg width="58" height="58" viewBox="0 0 24 24" fill="none">
        <path d="M5 12l5 5 9-11" stroke="#12a150" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "INVALID") {
    return (
      <svg width="54" height="54" viewBox="0 0 24 24" fill="none">
        <path d="M7 7l10 10M17 7 7 17" stroke="#dc2626" strokeWidth="3.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "ALREADY_USED") {
    return (
      <svg width="52" height="52" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="#d97706" strokeWidth="2.4" />
        <path d="M12 7v5l3.5 2" stroke="#d97706" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "CANCELED") {
    return (
      <svg width="50" height="50" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="#9f1239" strokeWidth="2.4" />
        <path d="M5.5 5.5l13 13" stroke="#9f1239" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="50" height="50" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 3l18 18M9 8.6A5 5 0 0 0 6 13h-.5A3.5 3.5 0 0 0 5 19.9M12 6a6 6 0 0 1 6 6h.5a3.5 3.5 0 0 1 1.6 6.6M9 19h7"
        stroke="#334155"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
