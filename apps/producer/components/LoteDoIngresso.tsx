"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FeeModeField, NominalFields } from "@/components/FeeModeField";
import { useAuth } from "@/lib/auth";
import {
  catalogApi,
  type CreateLotInput,
  type FeeMode,
  type LotInviteMode,
  type LotesDaVirada,
  type ProducerLot,
  type UpdateLotInput,
} from "@/lib/api";

/**
 * LOTE NO PAINEL (protótipo aprovado em 2026-10-12, abas "Criar/editar lote" e
 * "Link de convite"): os mesmos campos para criar e editar, o card do lote com
 * o link de convite e as confirmações no próprio lugar (padrão do "Cancelar
 * ingresso"). A regra mora no SERVIDOR — aqui é só para o produtor não tomar
 * recusa à toa e entender o que cada escolha faz.
 */

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Aceita "49,90" e "49.90". Inválido/vazio → 0. */
export function parsePriceCents(value: string): number {
  const n = Number(value.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

/**
 * Espelho (só para exibição) da taxa calculada pelo SERVIDOR (fees.ts):
 * 5% do preço com piso de R$ 1; ingresso grátis = taxa 0.
 */
export function serviceFeeCents(priceCents: number): number {
  if (priceCents <= 0) return 0;
  return Math.max(Math.round(priceCents * 0.05), 100);
}

/** ISO → valor de <input type="datetime-local"> no fuso local (mesma conta do Editar evento). */
function paraCampoDeData(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "13/10 às 22:00" */
function dataCurta(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Failed to fetch" cru vira mensagem que o produtor entende (mesma regra da página do evento). */
function mensagemDeErro(err: unknown, padrao: string): string {
  if (err instanceof Error && /failed to fetch|networkerror|load failed/i.test(err.message)) {
    return "Falha de conexão com o servidor — confira a internet e tente de novo.";
  }
  return err instanceof Error && err.message ? err.message : padrao;
}

function inteiro(valor: string): number | null {
  const t = valor.trim();
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}

// ---------------------------------------------------------------------------
// "Quem pode pegar" — um campo só (formato Sympla escolhido pelo Arthur)
// ---------------------------------------------------------------------------

export type QuemPodePegar = "aberto" | "link" | "email" | "promoter" | "balcao";

const ROTULO_QUEM: Record<QuemPodePegar, string> = {
  aberto: "Aberto ao público",
  link: "Só com o link de convite",
  email: "Só quem eu convidar por e-mail",
  promoter: "Só pelo link de um promoter",
  balcao: "Só no balcão (venda na porta)",
};

/** Etiqueta curta no card do lote. */
const ETIQUETA_QUEM: Record<Exclude<QuemPodePegar, "aberto">, string> = {
  link: "Só com link de convite",
  email: "Só convidados por e-mail",
  promoter: "Só pelo link de promoter",
  balcao: "Só no balcão",
};

export function quemPodePegarDo(lote: Pick<ProducerLot, "inviteMode" | "promoterOnly" | "pdvOnly">): QuemPodePegar {
  if (lote.pdvOnly) return "balcao";
  if (lote.promoterOnly) return "promoter";
  if (lote.inviteMode === "LINK") return "link";
  if (lote.inviteMode === "EMAIL") return "email";
  return "aberto";
}

/** Uma restrição só: o servidor recusa duas ao mesmo tempo. */
function restricaoDe(quem: QuemPodePegar): { inviteMode: LotInviteMode; promoterOnly: boolean; pdvOnly: boolean } {
  return {
    inviteMode: quem === "link" ? "LINK" : quem === "email" ? "EMAIL" : "NONE",
    promoterOnly: quem === "promoter",
    pdvOnly: quem === "balcao",
  };
}

function ajudaDoQuem(quem: QuemPodePegar, modo: "criar" | "editar", antes?: QuemPodePegar): string {
  const depoisDe = modo === "criar" ? "depois de criar" : "depois de salvar";
  switch (quem) {
    case "aberto":
      return "Aparece no site para todo mundo.";
    case "link":
      return antes === "link"
        ? "O lote não aparece no site. Só vê quem abrir o link de convite deste lote."
        : `O lote não aparece no site. Só vê quem abrir o link que você vai receber ${depoisDe}.`;
    case "email":
      return antes === "email"
        ? "Só quem você convidar por e-mail consegue pegar."
        : `Só quem você convidar por e-mail consegue pegar. ${modo === "criar" ? "Depois de criar" : "Depois de salvar"}, cole a lista de e-mails.`;
    case "promoter":
      return "Só aparece para quem chega pelo link de um promoter da Casa.";
    case "balcao":
      return "Vendido só na porta, pelo PDV. Precisa ter preço (entrada grátis é pela Lista de convidados).";
  }
}

// ---------------------------------------------------------------------------
// Valores do formulário (criar e editar usam os mesmos)
// ---------------------------------------------------------------------------

export interface ValoresDoLote {
  nome: string;
  gratis: boolean;
  preco: string;
  quantidade: string;
  maxPorPedido: string;
  /** só na criação: taxa, nominal e CPF obrigatório não se editam depois */
  feeMode: FeeMode;
  nominal: boolean;
  requiresCpf: boolean;
  meia: boolean;
  quem: QuemPodePegar;
  /** "" = sem limite */
  limiteCpf: string;
  /** datetime-local; "" = começa já / sem data para parar */
  inicio: string;
  fim: string;
  virada: boolean;
  anteriorId: string;
}

export function valoresIniciais(nome: string): ValoresDoLote {
  return {
    nome,
    gratis: false,
    preco: "",
    quantidade: "",
    maxPorPedido: "6",
    feeMode: "BUYER",
    nominal: false,
    requiresCpf: false,
    meia: false,
    quem: "aberto",
    limiteCpf: "",
    inicio: "",
    fim: "",
    virada: false,
    anteriorId: "",
  };
}

function valoresDoLote(lote: ProducerLot): ValoresDoLote {
  return {
    nome: lote.name,
    gratis: lote.priceCents === 0,
    preco: lote.priceCents > 0 ? (lote.priceCents / 100).toFixed(2).replace(".", ",") : "",
    quantidade: String(lote.capacity),
    maxPorPedido: String(lote.maxPerOrder),
    feeMode: lote.feeMode,
    nominal: lote.nominal,
    requiresCpf: lote.requiresCpf,
    meia: lote.halfPriceEnabled,
    quem: quemPodePegarDo(lote),
    limiteCpf: lote.limitPerCpf ? String(lote.limitPerCpf) : "",
    inicio: paraCampoDeData(lote.startsAt),
    fim: paraCampoDeData(lote.endsAt),
    virada: Boolean(lote.activateAfterLotId),
    anteriorId: lote.activateAfterLotId ?? "",
  };
}

function precoEmCentavos(v: ValoresDoLote): number {
  return v.gratis ? 0 : parsePriceCents(v.preco);
}

/** Campo obrigatório vazio: o botão fica desligado, sem bronca (o produtor ainda está digitando). */
export function faltaPreencher(v: ValoresDoLote): boolean {
  return v.nome.trim().length < 2 || v.quantidade.trim() === "" || (!v.gratis && v.preco.trim() === "");
}

/** Lote só de balcão e grátis: o servidor recusa — a porta não emite cortesia. */
export function balcaoGratis(v: ValoresDoLote): boolean {
  return v.quem === "balcao" && (v.gratis || (v.preco.trim() !== "" && parsePriceCents(v.preco) === 0));
}

/** O que está errado no que já foi digitado (null = nada). */
export function problemaDoLote(v: ValoresDoLote, contexto: { jaSairam?: number } = {}): string | null {
  if (!v.gratis && v.preco.trim() !== "" && parsePriceCents(v.preco) === 0 && v.quem !== "balcao") {
    return "Para ingresso de R$ 0, ligue “Ingresso grátis”.";
  }
  if (v.quantidade.trim() !== "") {
    const qtd = inteiro(v.quantidade);
    if (qtd === null || qtd < 1) return "Quantidade de ingressos: use um número inteiro a partir de 1.";
    const saiu = contexto.jaSairam ?? 0;
    if (qtd < saiu) {
      return `Já saíram ${saiu} ${saiu === 1 ? "ingresso" : "ingressos"} deste lote (vendidos e reservados) — a quantidade não pode ficar abaixo disso.`;
    }
  }
  const max = inteiro(v.maxPorPedido);
  if (max === null || max < 1 || max > 20) return "Máx. por pedido: de 1 a 20.";
  if (v.limiteCpf.trim() !== "") {
    const limite = inteiro(v.limiteCpf);
    if (limite === null || limite < 1 || limite > 20) {
      return "Limite por pessoa (CPF): de 1 a 20 — ou deixe em branco para não limitar.";
    }
  }
  if (v.inicio && v.fim && new Date(v.fim).getTime() <= new Date(v.inicio).getTime()) {
    return "O fim das vendas do lote precisa ser depois do início.";
  }
  if (v.virada && !v.anteriorId) return "Escolha o lote anterior.";
  return null;
}

/** Corpo do POST de criação. O lote com virada nasce guardado; os outros já à venda. */
export function dadosParaCriar(v: ValoresDoLote): CreateLotInput {
  const priceCents = precoEmCentavos(v);
  const comVirada = v.virada && Boolean(v.anteriorId);
  return {
    name: v.nome.trim(),
    priceCents,
    // A taxa é CALCULADA PELO SERVIDOR; este valor é ignorado lá,
    // mandamos o espelho só para satisfazer o contrato do schema.
    feeCents: serviceFeeCents(priceCents),
    capacity: Number(v.quantidade.trim()),
    maxPerOrder: Number(v.maxPorPedido.trim()),
    feeMode: v.gratis ? "BUYER" : v.feeMode,
    nominal: v.nominal,
    // CPF só faz sentido em lote nominal (o backend também amarra os dois)
    requiresCpf: v.nominal && v.requiresCpf,
    halfPriceEnabled: !v.gratis && v.meia,
    ...restricaoDe(v.quem),
    limitPerCpf: v.limiteCpf.trim() ? Number(v.limiteCpf.trim()) : undefined,
    startsAt: v.inicio ? new Date(v.inicio).toISOString() : undefined,
    endsAt: v.fim ? new Date(v.fim).toISOString() : undefined,
    activateAfterLotId: comVirada ? v.anteriorId : undefined,
    activateNow: !comVirada,
  };
}

/** Corpo do PATCH: só o que mudou em relação ao lote salvo. */
function dadosParaEditar(v: ValoresDoLote, lote: ProducerLot): UpdateLotInput {
  const dados: UpdateLotInput = {};
  const nome = v.nome.trim();
  if (nome !== lote.name) dados.name = nome;
  const priceCents = precoEmCentavos(v);
  if (priceCents !== lote.priceCents) dados.priceCents = priceCents;
  const capacity = Number(v.quantidade.trim());
  if (capacity !== lote.capacity) dados.capacity = capacity;
  const max = Number(v.maxPorPedido.trim());
  if (max !== lote.maxPerOrder) dados.maxPerOrder = max;
  const limite = v.limiteCpf.trim() ? Number(v.limiteCpf.trim()) : null;
  if (limite !== lote.limitPerCpf) dados.limitPerCpf = limite;
  if (v.inicio !== paraCampoDeData(lote.startsAt)) dados.startsAt = v.inicio ? new Date(v.inicio).toISOString() : null;
  if (v.fim !== paraCampoDeData(lote.endsAt)) dados.endsAt = v.fim ? new Date(v.fim).toISOString() : null;
  const restricao = restricaoDe(v.quem);
  if (
    restricao.inviteMode !== lote.inviteMode ||
    restricao.promoterOnly !== lote.promoterOnly ||
    restricao.pdvOnly !== lote.pdvOnly
  ) {
    Object.assign(dados, restricao);
  }
  const meia = priceCents > 0 && v.meia;
  if (meia !== lote.halfPriceEnabled) dados.halfPriceEnabled = meia;
  const anterior = v.virada && v.anteriorId ? v.anteriorId : null;
  if (anterior !== lote.activateAfterLotId) dados.activateAfterLotId = anterior;
  return dados;
}

/** "O “2º lote” abriu." — o que a virada automática fez por causa da ação. */
function textoDaVirada(r: LotesDaVirada): string {
  const partes: string[] = [];
  const abertos = r.openedLots ?? [];
  if (abertos.length === 1) partes.push(`O “${abertos[0].name}” abriu (virada automática).`);
  if (abertos.length > 1) partes.push(`Abriram: ${abertos.map((l) => `“${l.name}”`).join(", ")} (virada automática).`);
  const passam = r.requeuedLots ?? [];
  if (passam.length > 0 && r.requeuedAfter) {
    partes.push(
      `${passam.map((l) => `“${l.name}”`).join(", ")} ${passam.length === 1 ? "passa" : "passam"} a esperar o “${r.requeuedAfter.name}” esgotar.`,
    );
  }
  return partes.join(" ");
}

// ---------------------------------------------------------------------------
// Peças visuais
// ---------------------------------------------------------------------------

const rotuloCls = "text-[12px] font-bold text-ink-soft";
const ajudaCls = "mt-1 block text-[11.5px] font-medium text-muted";

/** Interruptor do handoff (trilho 44×25, botão 19px) — o mesmo do perfil no site. */
function Chave({
  ligada,
  onChange,
  rotulo,
  desligada,
}: {
  ligada: boolean;
  onChange: (v: boolean) => void;
  rotulo: string;
  desligada?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligada}
      aria-label={rotulo}
      disabled={desligada}
      onClick={() => onChange(!ligada)}
      className={`relative h-[25px] w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${ligada ? "bg-success" : "bg-[#d9d2e8]"}`}
    >
      <span
        className={`absolute top-[3px] h-[19px] w-[19px] rounded-full bg-white shadow-sm transition-all ${ligada ? "left-[22px]" : "left-[3px]"}`}
      />
    </button>
  );
}

/** Caixa de confirmação no próprio lugar (padrão do "Cancelar ingresso"). */
function Confirmacao({
  titulo,
  children,
  acao,
  acaoRodando,
  tom = "perigo",
  erro,
  onConfirmar,
  onVoltar,
  rodando,
}: {
  titulo: string;
  children?: React.ReactNode;
  /** null = sem botão de confirmar (só explica por que não dá) */
  acao: string | null;
  acaoRodando: string;
  tom?: "perigo" | "normal";
  erro: string | null;
  onConfirmar: () => void;
  onVoltar: () => void;
  rodando: boolean;
}) {
  const caixa =
    tom === "perigo" ? "border-danger/35 bg-danger/[.06]" : "border-primary/35 bg-primary/[.06]";
  const botao = tom === "perigo" ? "bg-danger" : "bg-primary";
  return (
    <div className={`mt-3 space-y-2 rounded-xl border-[1.5px] p-3.5 ${caixa}`}>
      <h3 className="text-[14px] font-extrabold">{titulo}</h3>
      {children ? <div className="space-y-1 text-[13px] text-ink-soft">{children}</div> : null}
      {erro ? <p className="text-[13px] font-semibold text-danger">{erro}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onVoltar}
          disabled={rodando}
          className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-bold text-muted"
        >
          Voltar
        </button>
        {acao ? (
          <button
            type="button"
            onClick={onConfirmar}
            disabled={rodando}
            className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-bold text-white disabled:opacity-40 ${botao}`}
          >
            {rodando ? acaoRodando : erro ? "Tentar novamente" : acao}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Lote que ainda pode ser "o anterior" da virada: mesmo ingresso, não
 * encerrado, não esgotado e sem ter passado do "Para de vender" (mesma regra
 * do servidor, revisão 2026-10-13).
 */
function podeSerAnterior(l: ProducerLot): boolean {
  const parouPelaData = l.endsAt ? new Date(l.endsAt).getTime() <= Date.now() : false;
  return l.status !== "CLOSED" && l.status !== "SOLD_OUT" && l.soldCount < l.capacity && !parouPelaData;
}

/**
 * Lotes guardados que esperam (direta ou indiretamente) este: escolher um
 * deles faria um círculo. Lote já aberto não conta (mesma regra do servidor).
 */
function esperamPor(loteId: string, lotes: ProducerLot[]): Set<string> {
  const fila = new Set<string>();
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const l of lotes) {
      if (
        !fila.has(l.id) &&
        l.status === "DRAFT" &&
        l.activateAfterLotId &&
        (l.activateAfterLotId === loteId || fila.has(l.activateAfterLotId))
      ) {
        fila.add(l.id);
        mudou = true;
      }
    }
  }
  return fila;
}

// ---------------------------------------------------------------------------
// Campos do lote (criar e editar)
// ---------------------------------------------------------------------------

export function CamposDoLote({
  valores,
  onChange,
  modo,
  eventId,
  minimoCobrancaCents,
  anteriores,
  loteEditado,
}: {
  valores: ValoresDoLote;
  onChange: (v: ValoresDoLote) => void;
  modo: "criar" | "editar";
  eventId: string;
  minimoCobrancaCents: number;
  /** lotes do mesmo ingresso que podem ser o "anterior" da virada */
  anteriores: ProducerLot[];
  /** na edição: o lote como está salvo */
  loteEditado?: ProducerLot;
}) {
  const v = valores;
  const set = (parcial: Partial<ValoresDoLote>) => onChange({ ...v, ...parcial });
  const jaSairam = loteEditado ? loteEditado.soldCount + loteEditado.reservedCount : 0;
  // preço travado (2026-10-12): depois de vender ou reservar, quem pegou pagou o valor de agora
  const precoTravado = modo === "editar" && jaSairam > 0;
  const quemAntes = loteEditado ? quemPodePegarDo(loteEditado) : undefined;
  // a virada só vale para lote que ainda não abriu (na edição, só lote guardado)
  const mostraVirada = anteriores.length > 0 && (modo === "criar" || loteEditado?.status === "DRAFT");
  const anteriorEscolhido = anteriores.find((l) => l.id === v.anteriorId);
  const priceCents = precoEmCentavos(v);

  function trocarGratis(ligado: boolean) {
    // grátis: some preço, taxa e meia; o limite por CPF sugere 1 (dá para mudar)
    set({ gratis: ligado, limiteCpf: ligado ? "1" : "", meia: ligado ? false : v.meia });
  }

  return (
    <>
      <div>
        <label className={rotuloCls}>Lote</label>
        <input
          placeholder="Ex.: 1º lote"
          className="mt-1 w-full"
          value={v.nome}
          onChange={(e) => set({ nome: e.target.value })}
        />
      </div>

      <div
        className={`flex items-center justify-between gap-3 rounded-[13px] border-[1.5px] px-3.5 py-3 ${
          v.gratis ? "border-success bg-success/10" : "border-line-input bg-surface"
        }`}
      >
        <div className="min-w-0">
          <p className="text-[13.5px] font-extrabold">Ingresso grátis</p>
          <p className="text-[11.5px] font-medium text-muted">Sem preço e sem taxa para ninguém</p>
        </div>
        <Chave ligada={v.gratis} onChange={trocarGratis} rotulo="Ingresso grátis" desligada={precoTravado} />
      </div>

      {!v.gratis ? (
        <div>
          <label className={rotuloCls}>Quanto você quer receber (R$)</label>
          <input
            placeholder="Ex.: 20,00"
            className="mt-1 w-full disabled:opacity-60"
            inputMode="decimal"
            value={v.preco}
            disabled={precoTravado}
            onChange={(e) => set({ preco: e.target.value })}
          />
          <span className={ajudaCls}>
            {precoTravado
              ? "Já tem ingresso vendido ou reservado neste lote, então o preço fica como está: quem já pegou pagou este valor. Para outro preço, crie um novo lote."
              : `Ingresso pago precisa sair por pelo menos ${formatCents(minimoCobrancaCents)} para o comprador.`}
          </span>
        </div>
      ) : precoTravado ? (
        <p className="text-[11.5px] font-medium text-muted">
          Já tem ingresso pego neste lote, então ele continua grátis. Para cobrar, crie um novo lote.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <div className="min-w-0 flex-1">
          <label className={rotuloCls}>Quantidade de ingressos</label>
          <input
            placeholder="Ex.: 200"
            className="mt-1 w-full"
            inputMode="numeric"
            value={v.quantidade}
            onChange={(e) => set({ quantidade: e.target.value })}
          />
          {jaSairam > 0 ? (
            <span className={ajudaCls}>
              Já {jaSairam === 1 ? "saiu 1" : `saíram ${jaSairam}`} (vendidos e reservados) — não dá para baixar disso.
            </span>
          ) : null}
        </div>
        <div className="w-36 min-w-0">
          <label className={rotuloCls}>Máx. por pedido</label>
          <input
            className="mt-1 w-full"
            inputMode="numeric"
            value={v.maxPorPedido}
            onChange={(e) => set({ maxPorPedido: e.target.value })}
            title="Quantos ingressos deste lote cada pessoa pode comprar num pedido (1 a 20)"
          />
        </div>
      </div>

      {modo === "criar" && !v.gratis ? (
        <FeeModeField
          value={v.feeMode}
          onChange={(feeMode) => set({ feeMode })}
          priceCents={priceCents}
          feeCents={serviceFeeCents(priceCents)}
        />
      ) : null}
      {modo === "criar" ? (
        <NominalFields
          nominal={v.nominal}
          requiresCpf={v.requiresCpf}
          onChange={({ nominal, requiresCpf }) => set({ nominal, requiresCpf })}
        />
      ) : null}
      {!v.gratis ? (
        <label className="flex items-center gap-2 text-[13px] font-semibold">
          <input
            type="checkbox"
            checked={v.meia}
            onChange={(e) => set({ meia: e.target.checked })}
            className="h-4 w-4 accent-primary"
          />
          <span>
            Oferecer meia-entrada (50% do preço)
            <span className="block text-[11.5px] font-medium text-muted">
              Opcional — o comprador escolhe meia no checkout e o documento é conferido na portaria.
            </span>
          </span>
        </label>
      ) : null}

      <div>
        <label className={rotuloCls} htmlFor={`quem-${loteEditado?.id ?? "novo"}`}>
          Quem pode pegar
        </label>
        <select
          id={`quem-${loteEditado?.id ?? "novo"}`}
          className="mt-1 w-full"
          value={v.quem}
          onChange={(e) => set({ quem: e.target.value as QuemPodePegar })}
        >
          {(Object.keys(ROTULO_QUEM) as QuemPodePegar[]).map((q) => (
            <option key={q} value={q}>
              {ROTULO_QUEM[q]}
            </option>
          ))}
        </select>
        <span className={ajudaCls}>{ajudaDoQuem(v.quem, modo, quemAntes)}</span>
        {quemAntes === "link" && v.quem !== "link" ? (
          <p className="mt-1.5 rounded-lg bg-warning/10 px-3 py-2 text-[12.5px] font-semibold text-warning">
            O link de convite atual deixa de funcionar. Quem já pegou o ingresso continua com ele.
          </p>
        ) : null}
        {quemAntes === "email" && v.quem !== "email" ? (
          <p className="mt-1.5 rounded-lg bg-warning/10 px-3 py-2 text-[12.5px] font-semibold text-warning">
            Quem você convidou por e-mail passa a seguir a nova regra — o convite sozinho não garante mais o ingresso.
            Quem já pegou continua com ele.
          </p>
        ) : null}
        {balcaoGratis(v) ? (
          <p className="mt-1.5 rounded-lg bg-warning/10 px-3 py-2 text-[12.5px] font-semibold text-warning">
            Lote só de balcão grátis não pode ser {modo === "criar" ? "criado" : "salvo"}: o balcão não emite
            cortesia. Para dar entrada grátis, cadastre a pessoa na{" "}
            <Link href={`/eventos/${eventId}/lista-convidados`} className="font-extrabold underline">
              Lista de convidados
            </Link>{" "}
            ou emita uma Cortesia (mais abaixo nesta página).
          </p>
        ) : null}
      </div>

      <div>
        <label className={rotuloCls}>Limite por pessoa (CPF)</label>
        <input
          className="mt-1 w-full"
          inputMode="numeric"
          placeholder="Sem limite"
          value={v.limiteCpf}
          onChange={(e) => set({ limiteCpf: e.target.value })}
        />
        <span className={ajudaCls}>Para grátis, o padrão é 1 por CPF. Pedido pendente também conta.</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="min-w-0 flex-1">
          <label className={rotuloCls}>Começa a vender</label>
          <input
            type="datetime-local"
            className="mt-1 w-full"
            value={v.inicio}
            onChange={(e) => set({ inicio: e.target.value })}
          />
          <span className={ajudaCls}>
            {mostraVirada && v.virada ? "Em branco: assim que o lote anterior esgotar." : "Em branco: agora."}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <label className={rotuloCls}>Para de vender</label>
          <input
            type="datetime-local"
            className="mt-1 w-full"
            value={v.fim}
            onChange={(e) => set({ fim: e.target.value })}
          />
          <span className={ajudaCls}>Em branco: sem data para parar.</span>
        </div>
      </div>

      {mostraVirada ? (
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[13px] border-[1.5px] border-line-input bg-surface px-3.5 py-3">
            <span className="min-w-0">
              <span className="block text-[13.5px] font-extrabold">Abrir quando o lote anterior esgotar</span>
              <span className="block text-[11.5px] font-medium text-muted">Virada automática de lote</span>
            </span>
            <input
              type="checkbox"
              aria-label="Abrir quando o lote anterior esgotar"
              checked={v.virada}
              onChange={(e) =>
                set({
                  virada: e.target.checked,
                  // sugere o lote mais novo do ingresso (o "de agora")
                  anteriorId: e.target.checked ? v.anteriorId || anteriores[anteriores.length - 1]?.id || "" : v.anteriorId,
                })
              }
              className="h-5 w-5 shrink-0 accent-primary"
            />
          </label>
          {v.virada ? (
            <div>
              <label className={rotuloCls} htmlFor={`anterior-${loteEditado?.id ?? "novo"}`}>
                Lote anterior
              </label>
              <select
                id={`anterior-${loteEditado?.id ?? "novo"}`}
                className="mt-1 w-full"
                value={v.anteriorId}
                onChange={(e) => set({ anteriorId: e.target.value })}
              >
                <option value="">Escolha o lote</option>
                {anteriores.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.soldCount} de {l.capacity})
                  </option>
                ))}
              </select>
              <span className={ajudaCls}>
                {anteriorEscolhido
                  ? `Este lote fica guardado, fora do site, e abre sozinho quando o “${anteriorEscolhido.name}” esgotar, for encerrado ou parar de vender pela data.`
                  : "Este lote fica guardado, fora do site, e abre sozinho quando o lote anterior esgotar, for encerrado ou parar de vender pela data."}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** Lotes do mesmo ingresso que este pode esperar (sem ele mesmo e sem quem já espera por ele). */
export function anterioresPossiveis(lotesDoIngresso: ProducerLot[], loteId?: string): ProducerLot[] {
  const proibidos = loteId ? esperamPor(loteId, lotesDoIngresso) : new Set<string>();
  return lotesDoIngresso.filter((l) => l.id !== loteId && !proibidos.has(l.id) && podeSerAnterior(l));
}

// ---------------------------------------------------------------------------
// Link de convite (copiar + trocar com confirmação)
// ---------------------------------------------------------------------------

function LinkDeConvite({
  token,
  lotId,
  linkDoEvento,
  onTrocado,
}: {
  token: string;
  lotId: string;
  linkDoEvento: string;
  onTrocado: () => void;
}) {
  const { token: sessao } = useAuth();
  // o código novo aparece NA HORA com a resposta da troca — mesmo que a
  // recarga da lista falhe, a tela nunca mostra o link que acabou de morrer
  const [codigoNovo, setCodigoNovo] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [trocado, setTrocado] = useState(false);

  useEffect(() => {
    setCodigoNovo(null);
  }, [token]);

  const codigo = codigoNovo ?? token;
  const link = `${linkDoEvento}?convite=${encodeURIComponent(codigo)}`;

  async function copiar() {
    try {
      if (!navigator.clipboard) throw new Error("sem área de transferência");
      await navigator.clipboard.writeText(link);
      setCopiado("Copiado");
    } catch {
      setCopiado("Copie o texto");
    }
    setTimeout(() => setCopiado(null), 2500);
  }

  async function trocar() {
    if (!sessao || trocando) return;
    setTrocando(true);
    setErro(null);
    try {
      const r = await catalogApi.rotateInviteLink(sessao, lotId);
      setCodigoNovo(r.inviteToken);
      setConfirmando(false);
      setTrocado(true);
      onTrocado();
    } catch (err) {
      setErro(mensagemDeErro(err, "Não foi possível trocar o link"));
    } finally {
      setTrocando(false);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <div>
        <span className={rotuloCls}>Link de convite</span>
        <div className="mt-1 flex items-center gap-2 rounded-xl border border-dashed border-line-input bg-bg px-3 py-2.5">
          <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink">{link}</code>
          <button
            type="button"
            onClick={copiar}
            className="h-9 shrink-0 rounded-[11px] border-[1.5px] border-line-input bg-surface px-3 text-[12.5px] font-extrabold"
          >
            {copiado ?? "Copiar"}
          </button>
        </div>
        <span className={ajudaCls}>Quem tiver este link vê e pega o ingresso. Mande só para quem você quer.</span>
      </div>
      {trocado ? (
        <p className="rounded-lg bg-success/10 px-3 py-2.5 text-[13px] font-bold text-success">
          Link trocado. O antigo não funciona mais — mande este novo.
        </p>
      ) : null}
      {confirmando ? (
        <Confirmacao
          titulo="Trocar o link de convite?"
          acao="Trocar link"
          acaoRodando="Trocando…"
          erro={erro}
          rodando={trocando}
          onConfirmar={trocar}
          onVoltar={() => {
            setConfirmando(false);
            setErro(null);
          }}
        >
          <p>
            O link atual para de funcionar na hora. Quem já pegou o ingresso continua com ele. Você vai precisar
            mandar o link novo.
          </p>
        </Confirmacao>
      ) : (
        <button
          type="button"
          onClick={() => {
            setTrocado(false);
            setConfirmando(true);
          }}
          className="h-10 rounded-[11px] border-[1.5px] border-line-input bg-surface px-3 text-[12.5px] font-extrabold"
        >
          Trocar link
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card do lote
// ---------------------------------------------------------------------------

/** O lote como o painel mostra (vem do dashboard; o detalhe vem da lista de lotes). */
export interface LoteDoPainel {
  id: string;
  name: string;
  priceCents: number;
  feeCents: number;
  capacity: number;
  sold: number;
  reserved: number;
  status: string;
}

function situacaoDo(lote: LoteDoPainel, detalhe: ProducerLot | undefined, nomeDe: (id: string) => string | undefined) {
  const agora = Date.now();
  if (lote.status === "CLOSED") return { texto: "Encerrado", cls: "bg-line text-muted" };
  if (lote.status === "DRAFT") {
    const anterior = detalhe?.activateAfterLotId ? nomeDe(detalhe.activateAfterLotId) : undefined;
    return anterior
      ? { texto: `Abre quando “${anterior}” esgotar`, cls: "bg-primary/10 text-primary" }
      : { texto: "Guardado — fora do site", cls: "bg-warning/10 text-warning" };
  }
  if (lote.status === "SOLD_OUT" || lote.sold >= lote.capacity) return { texto: "Esgotado", cls: "bg-warning/10 text-warning" };
  if (detalhe?.endsAt && new Date(detalhe.endsAt).getTime() <= agora) {
    return { texto: "Parou de vender (data)", cls: "bg-line text-muted" };
  }
  if (detalhe?.startsAt && new Date(detalhe.startsAt).getTime() > agora) {
    return { texto: `Abre ${dataCurta(detalhe.startsAt)}`, cls: "bg-primary/10 text-primary" };
  }
  if (lote.status === "ACTIVE") return { texto: "À venda", cls: "bg-success/10 text-success" };
  if (lote.status === "SCHEDULED") return { texto: "Agendado", cls: "bg-primary/10 text-primary" };
  return { texto: lote.status, cls: "bg-line text-muted" };
}

type Confirmando = null | "abrir" | "encerrar" | "apagar";

export function CartaoDoLote({
  lote,
  detalhe,
  lotesDoIngresso,
  eventId,
  linkDoEvento,
  minimoCobrancaCents,
  onMudou,
}: {
  lote: LoteDoPainel;
  /** ausente: sem permissão de editar lote ou a lista de detalhes não carregou */
  detalhe?: ProducerLot;
  /** detalhes de todos os lotes do mesmo ingresso (virada) */
  lotesDoIngresso: ProducerLot[];
  eventId: string;
  linkDoEvento: string;
  minimoCobrancaCents: number;
  /** recarrega a lista e mostra o aviso de sucesso */
  onMudou: (mensagem: string | null) => Promise<void> | void;
}) {
  const { token } = useAuth();
  const [editando, setEditando] = useState(false);
  const [valores, setValores] = useState<ValoresDoLote | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroEdicao, setErroEdicao] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<Confirmando>(null);
  const [rodando, setRodando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const nomeDe = (id: string) => lotesDoIngresso.find((l) => l.id === id)?.name;
  const situacao = situacaoDo(lote, detalhe, nomeDe);
  const gratis = lote.priceCents === 0;
  const quem = detalhe ? quemPodePegarDo(detalhe) : "aberto";
  // quem espera por este lote (virada) — encerrar abre; apagar não pode
  const seguintes = lotesDoIngresso.filter((l) => l.activateAfterLotId === lote.id && l.status === "DRAFT");
  const anteriorId = detalhe?.activateAfterLotId ?? null;
  const anteriorDeste = anteriorId ? lotesDoIngresso.find((l) => l.id === anteriorId) : undefined;
  // encerrar um lote que ainda esperava a vez: os de trás passam a esperar o anterior dele
  const repassaFila = lote.status === "DRAFT" && anteriorDeste !== undefined && podeSerAnterior(anteriorDeste);
  const nomes = (lista: ProducerLot[]) => lista.map((l) => `“${l.name}”`).join(", ");

  function abrirEdicao() {
    if (!detalhe) return;
    setValores(valoresDoLote(detalhe));
    setErroEdicao(null);
    setConfirmando(null);
    setEditando(true);
  }

  async function salvar() {
    if (!token || !detalhe || !valores || salvando) return;
    const dados = dadosParaEditar(valores, detalhe);
    if (Object.keys(dados).length === 0) {
      setEditando(false);
      return;
    }
    setSalvando(true);
    setErroEdicao(null);
    try {
      const r = await catalogApi.updateLot(token, lote.id, dados);
      setEditando(false);
      const extra = [
        dados.inviteMode === "LINK" && detalhe.inviteMode !== "LINK" ? "O link de convite está no lote." : "",
        dados.inviteMode === "EMAIL" && detalhe.inviteMode !== "EMAIL" ? "Agora convide as pessoas em “Convidar por e-mail”." : "",
        textoDaVirada(r),
      ]
        .filter(Boolean)
        .join(" ");
      await onMudou(`Lote “${r.name}” salvo.${extra ? ` ${extra}` : ""}`);
    } catch (err) {
      setErroEdicao(mensagemDeErro(err, "Não foi possível salvar o lote"));
    } finally {
      setSalvando(false);
    }
  }

  async function executar() {
    if (!token || !confirmando || rodando) return;
    setRodando(true);
    setErroAcao(null);
    try {
      let mensagem: string;
      if (confirmando === "abrir") {
        await catalogApi.activateLot(token, lote.id);
        mensagem = `“${lote.name}” está à venda.`;
      } else if (confirmando === "encerrar") {
        const r = await catalogApi.closeLot(token, lote.id);
        const virada = textoDaVirada(r);
        mensagem = `Vendas de “${lote.name}” encerradas.${virada ? ` ${virada}` : ""}`;
      } else {
        await catalogApi.deleteLot(token, lote.id);
        mensagem = `Lote “${lote.name}” apagado.`;
      }
      setConfirmando(null);
      await onMudou(mensagem);
    } catch (err) {
      setErroAcao(mensagemDeErro(err, "Não foi possível concluir — tente de novo."));
    } finally {
      setRodando(false);
    }
  }

  function pedir(acao: Confirmando) {
    setErroAcao(null);
    setEditando(false);
    setConfirmando(acao);
  }

  const botaoCls = "h-8 rounded-lg border border-line px-3 text-[12px] font-bold text-muted hover:text-ink";
  const entraram = detalhe?.checkedInCount ?? 0;

  return (
    <div className="rounded-xl border border-line-divider bg-bg/50 px-3.5 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="font-bold">{lote.name}</p>
          <p className="text-sm text-muted">
            {gratis ? (
              <span className="font-semibold text-success">Grátis</span>
            ) : (
              `${formatCents(lote.priceCents)} + taxa ${formatCents(lote.feeCents)}`
            )}{" "}
            · {lote.sold} de {lote.capacity} {gratis ? "pegaram" : "vendidos"}
            {entraram > 0 ? ` · ${entraram} já ${entraram === 1 ? "entrou" : "entraram"}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${situacao.cls}`}>{situacao.texto}</span>
          {detalhe && lote.status !== "CLOSED" ? (
            <button type="button" className={botaoCls} onClick={() => (editando ? setEditando(false) : abrirEdicao())}>
              {editando ? "Fechar edição" : "Editar"}
            </button>
          ) : null}
          {lote.status === "DRAFT" ? (
            <button type="button" className={botaoCls} onClick={() => pedir("abrir")}>
              Abrir agora
            </button>
          ) : null}
          {lote.status !== "CLOSED" ? (
            <button type="button" className={botaoCls} onClick={() => pedir("encerrar")}>
              Encerrar
            </button>
          ) : null}
          {lote.sold === 0 ? (
            <button
              type="button"
              className="h-8 rounded-lg border border-danger/40 px-3 text-[12px] font-bold text-danger hover:bg-danger/5"
              onClick={() => pedir("apagar")}
            >
              Apagar
            </button>
          ) : null}
        </div>
      </div>

      {detalhe ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {quem !== "aberto" ? (
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">
              {ETIQUETA_QUEM[quem]}
            </span>
          ) : null}
          {detalhe.limitPerCpf ? (
            <span className="rounded-full bg-line px-2.5 py-1 text-[11px] font-bold text-muted">
              {detalhe.limitPerCpf} por CPF
            </span>
          ) : null}
          {detalhe.halfPriceEnabled ? (
            <span className="rounded-full bg-line px-2.5 py-1 text-[11px] font-bold text-muted">Com meia-entrada</span>
          ) : null}
          {detalhe.endsAt && lote.status !== "CLOSED" && new Date(detalhe.endsAt).getTime() > Date.now() ? (
            <span className="rounded-full bg-line px-2.5 py-1 text-[11px] font-bold text-muted">
              Para de vender {dataCurta(detalhe.endsAt)}
            </span>
          ) : null}
          {quem === "email" && lote.status !== "CLOSED" ? (
            <Link href={`/eventos/${eventId}/convites?lote=${lote.id}`} className="btn-secondary px-3 py-1.5">
              Convidar por e-mail
            </Link>
          ) : null}
        </div>
      ) : null}

      {detalhe && quem === "link" && detalhe.inviteToken && lote.status !== "CLOSED" && !editando ? (
        <LinkDeConvite
          token={detalhe.inviteToken}
          lotId={lote.id}
          linkDoEvento={linkDoEvento}
          onTrocado={() => void onMudou(null)}
        />
      ) : null}

      {confirmando === "abrir" ? (
        <Confirmacao
          titulo={`Abrir as vendas de “${lote.name}” agora?`}
          acao="Abrir agora"
          acaoRodando="Abrindo…"
          tom="normal"
          erro={erroAcao}
          rodando={rodando}
          onConfirmar={executar}
          onVoltar={() => setConfirmando(null)}
        >
          <p>
            {anteriorDeste
              ? `Ele deixa de esperar o “${anteriorDeste.name}” esgotar e passa a aparecer para quem pode pegar.`
              : "Ele passa a aparecer para quem pode pegar."}
          </p>
        </Confirmacao>
      ) : null}

      {confirmando === "encerrar" ? (
        <Confirmacao
          titulo={`Encerrar as vendas de “${lote.name}”?`}
          acao="Encerrar vendas"
          acaoRodando="Encerrando…"
          erro={erroAcao}
          rodando={rodando}
          onConfirmar={executar}
          onVoltar={() => setConfirmando(null)}
        >
          <p>O lote some do site e não pode ser reativado. Quem já pegou continua com o ingresso.</p>
          {seguintes.length > 0 ? (
            <p className="font-semibold text-ink">
              {repassaFila && anteriorDeste
                ? `${nomes(seguintes)} ${seguintes.length === 1 ? "passa" : "passam"} a esperar o “${anteriorDeste.name}” esgotar.`
                : `${nomes(seguintes)} ${seguintes.length === 1 ? "abre" : "abrem"} na hora (virada automática).`}
            </p>
          ) : null}
        </Confirmacao>
      ) : null}

      {confirmando === "apagar" ? (
        <Confirmacao
          titulo={`Apagar o lote “${lote.name}”?`}
          acao={seguintes.length > 0 ? null : "Apagar lote"}
          acaoRodando="Apagando…"
          erro={erroAcao}
          rodando={rodando}
          onConfirmar={executar}
          onVoltar={() => setConfirmando(null)}
        >
          {seguintes.length > 0 ? (
            <p>
              {nomes(seguintes)} {seguintes.length === 1 ? "está esperando" : "estão esperando"} este lote esgotar para
              abrir. Antes de apagar, edite {seguintes.length === 1 ? "esse lote" : "esses lotes"} e desligue “Abrir
              quando o lote anterior esgotar” — ou encerre este lote em vez de apagar.
            </p>
          ) : (
            <p>Isso não pode ser desfeito.</p>
          )}
        </Confirmacao>
      ) : null}

      {editando && valores && detalhe ? (
        <div className="mt-3 space-y-2 rounded-xl border border-line bg-surface p-3.5">
          <p className="text-[14px] font-extrabold">Editar lote · {detalhe.typeName}</p>
          <CamposDoLote
            valores={valores}
            onChange={setValores}
            modo="editar"
            eventId={eventId}
            minimoCobrancaCents={minimoCobrancaCents}
            anteriores={anterioresPossiveis(lotesDoIngresso, lote.id)}
            loteEditado={detalhe}
          />
          {(() => {
            const problema = problemaDoLote(valores, { jaSairam: detalhe.soldCount + detalhe.reservedCount });
            return problema ? (
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-[12.5px] font-semibold text-warning">{problema}</p>
            ) : null;
          })()}
          {erroEdicao ? <p className="text-[13px] font-semibold text-danger">{erroEdicao}</p> : null}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className="btn-primary"
              onClick={salvar}
              disabled={
                salvando ||
                faltaPreencher(valores) ||
                balcaoGratis(valores) ||
                problemaDoLote(valores, { jaSairam: detalhe.soldCount + detalhe.reservedCount }) !== null
              }
            >
              {salvando ? "Salvando…" : erroEdicao ? "Tentar novamente" : "Salvar alterações"}
            </button>
            <button type="button" className="btn-secondary px-4" onClick={() => setEditando(false)} disabled={salvando}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
