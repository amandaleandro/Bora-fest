"use client";

/**
 * PWA de Validação (portaria) — handoff v2, superfície 4.
 *
 * App standalone de tela cheia (fora do chrome do site — ver ./layout.tsx e
 * components/SiteChrome.tsx), com o visual do protótipo aprovado
 * "docs/design/BoraFest - App Validacao.html".
 *
 * Regra inegociável da v2: **sem manifesto local sincronizado, NUNCA aprovar**.
 * Toda leitura passa por verificação de assinatura Ed25519 + status no
 * manifesto guardado em IndexedDB; sem manifesto o resultado é
 * "Não foi possível verificar" (slate), jamais "Válido".
 *
 * Fluxo: evento + PIN → portão → validação em 3 abas (Scanner QR, Código
 * BF-XXXX-XXXX e Documento nome/CPF-hash) → resultado full-screen →
 * fila offline / resumo da portaria.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { isAuthError, portariaApi } from "../../lib/portaria/api";
import * as db from "../../lib/portaria/db";
import { CameraError, startScanner, type ScannerHandle } from "../../lib/portaria/scanner";
import { searchByDocument, type DocumentSearchMode } from "../../lib/portaria/search";
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
  verifyLocally,
  type ManifestIndex,
} from "../../lib/portaria/verify";

type Screen =
  | "pin"
  | "legal"
  | "select"
  | "camera"
  | "validate"
  | "result"
  | "offline"
  | "summary"
  | "blocked";

type Tab = "scanner" | "code" | "doc";

const SESSION_KEY = "bf.portaria.session";
const GATE_KEY = "bf.portaria.portao";
const CAM_KEY = "bf.portaria.camera-ok";

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

// feedback tátil por resultado — válido é curto, recusa é insistente
const VIBRATE: Record<ScanResult["kind"], number | number[]> = {
  VALID: 60,
  ALREADY_USED: [70, 60, 70],
  INVALID: [90, 60, 90, 60, 90],
  CANCELED: [90, 60, 90, 60, 90],
  UNVERIFIED: [40, 40, 40],
};

function vibrar(pattern: number | number[]) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* alguns navegadores bloqueiam sem gesto */
  }
}

