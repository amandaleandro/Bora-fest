"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth";
import {
  convitesEmailApi,
  type ConviteEmail,
  type ConvitesDoLote,
  type LoteDeConviteEmail,
  type ResultadoDoEnvioDeConvites,
  type SituacaoConviteEmail,
} from "@/lib/api";

/**
 * CONVITE POR E-MAIL (2026-10-12) — 3ª forma do ingresso restrito, formato
 * Sympla. O produtor cola os e-mails, cada pessoa recebe um link pessoal e só
 * ela pega o ingresso com aquele e-mail. Toda trava é do servidor (reserva e
 * pedido); esta tela só convida e mostra a situação de cada convite.
 */

/** Mesmo limite do servidor (LIMITE_CONVITES_POR_ENVIO em @borafest/contracts). */
const LIMITE_POR_ENVIO = 200;

const SITUACAO: Record<SituacaoConviteEmail, { label: string; cls: string }> = {
  ENVIADO: { label: "Enviado", cls: "bg-line text-muted" },
  ENTREGUE: { label: "Entregue", cls: "bg-line text-muted" },
  VOLTOU: { label: "E-mail voltou", cls: "bg-danger/10 text-danger" },
  NAO_SAIU: { label: "E-mail não saiu", cls: "bg-danger/10 text-danger" },
  PAGANDO: { label: "Pagamento pendente", cls: "bg-warning/10 text-warning" },
  PEGOU: { label: "Pegou", cls: "bg-success/10 text-success" },
  REVOGADO: { label: "Revogado", cls: "bg-line text-muted-3" },
};

/**
 * Separa o que foi colado. Cópia local de propósito: os apps web não dependem
 * de `@borafest/contracts` (mesmo motivo do ehCpfValido da lista de
 * convidados). Quem valida de verdade é o servidor — ele devolve cada e-mail
 * recusado com o motivo, então nada some calado aqui.
 */
