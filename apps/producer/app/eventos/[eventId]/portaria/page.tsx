"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth";
import { CHECKOUT_URL } from "@/lib/config";
import {
  validatorConfigApi,
  type CheckinPoint,
  type RecentCheckin,
  type ValidatorDevice,
} from "@/lib/api";

/**
 * ONDE A EQUIPE VALIDA (2026-10-12): a tela criava portões e PIN mas não dizia
 * ONDE usar — a Ajuda falava de um "app de validação" que nunca existiu, e o
 * produtor adivinhava o endereço na noite do evento. A portaria é a página
 * /portaria do site; o endereço sai da URL do site já configurada no painel.
 */
const PORTARIA_URL = `${CHECKOUT_URL.replace(/\/$/, "")}/portaria`;
/** Como a equipe digita no celular (ex.: borafest.com.br/portaria). */
const PORTARIA_CURTA = PORTARIA_URL.replace(/^https?:\/\//, "");

/** Hora da entrada; com a data junto quando não foi hoje (festa que vira a noite). */
function quando(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "—";
  const hora = data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (data.toDateString() === new Date().toDateString()) return hora;
  return `${data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hora}`;
}

/** Quem entrou: o nome do ingresso; sem nome, o do comprador; sem nada, o código. */
function quemEntrou(entrada: RecentCheckin): string {
  return entrada.name ?? entrada.buyerName ?? entrada.code;
}

function PortariaContent({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const [points, setPoints] = useState<CheckinPoint[]>([]);
  const [devices, setDevices] = useState<ValidatorDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [pointName, setPointName] = useState("");
  const [credentialLabel, setCredentialLabel] = useState("");
  const [generatedPin, setGeneratedPin] = useState<{ label: string; pin: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ERRO NÃO VIRA "ZERO" (2026-10-12): a falha ao carregar não tinha catch — a tela
  // ficava sem portões e com "Nenhum aparelho registrado ainda", e o produtor
  // recriava portão que já existia. Agora o erro aparece com "Tentar novamente".
  const [loadError, setLoadError] = useState<string | null>(null);

  // endereço da portaria
  const [copiado, setCopiado] = useState(false);
  const [copiaErro, setCopiaErro] = useState<string | null>(null);

  // DESFAZER ENTRADA (2026-10-12): na porta, o aparelho só desfaz as próprias
  // entradas dos últimos 10 minutos. Depois disso — ou de outro aparelho — a
  // entrada registrada por engano só se desfazia chamando a API na mão.
  const [entradas, setEntradas] = useState<RecentCheckin[]>([]);
  const [temMais, setTemMais] = useState(false);
  const [entradasLoading, setEntradasLoading] = useState(true);
  // erro da lista é separado do de portões/aparelhos: um não esconde o outro
  const [entradasErro, setEntradasErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [confirmando, setConfirmando] = useState<RecentCheckin | null>(null);
  const [desfazendo, setDesfazendo] = useState(false);
  const [desfazerErro, setDesfazerErro] = useState<string | null>(null);
  const [desfeito, setDesfeito] = useState<string | null>(null);
  // resposta atrasada de uma busca antiga não sobrescreve a da busca nova
  const pedidoEntradas = useRef(0);
  // o "Tentar novamente" repete a busca que falhou, não a última que deu certo
  const termoTentado = useRef("");
  // clique duplo: o segundo toque chega antes de o botão desabilitar
  const desfazendoRef = useRef(false);

  async function load() {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [pointsList, devicesList] = await Promise.all([
        validatorConfigApi.listCheckinPoints(token, eventId),
        validatorConfigApi.listDevices(token, eventId),
      ]);
      setPoints(pointsList);
      setDevices(devicesList);
    } catch (err) {
      setLoadError(
        err instanceof Error && err.message ? err.message : "Não foi possível carregar os portões e aparelhos",
      );
    } finally {
      setLoading(false);
    }
  }

  async function carregarEntradas(termo: string) {
    if (!token) return;
    const meu = ++pedidoEntradas.current;
    termoTentado.current = termo;
    setEntradasLoading(true);
    setEntradasErro(null);
    try {
      const resposta = await validatorConfigApi.listRecentCheckins(token, eventId, termo || undefined);
      if (meu !== pedidoEntradas.current) return;
      setEntradas(resposta.entries);
      setTemMais(resposta.hasMore);
      setBuscaAplicada(termo);
    } catch (err) {
      if (meu !== pedidoEntradas.current) return;
      setEntradasErro(
        err instanceof Error && err.message ? err.message : "Não foi possível carregar as entradas",
      );
    } finally {
      if (meu === pedidoEntradas.current) setEntradasLoading(false);
    }
  }

  useEffect(() => {
    load();
    carregarEntradas("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, eventId]);

  async function handleCreatePoint() {
    if (!token || !pointName) return;
    setError(null);
    try {
      await validatorConfigApi.createCheckinPoint(token, eventId, pointName);
      setPointName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o portão");
    }
  }

  async function handleCreateCredential() {
    if (!token || !credentialLabel) return;
    setError(null);
    try {
      const result = await validatorConfigApi.createCredential(token, eventId, credentialLabel);
      setGeneratedPin({ label: result.label, pin: result.pin });
      setCredentialLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar o PIN");
    }
  }

  async function handleBlockDevice(deviceId: string) {
    if (!token) return;
    setError(null);
    try {
      await validatorConfigApi.blockDevice(token, eventId, deviceId);
      await load();
    } catch (err) {
      // bloquear aparelho falhava em silêncio — o produtor achava que bloqueou (2026-10-12)
      setError(err instanceof Error ? err.message : "Não foi possível bloquear o aparelho");
    }
  }

  async function copiarEndereco() {
    setCopiaErro(null);
    try {
      // sem permissão de área de transferência (ou fora de https) o navegador
      // recusa — a pessoa precisa saber que NÃO copiou
      await navigator.clipboard.writeText(PORTARIA_URL);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      setCopiaErro("Não deu para copiar — selecione o endereço e copie à mão.");
    }
  }

  function buscarEntradas(termo: string) {
    setConfirmando(null);
    setDesfazerErro(null);
    setDesfeito(null);
    carregarEntradas(termo.trim());
  }

  async function desfazerEntrada(entrada: RecentCheckin) {
    if (!token || desfazendoRef.current) return;
    desfazendoRef.current = true;
    setDesfazendo(true);
    setDesfazerErro(null);
    try {
      const resposta = await validatorConfigApi.reverseCheckin(token, entrada.checkinId);
      // a mensagem sai do que o SERVIDOR fez: ingresso que já não valia
      // (cancelado) não volta a valer, mesmo com a entrada desfeita
      setDesfeito(
        resposta.ticketActive === false
          ? `Entrada de ${quemEntrou(entrada)} desfeita. O ingresso ${entrada.code} já não valia e continua sem valer na porta.`
          : `Entrada de ${quemEntrou(entrada)} desfeita. O ingresso ${entrada.code} voltou a valer na porta.`,
      );
      setConfirmando(null);
      await carregarEntradas(buscaAplicada);
    } catch (err) {
      setDesfazerErro(err instanceof Error && err.message ? err.message : "Não foi possível desfazer a entrada");
    } finally {
      desfazendoRef.current = false;
      setDesfazendo(false);
    }
  }

  return (
    <main>
      <h1 className="mt-2 text-xl font-extrabold">Portaria e validadores</h1>

      {error ? <p className="mt-4 text-sm font-semibold text-danger">{error}</p> : null}
      {loadError ? (
        <div className="mt-4 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-center">
          <p className="text-[13px] font-bold text-danger">
            Não deu para carregar os portões e aparelhos ({loadError}) — confira antes de cadastrar de novo.
          </p>
          <button
            type="button"
            onClick={load}
            className="mt-3 h-10 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta"
          >
            Tentar novamente
          </button>
        </div>
      ) : null}

      <section className="mt-6">
        <h2 className="text-sm font-bold">Onde a equipe valida</h2>
        <div className="mt-2 flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-xl border border-line bg-surface px-4 py-3 text-[13px] font-semibold">
                {PORTARIA_CURTA}
              </code>
              <button type="button" className="btn-secondary" onClick={copiarEndereco}>
                {copiado ? "Copiado!" : "Copiar"}
              </button>
            </div>
            <p className="mt-2 text-[12px] font-semibold text-muted">
              Abra no celular de cada pessoa da porta e entre com o PIN do portão.
            </p>
            {copiaErro ? <p className="mt-1 text-[12px] font-semibold text-danger">{copiaErro}</p> : null}
          </div>
          <div className="rounded-xl border border-line bg-white p-2.5">
            <QRCode value={PORTARIA_URL} size={110} title={`QR para abrir ${PORTARIA_CURTA}`} />
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-bold">Portões</h2>
        <div className="mt-2 flex gap-2">
          <input
            placeholder="Nome do portão (ex.: Portão A)"
            className="min-w-0 flex-1"
            value={pointName}
            onChange={(e) => setPointName(e.target.value)}
          />
          <button type="button" className="btn-primary" onClick={handleCreatePoint}>
            Adicionar
          </button>
        </div>
        <ul className="mt-3 space-y-1 text-sm font-semibold">
          {points.map((point) => (
            <li key={point.id}>{point.name}</li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-bold">Gerar PIN para a equipe de portaria</h2>
        <div className="mt-2 flex gap-2">
          <input
            placeholder="Rótulo (ex.: Equipe portão A)"
            className="min-w-0 flex-1"
            value={credentialLabel}
            onChange={(e) => setCredentialLabel(e.target.value)}
          />
          <button type="button" className="btn-primary" onClick={handleCreateCredential}>
            Gerar PIN
          </button>
        </div>
        {generatedPin ? (
          <div className="mt-3 rounded-xl border border-warning/30 bg-warning/10 p-4">
            <p className="text-sm font-semibold text-warning">
              PIN para <strong>{generatedPin.label}</strong> — anote agora, não será mostrado de novo:
            </p>
            <p className="mt-2 text-3xl font-bold tracking-widest">{generatedPin.pin}</p>
          </div>
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-bold">Aparelhos registrados</h2>
        {loading ? (
          <p className="mt-2 text-muted">Carregando...</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[12px] font-bold text-muted">
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Registrado em</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <tr key={device.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 font-semibold">{device.name}</td>
                    <td className="px-4 py-3 text-muted">{device.status}</td>
                    <td className="px-4 py-3 text-muted">{new Date(device.registeredAt).toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-3">
                      {device.status === "ACTIVE" ? (
                        <button
                          type="button"
                          className="font-bold text-danger underline"
                          onClick={() => handleBlockDevice(device.id)}
                        >
                          Bloquear
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !loadError && devices.length === 0 ? (
          <p className="mt-2 text-sm font-semibold text-muted">Nenhum aparelho registrado ainda.</p>
        ) : null}
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Entradas recentes</h2>
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-[12px]"
            onClick={() => buscarEntradas(buscaAplicada)}
          >
            {entradasLoading ? "Atualizando..." : "Atualizar"}
          </button>
        </div>
        <p className="mt-1 text-[12px] font-semibold text-muted">
          Entrada registrada por engano? Desfaça aqui. Na porta, o aparelho só desfaz as próprias entradas dos
          últimos 10 minutos.
        </p>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            buscarEntradas(busca);
          }}
        >
          <input
            placeholder="Buscar por nome ou código"
            className="min-w-0 flex-1"
            value={busca}
            maxLength={80}
            onChange={(e) => setBusca(e.target.value)}
          />
          <button type="submit" className="btn-secondary">
            Buscar
          </button>
        </form>

        {desfeito ? (
          <p className="mt-3 rounded-lg bg-success/10 px-3 py-2.5 text-[13px] font-bold text-success">{desfeito}</p>
        ) : null}

        {entradasErro ? (
          <div className="mt-3 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-center">
            <p className="text-[13px] font-bold text-danger">
              Não deu para carregar as entradas ({entradasErro}).
            </p>
            <button
              type="button"
              onClick={() => buscarEntradas(termoTentado.current)}
              className="mt-3 h-10 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta"
            >
              Tentar novamente
            </button>
          </div>
        ) : entradasLoading && entradas.length === 0 ? (
          <p className="mt-3 text-muted">Carregando...</p>
        ) : entradas.length === 0 ? (
          <p className="mt-3 text-sm font-semibold text-muted">
            {buscaAplicada ? "Nenhuma entrada com esse nome ou código." : "Nenhuma entrada registrada ainda."}
          </p>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[12px] font-bold text-muted">
                    <th className="px-3 py-3 sm:px-4">Entrou</th>
                    <th className="px-3 py-3 sm:px-4">Ingresso</th>
                    <th className="px-3 py-3 sm:px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {entradas.map((entrada) => {
                    const aberta = confirmando?.checkinId === entrada.checkinId;
                    return (
                      <Fragment key={entrada.checkinId}>
                        <tr className={aberta ? "" : "border-b border-line last:border-0"}>
                          <td className="px-3 py-3 sm:px-4">
                            <span className="font-semibold">
                              {quando(entrada.at)} · {entrada.gate ?? "Sem portão"}
                            </span>
                            <span className="block text-[11.5px] text-muted">
                              {entrada.deviceName}
                              {entrada.offline ? " · registrada sem internet" : ""}
                            </span>
                          </td>
                          <td className="px-3 py-3 sm:px-4">
                            <span className="font-semibold">{entrada.name ?? entrada.buyerName ?? "Sem nome"}</span>
                            {!entrada.name && entrada.buyerName ? (
                              <span className="text-muted"> (comprador)</span>
                            ) : null}{" "}
                            · {entrada.typeName}
                            {entrada.meia ? " · Meia" : ""}
                            <span className="block font-mono text-[11.5px] text-muted">{entrada.code}</span>
                          </td>
                          <td className="px-3 py-3 text-right sm:px-4">
                            {!entrada.canUndo ? (
                              <span className="text-[12px] font-semibold text-muted">
                                Pedido cancelado ou reembolsado
                              </span>
                            ) : aberta ? null : (
                              <button
                                type="button"
                                className="btn-secondary whitespace-nowrap px-3 py-1.5 text-[12px]"
                                onClick={() => {
                                  setDesfazerErro(null);
                                  setDesfeito(null);
                                  setConfirmando(entrada);
                                }}
                              >
                                Desfazer entrada
                              </button>
                            )}
                          </td>
                        </tr>
                        {aberta ? (
                          <tr className="border-b border-line last:border-0">
                            <td colSpan={3} className="px-3 pb-4 sm:px-4">
                              <div className="space-y-2 rounded-xl border-[1.5px] border-danger/35 bg-danger/[.06] p-3.5">
                                <h3 className="text-[14px] font-extrabold">
                                  Desfazer a entrada de {quemEntrou(entrada)}?
                                </h3>
                                <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-soft">
                                  <li>O ingresso volta a valer: o QR passa de novo na porta.</li>
                                  <li>A entrada sai da contagem de presentes.</li>
                                  <li>
                                    Aparelho da porta que estiver sem internet ainda mostra &quot;Já utilizado&quot; até
                                    sincronizar.
                                  </li>
                                </ul>
                                {desfazerErro ? (
                                  <p className="text-[13px] font-semibold text-danger">{desfazerErro}</p>
                                ) : null}
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfirmando(null);
                                      setDesfazerErro(null);
                                    }}
                                    className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-bold text-muted"
                                  >
                                    Voltar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => desfazerEntrada(entrada)}
                                    disabled={desfazendo}
                                    className="flex-1 rounded-lg bg-danger px-3 py-2 text-[13px] font-bold text-white disabled:opacity-40"
                                  >
                                    {desfazendo
                                      ? "Desfazendo..."
                                      : desfazerErro
                                        ? "Tentar novamente"
                                        : "Confirmar"}
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {temMais ? (
              <p className="mt-2 text-[12px] font-semibold text-muted">
                Mostrando as 50 entradas mais recentes. Use a busca para achar outra.
              </p>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}

export default function PortariaPage({ params }: { params: { eventId: string } }) {
  return (
    <AuthGuard>
      <PortariaContent eventId={params.eventId} />
    </AuthGuard>
  );
}
