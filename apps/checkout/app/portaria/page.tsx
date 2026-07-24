"use client";

/**
 * PWA de Validação (portaria) — handoff v1, superfície 4.
 * Fluxo: PIN → evento/portão → scanner (BarcodeDetector quando houver;
 * entrada manual sempre) → resultado full-screen → resumo com reversão.
 * Offline: fila local (localStorage) + sync em lote idempotente.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../../lib/config";

type Screen = "pin" | "gate" | "scanner" | "result" | "resumo";
interface Session {
  deviceId: string;
  deviceToken: string;
  event: { id: string; title: string };
  checkinPoints: Array<{ id: string; name: string }>;
}
interface ResultData {
  result: "VALID" | "ALREADY_USED" | "INVALID" | "CANCELED";
  code?: string;
  name?: string | null;
  lot?: string;
  firstAt?: string | null;
  firstDevice?: string;
  offline?: boolean;
  checkinId?: string;
}

const S_KEY = "bf.portaria.session";
const Q_KEY = "bf.portaria.fila";
const C_KEY = "bf.portaria.confirmados";

async function req(path: string, init: RequestInit = {}, session?: Session | null) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body) headers["Content-Type"] = "application/json";
  if (session) {
    headers["x-device-id"] = session.deviceId;
    headers["x-device-token"] = session.deviceToken;
  }
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message ?? `Erro ${res.status}`);
  return data;
}

export default function PortariaPage() {
  const [screen, setScreen] = useState<Screen>("pin");
  const [session, setSession] = useState<Session | null>(null);
  const [gate, setGate] = useState<string | undefined>();
  const [online, setOnline] = useState(true);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [eventId, setEventId] = useState("");
  const [events, setEvents] = useState<Array<{ id: string; title: string }>>([]);
  const [manual, setManual] = useState("");
  const [result, setResult] = useState<ResultData | null>(null);
  const [count, setCount] = useState(0);
  const [queueLen, setQueueLen] = useState(0);
  const [lastConfirmed, setLastConfirmed] = useState<Array<{ checkinId: string; code: string; at: string }>>([]);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(S_KEY);
    if (saved) {
      setSession(JSON.parse(saved));
      setScreen("gate");
    }
    fetch(`${API_BASE_URL}/v1/public/events`).then((r) => r.json()).then((d) => setEvents(d.events ?? [])).catch(() => {});
    setCount(Number(localStorage.getItem(C_KEY) ?? "0"));
    setQueueLen(JSON.parse(localStorage.getItem(Q_KEY) ?? "[]").length);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  async function loginPin(fullPin: string) {
    try {
      const data = await req("/v1/validator/sessions", {
        method: "POST",
        body: JSON.stringify({
          session: { eventId, pin: fullPin },
          device: { name: `PWA Portaria ${new Date().toLocaleDateString("pt-BR")}` },
        }),
      });
      const s: Session = {
        deviceId: data.deviceId,
        deviceToken: data.deviceToken,
        event: data.event,
        checkinPoints: data.checkinPoints,
      };
      localStorage.setItem(S_KEY, JSON.stringify(s));
      setSession(s);
      setScreen("gate");
    } catch {
      setPinError(true);
      setPin("");
      setTimeout(() => setPinError(false), 600);
    }
  }

  const showResult = useCallback((r: ResultData) => {
    setResult(r);
    setScreen("result");
    if (r.result === "VALID") {
      const next = count + 1;
      setCount(next);
      localStorage.setItem(C_KEY, String(next));
      if (r.checkinId) {
        const list = [{ checkinId: r.checkinId, code: r.code ?? "", at: new Date().toLocaleTimeString("pt-BR") }, ...lastConfirmed].slice(0, 10);
        setLastConfirmed(list);
      }
    }
  }, [count, lastConfirmed]);

  const checkin = useCallback(async (payload: { qrToken?: string; code?: string }) => {
    if (!session) return;
    try {
      const data = await req("/v1/checkins", {
        method: "POST",
        body: JSON.stringify({ ...payload, checkinPointId: gate }),
      }, session);
      showResult({
        result: data.result,
        code: data.ticket?.code,
        name: data.ticket?.attendeeName,
        lot: data.ticket ? `${data.ticket.typeName} — ${data.ticket.lotName}` : undefined,
        firstAt: data.firstCheckin?.at,
        firstDevice: data.firstCheckin?.deviceName,
        checkinId: data.checkinId,
      });
    } catch {
      // offline/erro de rede: enfileira e valida localmente de forma otimista
      const queue = JSON.parse(localStorage.getItem(Q_KEY) ?? "[]");
      queue.push({ ...payload, scannedAt: new Date().toISOString(), checkinPointId: gate });
      localStorage.setItem(Q_KEY, JSON.stringify(queue));
      setQueueLen(queue.length);
      showResult({ result: "VALID", code: payload.code ?? "QR lido", offline: true });
    }
  }, [session, gate, showResult]);

  // scanner com BarcodeDetector (Chrome/Android); fallback: entrada manual
  useEffect(() => {
    if (screen !== "scanner" || !scanning) return;
    let raf = 0;
    let cancelled = false;
    async function run() {
      const Detector = (window as any).BarcodeDetector;
      if (!Detector) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const detector = new Detector({ formats: ["qr_code"] });
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) {
              const raw = codes[0].rawValue as string;
              stopCamera();
              setScanning(false);
              await checkin(raw.startsWith("BF1.") ? { qrToken: raw } : { code: raw });
              return;
            }
          } catch { /* frame ruim, segue */ }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setScanning(false); // permissão negada → manual
      }
    }
    function stopCamera() {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    run();
    return () => { cancelled = true; cancelAnimationFrame(raf); stopCamera(); };
  }, [screen, scanning, checkin]);

  async function syncQueue() {
    if (!session) return;
    const queue = JSON.parse(localStorage.getItem(Q_KEY) ?? "[]");
    if (queue.length === 0) return;
    // fila offline manual só tem code — resolve ticketId não é possível offline;
    // o caminho de sync usa os check-ins com qrToken parseado no servidor via /v1/checkins
    for (const item of [...queue]) {
      try {
        await req("/v1/checkins", { method: "POST", body: JSON.stringify(item) }, session);
        queue.shift();
        localStorage.setItem(Q_KEY, JSON.stringify(queue));
        setQueueLen(queue.length);
      } catch { break; }
    }
  }

  async function reverter(checkinId: string) {
    if (!session) return;
    try {
      await req(`/v1/validator/checkins/${checkinId}/reverse`, { method: "POST" }, session);
      setLastConfirmed((prev) => prev.filter((c) => c.checkinId !== checkinId));
      const next = Math.max(0, count - 1);
      setCount(next);
      localStorage.setItem(C_KEY, String(next));
    } catch { /* já revertido */ }
  }

  // ------------------------------- telas -----------------------------------

  if (screen === "pin") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-bg-dark px-8 text-white">
        <p className="text-[22px] font-extrabold text-primary">BoraFest</p>
        <h1 className="mt-2 text-[16px] font-bold">Digite o PIN de acesso fornecido pelo produtor</h1>
        <select value={eventId} onChange={(e) => setEventId(e.target.value)}
          className="mt-5 h-12 w-full rounded-xl border border-white/15 bg-white/10 px-4 text-[14px] font-semibold text-white">
          <option value="" className="text-ink">Selecione o evento</option>
          {events.map((ev) => <option key={ev.id} value={ev.id} className="text-ink">{ev.title}</option>)}
        </select>
        <div className={`mt-6 flex gap-3 ${pinError ? "animate-shake" : ""}`}>
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className={`h-4 w-4 rounded-full ${i < pin.length ? "bg-primary" : "bg-white/15"}`} />
          ))}
        </div>
        {pinError && <p className="mt-2 text-[12px] font-bold text-danger">PIN inválido. Confira o código com o produtor.</p>}
        <div className="mt-6 grid grid-cols-3 gap-3">
          {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k, i) => (
            <button key={i} disabled={!k}
              onClick={() => {
                if (k === "⌫") setPin((p) => p.slice(0, -1));
                else if (pin.length < 6) {
                  const next = pin + k;
                  setPin(next);
                  if (next.length === 6 && eventId) loginPin(next);
                }
              }}
              className="h-16 w-16 rounded-2xl bg-white/10 text-[22px] font-bold disabled:opacity-0">
              {k}
            </button>
          ))}
        </div>
        <a href="/legal" className="mt-8 text-[11px] font-semibold text-white/50 underline">política de privacidade</a>
      </main>
    );
  }

  if (screen === "gate" && session) {
    return (
      <main className="flex min-h-dvh flex-col bg-bg-dark px-6 py-10 text-white">
        <button onClick={() => { localStorage.removeItem(S_KEY); setSession(null); setScreen("pin"); }}
          className="self-end text-[12px] font-bold text-white/60">Sair</button>
        <h1 className="mt-4 text-[20px] font-extrabold">{session.event.title}</h1>
        <p className="mt-1 text-[13px] font-semibold text-white/60">Selecione o portão</p>
        <div className="mt-4 space-y-2.5">
          <button onClick={() => setGate(undefined)}
            className={`w-full rounded-2xl border p-4 text-left text-[14px] font-bold ${!gate ? "border-primary bg-primary/20" : "border-white/15 bg-white/5"}`}>
            Sem portão específico
          </button>
          {session.checkinPoints.map((p) => (
            <button key={p.id} onClick={() => setGate(p.id)}
              className={`w-full rounded-2xl border p-4 text-left text-[14px] font-bold ${gate === p.id ? "border-primary bg-primary/20" : "border-white/15 bg-white/5"}`}>
              {p.name}
            </button>
          ))}
        </div>
        <button onClick={() => setScreen("scanner")}
          className="mt-8 h-14 rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta">
          Iniciar validação
        </button>
      </main>
    );
  }

  if (screen === "scanner" && session) {
    return (
      <main className="flex min-h-dvh flex-col bg-bg-dark px-6 py-8 text-white">
        <div className="flex items-center justify-between">
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold ${online ? "bg-success/20 text-emerald-300" : "bg-warning/20 text-amber-300"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${online ? "animate-pulseDot bg-emerald-400" : "bg-amber-400"}`} />
            {online ? "Online" : "Offline"}
          </span>
          <button onClick={() => setScreen("resumo")} className="text-[12px] font-bold text-white/70">Resumo</button>
        </div>

        <div className="relative mx-auto mt-6 aspect-square w-full max-w-[320px] overflow-hidden rounded-3xl border-2 border-[#a78bfa]/60 bg-black">
          {scanning ? (
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          ) : (
            <button onClick={() => setScanning(true)} className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/70">
              <span className="text-[40px]">📷</span>
              <span className="text-[13px] font-bold">Tocar para ligar a câmera</span>
              <span className="px-6 text-center text-[11px] text-white/40">
                Usamos a câmera apenas para ler o QR — nada é gravado.
              </span>
            </button>
          )}
          <div className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-[#a78bfa]" />
        </div>

        <p className="mt-4 text-center text-[13px] font-bold">{count} entradas confirmadas{queueLen > 0 ? ` · ${queueLen} na fila` : ""}</p>

        <div className="mt-6">
          <p className="text-[12px] font-bold text-white/60">Busca manual (código do ingresso)</p>
          <div className="mt-2 flex gap-2">
            <input value={manual} onChange={(e) => setManual(e.target.value.toUpperCase())} placeholder="BF-XXXX-XXXX"
              className="h-12 w-full rounded-xl border border-white/15 bg-white/10 px-4 text-[14px] font-bold uppercase text-white placeholder:text-white/30" />
            <button onClick={() => { if (manual.length >= 6) { checkin({ code: manual }); setManual(""); } }}
              className="h-12 shrink-0 rounded-xl bg-success px-5 text-[13px] font-extrabold">Check-in</button>
          </div>
        </div>
      </main>
    );
  }

  if (screen === "result" && result) {
    const bg = result.result === "VALID" ? "from-[#12a150] to-[#0f8a45]"
      : result.result === "ALREADY_USED" ? "from-[#f59e0b] to-[#d97706]"
      : "from-[#e11d48] to-[#be123c]";
    const label = result.result === "VALID" ? "Válido" : result.result === "ALREADY_USED" ? "Já utilizado" : result.result === "CANCELED" ? "Cancelado" : "Inválido";
    const icon = result.result === "VALID" ? "✓" : result.result === "ALREADY_USED" ? "⏱" : "✕";
    return (
      <main className={`flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b px-8 text-white ${bg}`}>
        <div className={`flex h-[108px] w-[108px] items-center justify-center rounded-full bg-white text-[52px] font-extrabold ${result.result === "VALID" ? "animate-pop text-success" : result.result === "ALREADY_USED" ? "text-warning" : "animate-shake text-danger"}`}>
          {icon}
        </div>
        <h1 className="mt-5 text-[34px] font-extrabold">{label}</h1>
        {result.offline && <p className="mt-1 text-[12px] font-bold text-white/80">validado offline — sincroniza quando a rede voltar</p>}
        <div className="mt-5 w-full rounded-2xl bg-white/15 p-4 text-[13px] font-semibold backdrop-blur">
          {result.name && <p>Portador: <span className="font-extrabold">{result.name}</span></p>}
          {result.code && <p>Ingresso: <span className="font-extrabold">{result.code}</span></p>}
          {result.lot && <p>{result.lot}</p>}
          {result.result === "ALREADY_USED" && result.firstAt && (
            <p className="mt-1">1º uso: {new Date(result.firstAt).toLocaleTimeString("pt-BR")}{result.firstDevice ? ` · ${result.firstDevice}` : ""}</p>
          )}
        </div>
        <button onClick={() => setScreen("scanner")} className="mt-8 h-[58px] w-full rounded-2xl bg-white text-[16px] font-extrabold text-ink">
          Próximo
        </button>
      </main>
    );
  }

  if (screen === "resumo" && session) {
    return (
      <main className="flex min-h-dvh flex-col bg-bg-dark px-6 py-10 text-white">
        <button onClick={() => setScreen("scanner")} className="self-start text-[12px] font-bold text-white/60">← Voltar ao scanner</button>
        <h1 className="mt-4 text-[20px] font-extrabold">Resumo de portaria</h1>
        <div className="mt-4 rounded-3xl bg-brand-gradient p-6">
          <p className="text-[36px] font-extrabold">{count}</p>
          <p className="text-[13px] font-bold text-white/80">entradas confirmadas neste aparelho</p>
        </div>
        {queueLen > 0 && (
          <div className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4">
            <p className="text-[13px] font-bold text-amber-300">{queueLen} pendente{queueLen > 1 ? "s" : ""} de sincronização</p>
            <button onClick={syncQueue} className="mt-2 rounded-xl bg-amber-400 px-4 py-2 text-[12px] font-extrabold text-ink">Sincronizar agora</button>
          </div>
        )}
        <h2 className="mt-6 text-[14px] font-extrabold text-white/80">Últimas entradas</h2>
        <div className="mt-2 space-y-2">
          {lastConfirmed.length === 0 && <p className="text-[12px] text-white/40">Nenhuma nesta sessão.</p>}
          {lastConfirmed.map((c) => (
            <div key={c.checkinId} className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3 text-[13px] font-semibold">
              <span>{c.code} · {c.at}</span>
              <button onClick={() => reverter(c.checkinId)} className="rounded-lg bg-danger/20 px-3 py-1.5 text-[11px] font-extrabold text-red-300">
                Reverter
              </button>
            </div>
          ))}
        </div>
      </main>
    );
  }

  return null;
}