function separarEmails(texto: string): string[] {
  const pedacos: string[] = [];
  for (const linha of texto.split(/[\n\r,;]+/)) {
    const limpa = linha.trim();
    if (!limpa) continue;
    // "Nome <email>" (copiado do Gmail/Outlook): fica só o endereço
    const entreSinais = limpa.match(/<([^>]+)>/);
    if (entreSinais) {
      pedacos.push(entreSinais[1]);
      continue;
    }
    // vários e-mails separados por espaço na mesma linha
    const partes = limpa.split(/\s+/);
    if (partes.length > 1 && partes.every((p) => p.includes("@"))) pedacos.push(...partes);
    else pedacos.push(limpa);
  }
  return pedacos
    .map((p) => p.trim().toLowerCase().replace(/^[("'<]+|[>)"'.]+$/g, ""))
    .filter(Boolean);
}

function quando(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function plural(n: number, um: string, varios: string): string {
  return n === 1 ? um : varios;
}

type Aviso = { tipo: "ok" | "erro"; texto: string };

function ConvitesContent({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const router = useRouter();
  const loteId = useSearchParams().get("lote") ?? "";

  // lotes de convite por e-mail do evento (escolher qual convidar)
  const [lotes, setLotes] = useState<LoteDeConviteEmail[] | null>(null);
  const [lotesErro, setLotesErro] = useState<string | null>(null);

  // convites do lote escolhido
  const [dados, setDados] = useState<ConvitesDoLote | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // colar e enviar
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [envioErro, setEnvioErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoDoEnvioDeConvites | null>(null);

  // ações por linha (confirmação no próprio lugar, como o "Cancelar ingresso")
  const [aberto, setAberto] = useState<{ id: string; tipo: "corrigir" | "revogar" } | null>(null);
  const [emailCorrigido, setEmailCorrigido] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<Record<string, Aviso>>({});

  const carregarLotes = useCallback(async () => {
    if (!token) return;
    setLotesErro(null);
    try {
      setLotes(await convitesEmailApi.lotes(token, eventId));
    } catch (err) {
      setLotesErro(err instanceof Error && err.message ? err.message : "Não foi possível carregar os lotes");
    }
  }, [token, eventId]);

  // ERRO NÃO VIRA "ZERO": falhou ao atualizar com a lista já na tela, a lista
  // fica e o erro aparece em cima; sem lista, o erro aparece no lugar dela
  const carregarConvites = useCallback(
    async (silencioso = false) => {
      if (!token || !loteId) return;
      if (!silencioso) setCarregando(true);
      try {
        setDados(await convitesEmailApi.listar(token, loteId));
        setErro(null);
      } catch (err) {
        setErro(err instanceof Error && err.message ? err.message : "Não foi possível carregar os convites");
      } finally {
        if (!silencioso) setCarregando(false);
      }
    },
    [token, loteId],
  );

  useEffect(() => {
    carregarLotes();
  }, [carregarLotes]);

  useEffect(() => {
    setDados(null);
    setErro(null);
    setResultado(null);
    setAberto(null);
    setAvisos({});
    carregarConvites();
  }, [carregarConvites]);

  // sem ?lote= e com um lote só: abre direto nele
  useEffect(() => {
    if (!loteId && lotes && lotes.length === 1) {
      router.replace(`/eventos/${eventId}/convites?lote=${lotes[0].id}`);
    }
  }, [loteId, lotes, eventId, router]);

  // entregue / voltou / pegou mudam sozinhos (webhook do e-mail, compra): atualiza sem F5
  useEffect(() => {
    if (!token || !loteId) return;
    const id = setInterval(() => carregarConvites(true), 20_000);
    return () => clearInterval(id);
  }, [token, loteId, carregarConvites]);

  const colados = useMemo(() => separarEmails(texto), [texto]);
  const unicos = useMemo(() => new Set(colados).size, [colados]);
  const passouDoLimite = colados.length > LIMITE_POR_ENVIO;
  const motivoTravado = dados?.motivoParaNaoMandar ?? null;

  async function enviar() {
    if (!token || !loteId || unicos === 0 || passouDoLimite || motivoTravado) return;
    setEnviando(true);
    setEnvioErro(null);
    setResultado(null);
    try {
      const r = await convitesEmailApi.criar(token, loteId, colados);
      setResultado(r);
      // o que o servidor recusou fica no campo para corrigir; o resto sai
      setTexto(r.invalidos.map((i) => i.email).join("\n"));
      await carregarConvites(true);
      carregarLotes();
    } catch (err) {
      setEnvioErro(err instanceof Error && err.message ? err.message : "Não foi possível enviar os convites");
    } finally {
      setEnviando(false);
    }
  }

  async function agir(convite: ConviteEmail, acao: "reenviar" | "corrigir" | "revogar") {
    if (!token) return;
    setOcupado(convite.id);
    setAvisos((a) => {
      const resto = { ...a };
      delete resto[convite.id];
      return resto;
    });
    try {
      if (acao === "reenviar") await convitesEmailApi.reenviar(token, convite.id);
      if (acao === "corrigir") await convitesEmailApi.corrigir(token, convite.id, emailCorrigido.trim());
      if (acao === "revogar") await convitesEmailApi.revogar(token, convite.id);
      setAberto(null);
      setAvisos((a) => ({
        ...a,
        [convite.id]: {
          tipo: "ok",
          texto:
            acao === "reenviar"
              ? "Convite reenviado — mesmo link de antes."
              : acao === "corrigir"
                ? "E-mail corrigido e convite enviado com um link novo. O link antigo não vale mais."
                : "Convite revogado. O link não funciona mais.",
        },
      }));
      await carregarConvites(true);
      if (acao === "revogar") carregarLotes();
    } catch (err) {
      setAvisos((a) => ({
        ...a,
        [convite.id]: {
          tipo: "erro",
          texto: err instanceof Error && err.message ? err.message : "Não deu certo. Tente novamente.",
        },
      }));
    } finally {
      setOcupado(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Sem lote escolhido: escolher (ou explicar por que não há)
  // ---------------------------------------------------------------------------
  if (!loteId) {
    return (
      <main>
        <div className="mt-2">
          <h1 className="text-[22px] font-extrabold">Convidar por e-mail</h1>
          <Link href={`/eventos/${eventId}`} className="text-[13px] font-bold text-primary">
            Voltar ao evento →
          </Link>
        </div>
        <section className="mt-5 rounded-2xl border border-line bg-surface p-5">
          {lotesErro ? (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-center">
              <p className="text-[13px] font-bold text-danger">{lotesErro}</p>
              <button
                type="button"
                onClick={carregarLotes}
                className="mt-3 h-10 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta"
              >
                Tentar novamente
              </button>
            </div>
          ) : lotes === null || lotes.length === 1 ? (
            <p className="text-[13px] text-muted">Carregando...</p>
          ) : lotes.length === 0 ? (
            <div>
              <h2 className="text-[15px] font-extrabold">Nenhum lote de convite por e-mail</h2>
              <p className="mt-1 text-[13px] font-semibold text-muted">
                Crie um lote com &quot;Quem pode pegar&quot; = &quot;Só quem eu convidar por e-mail&quot;. Depois de
                criar, cole a lista de e-mails aqui.
              </p>
              <Link href={`/eventos/${eventId}`} className="btn-primary mt-4">
                Ir para Ingressos &amp; lotes
              </Link>
            </div>
          ) : (
            <div>
              <h2 className="text-[15px] font-extrabold">Qual lote você quer convidar?</h2>
              <div className="mt-3 space-y-2">
                {lotes.map((l) => (
                  <Link
                    key={l.id}
                    href={`/eventos/${eventId}/convites?lote=${l.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line-input bg-surface px-4 py-3 transition-colors hover:border-primary/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-extrabold">
                        {l.ticketTypeName} — {l.name}
                      </span>
                      <span className="block text-[12px] font-semibold text-muted">
                        {l.convites} {plural(l.convites, "convidado", "convidados")}
                      </span>
                    </span>
                    <span className="shrink-0 text-[13px] font-bold text-primary">Abrir →</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Lote escolhido
  // ---------------------------------------------------------------------------
  if (!dados) {
    return (
      <main>
        <div className="mt-2">
          <h1 className="text-[22px] font-extrabold">Convidar por e-mail</h1>
          <Link href={`/eventos/${eventId}`} className="text-[13px] font-bold text-primary">
            Voltar ao evento →
          </Link>
        </div>
        {erro && !carregando ? (
          <div className="mt-5 rounded-2xl border border-danger/30 bg-danger/5 p-6 text-center">
            <p className="text-[13px] font-bold text-danger">{erro}</p>
            <button
              type="button"
              onClick={() => carregarConvites()}
              className="mt-3 h-10 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta"
            >
              Tentar novamente
            </button>
          </div>
        ) : (
          <p className="mt-6 text-muted">Carregando...</p>
        )}
      </main>
    );
  }

  const outrosLotes = (lotes ?? []).filter((l) => l.id !== dados.lote.id);

  return (
    <main>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-[22px] font-extrabold">Convidar por e-mail · {dados.lote.name}</h1>
          <p className="text-[13px] font-semibold text-muted">
            {dados.lote.ticketTypeName} · {dados.lote.priceCents === 0 ? "Grátis" : "Pago"} ·{" "}
            {dados.lote.disponiveis} {plural(dados.lote.disponiveis, "vaga livre", "vagas livres")} no lote
          </p>
          <Link href={`/eventos/${eventId}`} className="text-[13px] font-bold text-primary">
            Voltar ao evento →
          </Link>
        </div>
        {outrosLotes.length > 0 ? (
          <select
            aria-label="Trocar de lote"
            className="w-full text-[13px] sm:w-auto"
            value={dados.lote.id}
            onChange={(e) => router.push(`/eventos/${eventId}/convites?lote=${e.target.value}`)}
          >
            {(lotes ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.ticketTypeName} — {l.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {/* com a lista na tela, uma falha ao atualizar aparece aqui e a lista fica */}
      {erro ? (
        <p className="mt-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-[13px] font-semibold text-danger">
          Não deu para atualizar os convites ({erro}).{" "}
          <button type="button" onClick={() => carregarConvites()} className="font-extrabold underline">
            Tentar novamente
          </button>
        </p>
      ) : null}

      <section className="mt-5 rounded-2xl border border-line bg-surface p-5">
        <label htmlFor="emails" className="block text-[12px] font-bold text-ink-soft">
          Cole os e-mails (um por linha)
        </label>
        <textarea
          id="emails"
          aria-label="E-mails"
          className="mt-1 h-28 w-full resize-y font-mono text-[12.5px]"
          placeholder={"ana.souza@gmail.com\ncarlos.m@hotmail.com"}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setEnvioErro(null);
          }}
          disabled={Boolean(motivoTravado)}
        />
        <p className="mt-1 text-[11.5px] font-medium text-muted">
          Cada pessoa recebe um link pessoal; só ela consegue pegar o ingresso com esse e-mail.
        </p>

        {motivoTravado ? (
          <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2.5 text-[13px] font-bold text-warning">{motivoTravado}</p>
        ) : null}
        {passouDoLimite ? (
          <p className="mt-3 text-[13px] font-semibold text-danger">
            Cole no máximo {LIMITE_POR_ENVIO} e-mails por vez — você colou {colados.length}. Envie em partes.
          </p>
        ) : null}
        {envioErro ? <p className="mt-3 text-[13px] font-semibold text-danger">{envioErro}</p> : null}

        <button
          type="button"
          className="btn-primary mt-3 w-full py-3 text-[14px] font-extrabold"
          onClick={enviar}
          disabled={enviando || unicos === 0 || passouDoLimite || Boolean(motivoTravado)}
        >
          {enviando
            ? "Enviando…"
            : unicos === 0
              ? "Enviar convites"
              : `Enviar ${unicos} ${plural(unicos, "convite", "convites")}`}
        </button>

        {resultado ? (
          <div className="mt-3 space-y-2">
            {resultado.enviados.length > 0 ? (
              <p className="rounded-lg bg-success/10 px-3 py-2.5 text-[13px] font-bold text-success">
                {resultado.enviados.length}{" "}
                {plural(resultado.enviados.length, "convite enviado", "convites enviados")}.
              </p>
            ) : null}
            {resultado.jaConvidados.length > 0 ? (
              <p className="text-[12.5px] font-semibold text-muted">
                {plural(resultado.jaConvidados.length, "Já tinha convite", "Já tinham convite")} neste lote e não{" "}
                {plural(resultado.jaConvidados.length, "recebeu", "receberam")} de novo:{" "}
                {resultado.jaConvidados.join(", ")}. Para mandar outra vez, use Reenviar na lista.
              </p>
            ) : null}
            {resultado.repetidosNaLista > 0 ? (
              <p className="text-[12.5px] font-semibold text-muted">
                {resultado.repetidosNaLista}{" "}
                {plural(resultado.repetidosNaLista, "e-mail repetido na lista foi contado", "e-mails repetidos na lista foram contados")}{" "}
                uma vez só.
              </p>
            ) : null}
            {resultado.invalidos.length > 0 ? (
              <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5">
                <p className="text-[13px] font-bold text-danger">
                  {resultado.invalidos.length}{" "}
                  {plural(resultado.invalidos.length, "e-mail não foi enviado", "e-mails não foram enviados")} —
                  corrija no campo acima e envie de novo:
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-ink-soft">
                  {resultado.invalidos.map((i, idx) => (
                    <li key={`${idx}-${i.email}`}>
                      <span className="font-mono">{i.email}</span> — {i.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {resultado.enviados.length === 0 &&
            resultado.jaConvidados.length === 0 &&
            resultado.invalidos.length === 0 ? (
              <p className="text-[13px] font-semibold text-muted">Nenhum e-mail encontrado no que foi colado.</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="mt-5 rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-extrabold">Convidados ({dados.resumo.convidados})</h2>
          <p className="text-[12.5px] font-semibold text-muted">
            {dados.resumo.pegaram} {plural(dados.resumo.pegaram, "pegou", "pegaram")}
            {dados.resumo.voltaram > 0
              ? ` · ${dados.resumo.voltaram} ${plural(dados.resumo.voltaram, "e-mail voltou", "e-mails voltaram")}`
              : ""}
          </p>
        </div>

        {dados.convites.length === 0 ? (
          <p className="mt-4 text-[13px] font-semibold text-muted">Nenhum convite enviado ainda.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2 pr-3 text-[11px] font-extrabold">Convidado</th>
                  <th className="py-2 pr-3 text-[11px] font-extrabold">Situação</th>
                  <th className="py-2 text-[11px] font-extrabold" />
                </tr>
              </thead>
              <tbody>
                {dados.convites.map((c) => {
                  const s = SITUACAO[c.situacao] ?? { label: c.situacao, cls: "bg-line text-muted" };
                  const aviso = avisos[c.id];
                  const esteAberto = aberto?.id === c.id ? aberto.tipo : null;
                  const trabalhando = ocupado === c.id;
                  return (
                    <tr key={c.id} className="border-b border-line align-top last:border-0">
                      <td className="py-2.5 pr-3">
                        <p className={`break-all font-semibold ${c.situacao === "REVOGADO" ? "text-muted-3 line-through" : ""}`}>
                          {c.email}
                        </p>
                        <p className="text-[11.5px] text-muted">
                          {c.situacao === "PEGOU" && c.pegouEm
                            ? `pegou em ${quando(c.pegouEm)}`
                            : `enviado em ${quando(c.enviadoEm)}`}
                        </p>

                        {esteAberto === "corrigir" ? (
                          <div className="mt-2 space-y-2 rounded-xl border-[1.5px] border-line-input bg-bg p-3">
                            <p className="text-[13px] font-extrabold">Corrigir o e-mail</p>
                            <input
                              type="email"
                              aria-label="E-mail certo"
                              className="w-full text-[13px]"
                              value={emailCorrigido}
                              onChange={(e) => setEmailCorrigido(e.target.value)}
                            />
                            <p className="text-[11.5px] text-muted">
                              O convite vai para o e-mail novo com um link novo. O link antigo para de funcionar.
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setAberto(null)}
                                className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-bold text-muted"
                              >
                                Voltar
                              </button>
                              <button
                                type="button"
                                onClick={() => agir(c, "corrigir")}
                                disabled={trabalhando || !emailCorrigido.trim()}
                                className="flex-1 rounded-lg bg-primary px-3 py-2 text-[13px] font-bold text-white disabled:opacity-40"
                              >
                                {trabalhando ? "Enviando..." : "Salvar e enviar"}
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {esteAberto === "revogar" ? (
                          <div className="mt-2 space-y-2 rounded-xl border-[1.5px] border-danger/35 bg-danger/[.06] p-3">
                            <p className="text-[13px] font-extrabold">Revogar o convite?</p>
                            <p className="text-[12.5px] text-ink-soft">
                              O link de {c.email} para de funcionar na hora e a pessoa não consegue mais pegar o
                              ingresso. Para convidar de novo, é só colar o e-mail outra vez.
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setAberto(null)}
                                className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-bold text-muted"
                              >
                                Voltar
                              </button>
                              <button
                                type="button"
                                onClick={() => agir(c, "revogar")}
                                disabled={trabalhando}
                                className="flex-1 rounded-lg bg-danger px-3 py-2 text-[13px] font-bold text-white disabled:opacity-40"
                              >
                                {trabalhando ? "Revogando..." : "Revogar convite"}
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {aviso ? (
                          <p
                            className={`mt-2 rounded-lg px-3 py-2 text-[12.5px] font-bold ${
                              aviso.tipo === "ok" ? "bg-success/10 text-success" : "bg-danger/5 text-danger"
                            }`}
                          >
                            {aviso.texto}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${s.cls}`}>
                          {s.label}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        {!esteAberto ? (
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {c.podeReenviar && c.situacao !== "VOLTOU" ? (
                              <button
                                type="button"
                                onClick={() => agir(c, "reenviar")}
                                disabled={trabalhando}
                                className="btn-secondary px-3 py-1.5 text-[12.5px] font-extrabold"
                              >
                                {trabalhando ? "Enviando..." : "Reenviar"}
                              </button>
                            ) : null}
                            {c.podeCorrigir && (c.situacao === "VOLTOU" || c.situacao === "NAO_SAIU") ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setEmailCorrigido(c.email);
                                  setAberto({ id: c.id, tipo: "corrigir" });
                                }}
                                disabled={trabalhando}
                                className="btn-secondary px-3 py-1.5 text-[12.5px] font-extrabold"
                              >
                                Corrigir
                              </button>
                            ) : null}
                            {c.podeRevogar ? (
                              <button
                                type="button"
                                onClick={() => setAberto({ id: c.id, tipo: "revogar" })}
                                disabled={trabalhando}
                                className="px-2 py-1.5 text-[12.5px] font-bold text-danger disabled:opacity-40"
                              >
                                Revogar
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-[11.5px] font-medium text-muted">
          Cancelou ou reembolsou o ingresso de alguém em Vendas? O convite volta a valer e a pessoa pode pegar de
          novo pelo mesmo link. Para tirar de vez, revogue o convite aqui.
        </p>
      </section>
    </main>
  );
}

export default function ConvitesPage({ params }: { params: { eventId: string } }) {
  return (
    <AuthGuard>
      <Suspense>
        <ConvitesContent eventId={params.eventId} />
      </Suspense>
    </AuthGuard>
  );
}