function hora(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Versão curta do carimbo do manifesto, para caber no rodapé. */
function versaoCurta(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return value.slice(0, 12);
}

/** Corpo do código (sem o "BF-") formatado como XXXX-XXXX enquanto digita. */
function formatarCorpoCodigo(raw: string): string {
  let v = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // colou o código inteiro com o prefixo? remove o "BF"
  if (v.startsWith("BF") && v.length > 8) v = v.slice(2);
  v = v.slice(0, 8);
  return v.length <= 4 ? v : `${v.slice(0, 4)}-${v.slice(4)}`;
}

const CORPO_COMPLETO = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

function iniciais(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

type StatusIngresso = "disponivel" | "usado" | "cancelado";

const BADGE: Record<StatusIngresso, { label: string; cls: string }> = {
  disponivel: { label: "Disponível", cls: "bg-success/20 text-[#4ade80]" },
  usado: { label: "Já usado", cls: "bg-warning/25 text-[#fbbf24]" },
  cancelado: { label: "Cancelado", cls: "bg-danger/20 text-[#fb7185]" },
};

const TABS: Array<{ id: Tab; label: string; icon: JSX.Element }> = [
  {
    id: "scanner",
    label: "Scanner",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path
          d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M3 12h18"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "code",
    label: "Código",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path
          d="M9 4 7 20M17 4l-2 16M4 9h17M3 15h17"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "doc",
    label: "Documento",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="8.5" cy="11" r="2" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M5.5 16c.6-1.4 1.7-2.1 3-2.1s2.4.7 3 2.1M14.5 10h4M14.5 13.5h4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

export default function PortariaPage() {
  const [screen, setScreen] = useState<Screen>("pin");
  const [tab, setTab] = useState<Tab>("scanner");
  const [session, setSession] = useState<Session | null>(null);

  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventsError, setEventsError] = useState(false);
  const [eventQuery, setEventQuery] = useState("");
  const [eventId, setEventId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);

  const [gate, setGate] = useState<{ id?: string; name: string }>({ name: "Sem portão específico" });
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [manifest, setManifest] = useState({ ready: false, tickets: 0, version: "", syncedAt: "" });
  const [count, setCount] = useState(0);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const [result, setResult] = useState<ScanResult | null>(null);
  const [cameraError, setCameraError] = useState<CameraError | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  const [codeBody, setCodeBody] = useState("");
  const [docQuery, setDocQuery] = useState("");
  const [docResults, setDocResults] = useState<ManifestTicket[]>([]);
  const [docMode, setDocMode] = useState<DocumentSearchMode>("none");
  const [docSelected, setDocSelected] = useState<ManifestTicket | null>(null);

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
    db.getManifestMeta()
      .then((meta) =>
        setManifest({
          ready: index.ready,
          tickets: index.byId.size,
          version: meta?.manifestVersion ?? "",
          syncedAt: meta?.syncedAt ?? "",
        }),
      )
      .catch(() =>
        setManifest({ ready: index.ready, tickets: index.byId.size, version: "", syncedAt: "" }),
      );
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

  const carregarEventos = useCallback(() => {
    setEventsError(false);
    portariaApi
      .listEvents()
      .then(setEvents)
      .catch(() => {
        setEvents([]);
        setEventsError(true);
      });
  }, []);

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
    carregarEventos();
  }, [carregarEventos, refreshQueue]);

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
      vibrar([80, 60, 80]);
      setTimeout(() => setPinError(null), 3200);
    } finally {
      setEntering(false);
    }
  }

  function sair() {
    localStorage.removeItem(SESSION_KEY);
    sessionRef.current = null;
    setSession(null);
    indexRef.current = EMPTY_INDEX;
    setManifest({ ready: false, tickets: 0, version: "", syncedAt: "" });
    db.clearManifest().catch(() => undefined);
    setTab("scanner");
    setCodeBody("");
    setDocQuery("");
    setDocResults([]);
    setDocSelected(null);
    setScreen("pin");
  }

  // --- validação -----------------------------------------------------------

  const showResult = useCallback((value: ScanResult) => {
    vibrar(VIBRATE[value.kind]);
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
    async (input: { qrToken?: string; code?: string }) => {
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
                const at = new Date().toISOString();
                await db.markTicketCheckedIn(value.ticketId, at).catch(() => undefined);
                // espelha no índice em memória: a lista da aba Documento
                // precisa mostrar "Já usado" sem esperar o próximo delta
                const cached = indexRef.current.byId.get(value.ticketId);
                if (cached) {
                  const updated = { ...cached, status: "CHECKED_IN", checkedInAt: at };
                  indexRef.current.byId.set(updated.id, updated);
                  indexRef.current.byCode.set(updated.code.toUpperCase(), updated);
                }
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

        // mesmo caminho local do QR — o documento também referencia pelo `code`
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

  // --- scanner (aba) -------------------------------------------------------

  useEffect(() => {
    if (screen !== "validate" || tab !== "scanner") {
      scannerRef.current?.stop();
      scannerRef.current = null;
      setTorchOn(false);
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
        localStorage.setItem(CAM_KEY, "1");
      })
      .catch((error) => {
        // câmera negada ou indisponível: cai na aba Documento, sem travar
        if (error instanceof CameraError) setCameraError(error);
        localStorage.removeItem(CAM_KEY);
        setTab("doc");
      });

    return () => {
      cancelled = true;
      scannerRef.current?.stop();
      scannerRef.current = null;
    };
  }, [screen, tab, validar]);

  // ao entrar no modo validação, atualiza o manifesto por delta
  useEffect(() => {
    if (screen === "validate") syncNow();
  }, [screen, syncNow]);

  async function alternarLanterna() {
    const handle = scannerRef.current;
    if (!handle) return;
    const next = !torchOn;
    if (await handle.setTorch(next)) setTorchOn(next);
  }

  // --- busca por documento (nome ou CPF-hash, 100% local) ------------------

  // `manifest.syncedAt` na dependência: um sync (ou check-in) rebusca e a
  // lista reflete o status novo dos ingressos.
  useEffect(() => {
    if (screen !== "validate" || tab !== "doc") return;
    let alive = true;
    searchByDocument(indexRef.current, docQuery)
      .then((found) => {
        if (!alive) return;
        setDocResults(found.tickets);
        setDocMode(found.mode);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [docQuery, screen, tab, manifest.syncedAt]);

  function statusIngresso(ticket: ManifestTicket): StatusIngresso {
    if (ticket.status === "CANCELED" || ticket.status === "REFUNDED") return "cancelado";
    if (ticket.status === "CHECKED_IN" || indexRef.current.localCheckins.has(ticket.id)) {
      return "usado";
    }
    return "disponivel";
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
    if (!term) return events.slice(0, 30);
    return events.filter((e) => e.title.toLowerCase().includes(term)).slice(0, 30);
  }, [events, eventQuery]);

  const pendentes = queue.filter((q) => q.state === "PENDING");
  const conflitos = queue.filter((q) => q.state !== "PENDING");
  const eventoSelecionado = events.find((e) => e.id === eventId);
  const codigoPronto = CORPO_COMPLETO.test(codeBody);

  const docHint = !manifest.ready
    ? "Lista local não sincronizada"
    : docMode === "cpf"
      ? `${docResults.length} ingresso${docResults.length === 1 ? "" : "s"} com este CPF`
      : docMode === "name"
        ? `${docResults.length} participante${docResults.length === 1 ? "" : "s"} encontrado${docResults.length === 1 ? "" : "s"}`
        : "Digite ao menos 2 letras ou o CPF completo";

  function iniciarValidacao() {
    const granted = typeof localStorage !== "undefined" && localStorage.getItem(CAM_KEY) === "1";
    setTab("scanner");
    setScreen(granted ? "validate" : "camera");
  }

  function validarCodigo() {
    if (!codigoPronto) return;
    const code = `BF-${codeBody}`;
    setCodeBody("");
    validar({ code });
  }

  // -------------------------------------------------------------------------

  // a coluna full-screen vem do layout da rota; cada tela só se estica nela
  const shell = "flex w-full flex-1 flex-col";

  return (
    <>
      {/* mira animada do protótipo (não há keyframe scanline no tema) */}
      <style>{`@keyframes bf-scanline{0%{top:14%}50%{top:80%}100%{top:14%}}`}</style>

      {screen === "pin" && (
        <main className={`${shell} bg-[#16121f] px-6 pb-8 pt-10 text-white`}>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-[18px] bg-primary text-[30px] font-extrabold">
              B
            </div>
            <h1 className="text-[24px] font-extrabold leading-tight">Validação BoraFest</h1>
            <p className="mb-7 mt-1.5 text-[14px] font-medium text-white/55">
              Escolha o evento e digite o PIN fornecido pelo produtor.
            </p>

            <button
              onClick={() => setPickerOpen(true)}
              className={`mb-7 flex w-full items-center gap-3 rounded-2xl border-[1.5px] px-4 py-3.5 text-left ${
                eventoSelecionado ? "border-primary bg-primary/10" : "border-white/15 bg-white/[.06]"
              }`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="flex-none text-[#a78bfa]">
                <rect x="3" y="5" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
                <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <span className="min-w-0 flex-1">
                {eventoSelecionado ? (
                  <>
                    <span className="block truncate text-[14px] font-extrabold">
                      {eventoSelecionado.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] font-medium text-white/45">
                      {new Date(eventoSelecionado.startsAt).toLocaleDateString("pt-BR")}
                      {eventoSelecionado.venue ? ` · ${eventoSelecionado.venue.city}` : ""}
                    </span>
                  </>
                ) : (
                  <span className="text-[14px] font-bold text-white/55">Escolher evento</span>
                )}
              </span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="flex-none text-white/45">
                <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <div className={`mb-6 flex gap-3 ${pinError ? "animate-shake" : ""}`}>
              {Array.from({ length: 6 }).map((_, i) => (
                <span
                  key={i}
                  className={`h-4 w-4 rounded-full transition-colors ${
                    i < pin.length ? "bg-primary" : "bg-white/[.18]"
                  }`}
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

            <div className="grid w-full max-w-[300px] grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((key, i) => (
                <button
                  key={i}
                  disabled={!key}
                  aria-label={key === "⌫" ? "Apagar" : key || undefined}
                  onClick={() => {
                    vibrar(12);
                    setPinError(null);
                    if (key === "⌫") {
                      setPin((p) => p.slice(0, -1));
                      return;
                    }
                    if (!eventId) {
                      setPinError("Escolha o evento antes do PIN.");
                      setPickerOpen(true);
                      return;
                    }
                    const next = (pin + key).slice(0, 6);
                    setPin(next);
                    if (next.length === 6) entrar(next);
                  }}
                  className="h-16 rounded-[20px] bg-white/[.08] text-[24px] font-bold transition active:bg-white/20 disabled:bg-transparent"
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
                pin.length === 6 && eventId ? "bg-primary shadow-cta" : "bg-white/[.12]"
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

      {/* seletor de evento — sheet por cima do login */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 lg:items-center lg:p-6"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="flex max-h-[80dvh] w-full max-w-[430px] flex-col rounded-t-[28px] bg-[#1d1828] px-5 pb-6 pt-4 text-white lg:rounded-[28px]"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="mx-auto mb-4 h-1.5 w-12 flex-none rounded-full bg-white/15 lg:hidden" />
            <div className="mb-4 flex flex-none items-center justify-between">
              <h2 className="text-[17px] font-extrabold">Qual é o evento?</h2>
              <button
                onClick={() => setPickerOpen(false)}
                aria-label="Fechar"
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <input
              value={eventQuery}
              onChange={(e) => setEventQuery(e.target.value)}
              placeholder="Buscar pelo nome do evento"
              className="mb-3 h-12 w-full flex-none rounded-2xl border-[1.5px] border-white/15 bg-white/[.07] px-4 text-[14px] font-semibold text-white outline-none placeholder:text-white/35 focus:border-primary"
            />
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-1">
              {eventosFiltrados.map((event) => {
                const active = event.id === eventId;
                return (
                  <button
                    key={event.id}
                    onClick={() => {
                      setEventId(event.id);
                      setPinError(null);
                      setPickerOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-2xl border-[1.5px] px-4 py-3 text-left ${
                      active ? "border-primary bg-primary/10" : "border-white/10 bg-white/[.05]"
                    }`}
                  >
                    <span className="h-10 w-10 flex-none rounded-xl bg-brand-gradient" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-extrabold">{event.title}</span>
                      <span className="mt-0.5 block truncate text-[12px] font-medium text-white/45">
                        {new Date(event.startsAt).toLocaleDateString("pt-BR")}
                        {event.venue ? ` · ${event.venue.name}, ${event.venue.city}` : ""}
                      </span>
                    </span>
                    {active && (
                      <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-primary">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                          <path d="M5 12l5 5 9-11" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    )}
                  </button>
                );
              })}
              {events.length === 0 && eventsError && (
                <div className="rounded-2xl border border-warning/30 bg-warning/10 px-4 py-4 text-center">
                  <p className="text-[13px] font-bold text-[#fbbf24]">
                    Não foi possível carregar os eventos.
                  </p>
                  <button
                    onClick={carregarEventos}
                    className="mt-2 rounded-xl bg-white/10 px-4 py-2 text-[12px] font-bold"
                  >
                    Tentar de novo
                  </button>
                </div>
              )}
              {events.length === 0 && !eventsError && (
                <p className="py-4 text-center text-[12px] font-semibold text-white/40">
                  Carregando eventos...
                </p>
              )}
              {events.length > 0 && eventosFiltrados.length === 0 && (
                <p className="py-4 text-center text-[12px] font-semibold text-white/40">
                  Nenhum evento encontrado.
                </p>
              )}
            </div>
          </div>
        </div>
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
                "Nome, tipo de ingresso e status de check-in são tratados em nome do organizador (operador, nos termos da LGPD), exclusivamente para controle de acesso ao evento. O CPF não é enviado para o aparelho — a busca por documento compara apenas um hash irreversível.",
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
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-[22px] font-extrabold leading-tight text-ink">Selecione o ponto</h1>
            <div className="flex flex-none items-center gap-2">
              <span
                className={`flex h-[34px] items-center gap-1.5 rounded-[10px] px-2.5 text-[12px] font-bold ${
                  online ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                }`}
              >
                <span className={`h-[7px] w-[7px] rounded-full bg-current ${online ? "animate-pulseDot" : ""}`} />
                {online ? "Online" : "Offline"}
              </span>
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
          </div>
          <p className="mb-5 mt-1 text-[14px] font-medium text-muted">
            Confira o evento e escolha o portão onde você vai validar.
          </p>

          <h2 className="mb-3 text-[12px] font-bold uppercase tracking-wider text-muted-2">Evento ativo</h2>
          <div className="mb-6 flex items-center gap-3.5 rounded-2xl border-2 border-primary bg-primary/[.04] p-4">
            <span className="h-[46px] w-[46px] flex-none rounded-xl bg-brand-gradient" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-extrabold leading-tight text-ink">{session.event.title}</p>
              <p className="mt-1 text-[12px] font-medium text-muted-2">
                {manifest.ready
                  ? `${manifest.tickets} ingressos na lista local · v ${versaoCurta(manifest.version)}`
                  : syncing
                    ? "Baixando lista de ingressos..."
                    : "Lista local ainda não sincronizada"}
              </p>
              <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <rect x="4" y="7" width="16" height="13" rx="2.5" stroke="currentColor" strokeWidth="2" />
                  <path d="M9 7V5.5A2.5 2.5 0 0 1 11.5 3h1A2.5 2.5 0 0 1 15 5.5V7M12 12v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {session.credentialLabel ?? "Equipe de portaria"}
              </span>
            </div>
            <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-primary">
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
            onClick={iniciarValidacao}
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
              onClick={() => {
                setTab("scanner");
                setScreen("validate");
              }}
              className="h-[54px] w-full rounded-2xl bg-primary text-[15px] font-extrabold text-white"
            >
              Permitir acesso
            </button>
            <button
              onClick={() => {
                setTab("doc");
                setScreen("validate");
              }}
              className="h-12 w-full rounded-2xl border-[1.5px] border-white/[.18] text-[13px] font-bold text-white/70"
            >
              Agora não — validar por documento
            </button>
          </div>
        </main>
      )}

      {screen === "validate" && session && (
        <main className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-[#0b0910] text-white">
          {tab === "scanner" && (
            <>
              <div className="absolute inset-0 bg-[linear-gradient(135deg,#1a1424,#0b0910)]" />
              <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline />
              {/* escurece o vídeo para a mira e os textos manterem contraste AA */}
              <div className="absolute inset-0 bg-black/45" />
            </>
          )}

          {/* topo: voltar · evento/credencial · status de rede */}
          <div className="relative z-10 flex flex-none items-center gap-3 px-4 pb-2 pt-4">
            <button
              onClick={() => setScreen("select")}
              className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-white/10"
              aria-label="Voltar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-extrabold leading-tight">{session.event.title}</p>
              <p className="truncate text-[11px] font-medium text-white/45">
                {gate.name}
                {session.credentialLabel ? ` · ${session.credentialLabel}` : ""}
              </p>
            </div>
            <span
              className={`flex flex-none items-center gap-1.5 rounded-full px-3 py-[7px] text-[11px] font-bold ${
                online ? "bg-success/[.18] text-[#4ade80]" : "bg-warning/20 text-[#fbbf24]"
              }`}
            >
              <span className={`h-[7px] w-[7px] rounded-full bg-current ${online ? "animate-pulseDot" : ""}`} />
              {syncing ? "Sincronizando" : online ? "Online" : "Offline"}
            </span>
          </div>

          {/* ---- aba Scanner ---- */}
          {tab === "scanner" && (
            <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-8">
              <p className="mb-1.5 text-center text-[17px] font-extrabold">Aponte para o QR code</p>
              <p className="mb-6 text-center text-[12px] font-medium text-white/50">
                A leitura é automática e funciona offline.
              </p>

              <div className="relative h-[240px] w-[240px]">
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
                <p className="mt-5 max-w-[260px] text-center text-[12px] font-bold text-[#fbbf24]">
                  Lista local não sincronizada — nenhuma entrada será liberada até sincronizar.
                </p>
              )}

              <div className="mt-7 flex w-full items-center justify-between rounded-[18px] bg-white/[.08] px-[18px] py-3.5 backdrop-blur">
                <div>
                  <p className="text-[20px] font-extrabold leading-none">{count}</p>
                  <p className="mt-1.5 text-[11px] font-medium text-white/50">entradas neste portão</p>
                </div>
                <button
                  onClick={alternarLanterna}
                  disabled={!torchAvailable}
                  className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                    torchOn ? "bg-white text-[#16121f]" : "bg-white/10 text-white"
                  } disabled:opacity-30`}
                  aria-label="Lanterna"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* ---- aba Código manual ---- */}
          {tab === "code" && (
            <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-4">
              <h1 className="text-[20px] font-extrabold">Código do ingresso</h1>
              <p className="mb-6 mt-1 text-[13px] font-medium leading-relaxed text-white/50">
                Digite o código curto impresso no ingresso ou no e-mail.
              </p>

              <div className="flex h-[60px] items-center rounded-2xl border-[1.5px] border-white/15 bg-white/[.07] px-4 focus-within:border-primary">
                <span className="text-[20px] font-extrabold tracking-[.12em] text-white/45">BF-</span>
                <input
                  value={codeBody}
                  onChange={(e) => setCodeBody(formatarCorpoCodigo(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") validarCodigo();
                  }}
                  placeholder="0000-0000"
                  autoFocus
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full bg-transparent text-[20px] font-extrabold uppercase tracking-[.12em] text-white outline-none placeholder:text-white/25"
                />
              </div>

              {!manifest.ready && (
                <p className="mt-3 text-[12px] font-bold text-[#fbbf24]">
                  Lista local não sincronizada — sem rede, nenhum código será aprovado.
                </p>
              )}

              <button
                onClick={validarCodigo}
                disabled={!codigoPronto}
                className="mt-5 h-[54px] w-full flex-none rounded-2xl bg-primary text-[16px] font-extrabold text-white shadow-cta disabled:bg-white/[.08] disabled:text-white/35 disabled:shadow-none"
              >
                Validar código
              </button>
              <p className="mt-4 text-[12px] font-medium leading-relaxed text-white/40">
                Use quando o QR não carregar no celular do participante ou o papel estiver danificado.
              </p>
            </div>
          )}

          {/* ---- aba Documento (nome ou CPF) ---- */}
          {tab === "doc" && (
            <div className="relative z-10 flex min-h-0 flex-1 flex-col px-5 pt-4">
              <h1 className="text-[20px] font-extrabold">Buscar participante</h1>
              <p className="mb-4 mt-1 text-[13px] font-medium leading-relaxed text-white/50">
                Nome ou CPF — a busca roda na lista do aparelho e funciona offline.
              </p>

              {cameraError && (
                <p className="mb-3 flex-none rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-[12px] font-semibold text-[#fbbf24]">
                  {cameraError.kind === "DENIED"
                    ? "Câmera negada neste aparelho — valide pelo documento ou pelo código."
                    : "Câmera indisponível neste navegador — valide pelo documento ou pelo código."}
                </p>
              )}

              <div className="flex h-[52px] flex-none items-center gap-2.5 rounded-2xl border-[1.5px] border-white/15 bg-white/[.07] px-4 focus-within:border-primary">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" className="flex-none text-white/40">
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input
                  value={docQuery}
                  onChange={(e) => setDocQuery(e.target.value)}
                  placeholder="Nome ou CPF do participante"
                  inputMode="search"
                  autoFocus
                  className="w-full bg-transparent text-[15px] font-semibold text-white outline-none placeholder:font-medium placeholder:text-white/30"
                />
                {docQuery && (
                  <button
                    onClick={() => setDocQuery("")}
                    aria-label="Limpar busca"
                    className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-white/10 text-white/60"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>

              <div className="mt-2.5 flex flex-none items-center justify-between px-0.5">
                <span className="text-[11.5px] font-semibold text-white/45">{docHint}</span>
                {!manifest.ready ? (
                  <button
                    onClick={() => syncNow()}
                    className="rounded-lg bg-primary/25 px-2.5 py-1.5 text-[11.5px] font-bold text-[#c4b5fd]"
                  >
                    sincronizar
                  </button>
                ) : (
                  docMode === "cpf" && (
                    <span className="text-[11px] font-semibold text-white/30">comparado por hash</span>
                  )
                )}
              </div>

              <div className="mt-2.5 min-h-0 flex-1 space-y-2.5 overflow-y-auto pb-3">
                {docResults.map((ticket) => {
                  const st = statusIngresso(ticket);
                  return (
                    <button
                      key={ticket.id}
                      onClick={() => setDocSelected(ticket)}
                      className="flex w-full items-center gap-3 rounded-2xl border-[1.5px] border-white/10 bg-white/[.06] px-4 py-3.5 text-left transition active:bg-white/[.12]"
                    >
                      <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-full bg-brand-gradient text-[14px] font-extrabold">
                        {iniciais(ticket.attendeeName ?? ticket.code)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-extrabold leading-tight">
                          {ticket.attendeeName ?? "Ingresso não nominal"}
                        </span>
                        <span className="mt-1 block truncate text-[12px] font-medium text-white/45">
                          {lotLabel(indexRef.current, ticket.ticketLotId) ?? "Ingresso"} · {ticket.code}
                        </span>
                      </span>
                      <span className={`flex-none rounded-full px-2.5 py-1 text-[11px] font-bold ${BADGE[st].cls}`}>
                        {BADGE[st].label}
                      </span>
                    </button>
                  );
                })}

                {docMode !== "none" && docResults.length === 0 && (
                  <div className="flex flex-col items-center px-5 py-12 text-center">
                    <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[22px] bg-white/[.06] text-white/30">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
                        <path d="m20 20-3-3M8 11h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </div>
                    <p className="mb-1.5 text-[16px] font-extrabold">Nenhum resultado</p>
                    <p className="max-w-[250px] text-[13px] font-medium leading-relaxed text-white/45">
                      {docMode === "cpf"
                        ? "Nenhum ingresso com este CPF na lista deste evento."
                        : `Nenhum participante para “${docQuery}”. Confira o nome ou tente o CPF completo.`}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* rodapé: fila/manifesto · resumo · abas */}
          <div className="relative z-10 flex-none">
            <div className="mx-4 mb-2 flex gap-2">
              <button
                onClick={() => setScreen("offline")}
                className="flex h-9 min-w-0 flex-1 items-center justify-center gap-2 truncate rounded-xl bg-white/[.07] px-3 text-[11px] font-semibold text-white/60"
              >
                {syncing ? (
                  <span className="h-3 w-3 flex-none animate-spin rounded-full border-2 border-white/25 border-t-white/70" />
                ) : (
                  <span
                    className={`h-[7px] w-[7px] flex-none rounded-full ${
                      pendentes.length > 0 ? "bg-[#fbbf24]" : "bg-[#4ade80]"
                    }`}
                  />
                )}
                <span className="truncate">
                  lista v {versaoCurta(manifest.version)} · {pendentes.length}{" "}
                  {pendentes.length === 1 ? "pendente" : "pendentes"}
                </span>
              </button>
              <button
                onClick={() => setScreen("summary")}
                className="h-9 flex-none rounded-xl bg-white/[.07] px-3.5 text-[11px] font-bold text-white/60"
              >
                Resumo
              </button>
            </div>
            <div className="flex items-stretch gap-1 border-t border-white/10 bg-[#120e1a]/95 px-2 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
              {TABS.map((item) => {
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      vibrar(10);
                      setTab(item.id);
                    }}
                    className={`flex flex-1 flex-col items-center gap-1 rounded-2xl py-2.5 text-[11px] font-bold transition ${
                      active ? "bg-primary/20 text-[#c4b5fd]" : "text-white/45 active:bg-white/[.06]"
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </main>
      )}

      {/* confirmação do check-in por documento */}
      {docSelected &&
        (() => {
          const st = statusIngresso(docSelected);
          const lot = lotLabel(indexRef.current, docSelected.ticketLotId) ?? "Ingresso";
          return (
            <div
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 lg:items-center lg:p-6"
              onClick={() => setDocSelected(null)}
            >
              <div
                className="w-full max-w-[430px] rounded-t-[28px] bg-[#1d1828] px-6 pb-8 pt-4 text-white lg:rounded-[28px]"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="mx-auto mb-4 block h-1.5 w-12 rounded-full bg-white/15 lg:hidden" />
                <div className="mb-5 flex items-center gap-3.5">
                  <span className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-full bg-brand-gradient text-[17px] font-extrabold">
                    {iniciais(docSelected.attendeeName ?? docSelected.code)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[18px] font-extrabold leading-tight">
                      {docSelected.attendeeName ?? "Ingresso não nominal"}
                    </p>
                    <p className="mt-1 truncate text-[13px] font-medium text-white/50">{lot}</p>
                  </div>
                </div>

                <div className="mb-5 space-y-2.5 rounded-2xl bg-white/[.06] px-4 py-3.5">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[13px] font-medium text-white/55">Código</span>
                    <span className="text-[14px] font-extrabold">{docSelected.code}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[13px] font-medium text-white/55">Status</span>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${BADGE[st].cls}`}>
                      {BADGE[st].label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[13px] font-medium text-white/55">Portão</span>
                    <span className="text-[14px] font-extrabold">{gate.name}</span>
                  </div>
                </div>

                {st === "usado" && (
                  <p className="mb-4 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-[12px] font-semibold leading-relaxed text-[#fbbf24]">
                    Este ingresso já passou pela portaria
                    {docSelected.checkedInAt ? ` às ${hora(docSelected.checkedInAt)}` : ""}. Veja a
                    situação completa antes de decidir com o organizador.
                  </p>
                )}
                {st === "cancelado" && (
                  <p className="mb-4 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-[12px] font-semibold leading-relaxed text-[#fb7185]">
                    Ingresso cancelado ou estornado — entrada não permitida.
                  </p>
                )}

                <button
                  onClick={() => {
                    const code = docSelected.code;
                    setDocSelected(null);
                    validar({ code });
                  }}
                  className={`h-[54px] w-full rounded-2xl text-[16px] font-extrabold ${
                    st === "disponivel" ? "bg-success text-white shadow-cta-green" : "bg-white/10 text-white"
                  }`}
                >
                  {st === "disponivel" ? "Confirmar entrada" : "Ver situação completa"}
                </button>
                <button
                  onClick={() => setDocSelected(null)}
                  className="mt-2.5 h-12 w-full rounded-2xl border-[1.5px] border-white/15 text-[13px] font-bold text-white/70"
                >
                  Voltar
                </button>
              </div>
            </div>
          );
        })()}

      {screen === "result" && result && (
        <ResultScreen
          result={result}
          gateName={gate.name}
          onNext={() => setScreen("validate")}
          onSearch={() => {
            setTab("doc");
            setScreen("validate");
          }}
          onSync={() => setScreen("offline")}
        />
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
            <h2 className="mb-3 text-[15px] font-extrabold text-ink">Lista local (manifesto)</h2>
            <div className="space-y-2 text-[13px] font-semibold">
              <div className="flex justify-between gap-4">
                <span className="text-muted-2">Versão</span>
                <span className="text-ink">{versaoCurta(manifest.version)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-2">Ingressos</span>
                <span className="text-ink">{manifest.tickets}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-2">Sincronizada</span>
                <span className="text-ink">{hora(manifest.syncedAt)}</span>
              </div>
            </div>
          </div>

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
            onClick={() => setScreen(session ? "validate" : "pin")}
            className="mt-3 h-12 w-full rounded-2xl border border-line bg-white text-[13px] font-bold text-ink"
          >
            Voltar à validação
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
            onClick={() => setScreen("validate")}
            className="mt-5 h-12 w-full rounded-2xl border border-line bg-white text-[13px] font-bold text-ink"
          >
            Voltar à validação
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
  onSearch,
  onSync,
}: {
  result: ScanResult;
  gateName: string;
  onNext: () => void;
  onSearch: () => void;
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
    rows.push(["Portão", result.firstGate ?? "Não informado"]);
    if (result.firstDevice) rows.push(["Aparelho", result.firstDevice]);
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
    rows.push(["Ação", reason?.acao ?? "Conferir a compra na busca por documento"]);
  }

  return (
    <main className="flex w-full flex-1 flex-col text-white" style={{ background: style.gradient }}>
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
              onClick={onSearch}
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
