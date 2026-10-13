"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "react-qr-code";
import { GuardedPanelShell } from "@/components/PanelShell";
import { SalesPushButton } from "@/components/SalesPushButton";
import { useAuth } from "@/lib/auth";
import { CHECKOUT_URL, hotsiteUrl } from "@/lib/config";
import { copiarTexto } from "@/lib/copiar";
import {
  organizationsApi,
  type Organization,
  type ProducerType,
  type PromoterEngagement,
  type PromoterInvite,
  type PromoterWallet,
} from "@/lib/api";

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function diaEMes(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/**
 * LINK E QR DO PROMOTER (2026-10-12). O link aponta para O EVENTO (2026-09-08:
 * antes ia para a home e o comprador caçava a festa). Promoter da Casa inteira
 * escolhe o evento na agenda que o servidor manda (até 50, só os públicos) —
 * antes a tela só montava o link do primeiro. O QR é o mesmo link, para
 * mostrar na fila ou na faculdade. Sem evento publicado, cai na página inicial.
 */
function LinkEQrDoPromoter({ engagement }: { engagement: PromoterEngagement }) {
  const opcoes = engagement.event ? [engagement.event] : (engagement.events ?? []);
  const [escolhido, setEscolhido] = useState(opcoes[0]?.id ?? "");
  const [copia, setCopia] = useState<"ok" | "falhou" | null>(null);
  // a agenda recarregou e o evento escolhido saiu dela: volta para o primeiro
  const evento = opcoes.find((e) => e.id === escolhido) ?? opcoes[0] ?? null;
  const link = evento ? `${hotsiteUrl(evento.slug)}?pr=${engagement.slug}` : `${CHECKOUT_URL}/?pr=${engagement.slug}`;

  async function copiar() {
    const ok = await copiarTexto(link);
    setCopia(ok ? "ok" : "falhou");
    if (ok) setTimeout(() => setCopia(null), 2000);
  }

  return (
    <div className="mt-3 space-y-3">
      {engagement.event ? (
        <p className="text-[12px] font-semibold text-muted">
          Você divulga só <b className="text-ink">{engagement.event.title}</b> · {diaEMes(engagement.event.startsAt)}
        </p>
      ) : opcoes.length > 0 ? (
        <label className="block">
          <span className="mb-1 block text-[12px] font-bold text-ink-soft">Evento</span>
          <select
            className="h-[42px] w-full rounded-xl border-[1.5px] border-line-input bg-surface px-3 text-[14px] font-semibold outline-none focus:border-primary"
            value={evento?.id ?? ""}
            onChange={(e) => {
              setEscolhido(e.target.value);
              setCopia(null);
            }}
          >
            {opcoes.map((e) => (
              <option key={e.id} value={e.id}>
                {`${e.title} · ${diaEMes(e.startsAt)}`}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-[12px] font-semibold text-muted">
          Esta casa ainda não tem evento publicado — seu link leva para a página inicial.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-[148px_minmax(0,1fr)] sm:items-center">
        <div className="mx-auto w-[148px] rounded-xl border border-line bg-white p-2.5 sm:mx-0">
          <QRCode
            value={link}
            size={128}
            title={evento ? `QR do seu link para ${evento.title}` : "QR do seu link"}
            style={{ height: "auto", maxWidth: "100%", width: "100%" }}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-line-input bg-surface px-3 py-2.5">
            <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink">
              {link.replace(/^https?:\/\//, "")}
            </code>
            <button
              type="button"
              onClick={copiar}
              className="h-10 shrink-0 rounded-xl border-[1.5px] border-line-input bg-surface px-3 text-[12.5px] font-extrabold text-primary"
            >
              {copia === "ok" ? "Copiado ✓" : "Copiar"}
            </button>
          </div>
          {copia === "falhou" ? (
            <p className="text-[11.5px] font-semibold text-danger">
              Não deu para copiar sozinho. Selecione o link acima e copie.
            </p>
          ) : null}
          <p className="text-center text-[11.5px] font-semibold text-muted sm:text-left">
            Mostre o QR na fila ou mande o link. Cada venda por ele conta para você.
          </p>
        </div>
      </div>
    </div>
  );
}

const PRODUCER_TYPES: Array<{ value: ProducerType; label: string }> = [
  { value: "CASA", label: "Casa de shows / balada" },
  { value: "ATLETICA", label: "Atlética" },
  { value: "PRODUTORA", label: "Produtora de eventos" },
  { value: "INDEPENDENTE", label: "Produtor independente" },
  { value: "OUTRO", label: "Outro" },
];
const inputCls =
  "h-[46px] w-full rounded-xl border-[1.5px] border-line-input bg-surface px-3.5 text-[14px] font-medium outline-none focus:border-primary";

/**
 * Multi-produtora fica para a v2 (decisão #6) — o login já cai em "Meus eventos".
 * Esta tela continua acessível para quem administra mais de uma organização.
 */
/**
 * `ownedOrg`: a produtora de que a pessoa é DONA — é para o caixa dela que vão
 * as comissões de promoter (resolvePromoterWallet em packages/payments).
 * undefined = ainda não sabemos (lista carregando ou com erro); null = não tem.
 */
function PromoterInbox({ ownedOrg }: { ownedOrg: (Organization & { roleKey: string }) | null | undefined }) {
  const { token } = useAuth();
  const [invites, setInvites] = useState<PromoterInvite[]>([]);
  const [engagements, setEngagements] = useState<PromoterEngagement[]>([]);
  const [sellerInvites, setSellerInvites] = useState<Awaited<ReturnType<typeof organizationsApi.mySellerInvites>>>([]);
  const [sellerEngagements, setSellerEngagements] = useState<Awaited<ReturnType<typeof organizationsApi.mySellerEngagements>>>([]);
  const [wallet, setWallet] = useState<PromoterWallet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sellerEmail, setSellerEmail] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    if (!token) return;
    setLoadError(null);
    // ERRO NÃO VIRA "ZERO" (2026-10-12): cada lista caía num .catch(() => []) e
    // uma falha sumia com os convites e links do promoter sem aviso nenhum. O
    // que carregou aparece; o que falhou vira erro com "Tentar novamente".
    const resultados = await Promise.allSettled([
      organizationsApi.myPromoterInvites(token),
      organizationsApi.myPromoterEngagements(token),
      organizationsApi.mySellerInvites(token),
      organizationsApi.mySellerEngagements(token),
      organizationsApi.myWallet(token),
    ]);
    const [inv, eng, sInv, sEng, carteira] = resultados;
    if (inv.status === "fulfilled") setInvites(inv.value);
    if (eng.status === "fulfilled") setEngagements(eng.value);
    if (sInv.status === "fulfilled") setSellerInvites(sInv.value);
    if (sEng.status === "fulfilled") setSellerEngagements(sEng.value);
    if (carteira.status === "fulfilled") setWallet(carteira.value);
    const falha = resultados.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (falha) {
      setLoadError(
        falha.reason instanceof Error && falha.reason.message
          ? falha.reason.message
          : "Não foi possível carregar seus convites e links",
      );
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function respond(linkId: string, accept: boolean) {
    if (!token) return;
    setMessage(null);
    try {
      await organizationsApi.respondPromoterInvite(token, linkId, accept);
      setMessage(accept ? "Convite aceito — seu link já está ativo abaixo." : "Convite recusado.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível responder");
    }
  }

  async function respondSeller(sellerId: string, accept: boolean) {
    if (!token) return;
    setMessage(null);
    try {
      await organizationsApi.respondSellerInvite(token, sellerId, accept);
      setMessage(accept ? "Convite aceito — seu link de vendedor está ativo abaixo." : "Convite recusado.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível responder");
    }
  }

  async function convidarVendedor(linkId: string) {
    if (!token) return;
    const emailAlvo = (sellerEmail[linkId] ?? "").trim();
    if (!emailAlvo.includes("@")) return;
    setMessage(null);
    try {
      await organizationsApi.inviteSeller(token, linkId, emailAlvo);
      setSellerEmail((prev) => ({ ...prev, [linkId]: "" }));
      setMessage("Vendedor convidado — ele aceita no painel dele e recebe o link próprio.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Não foi possível convidar");
    }
  }

  async function copySellerLink(slug: string, id: string) {
    const link = `${CHECKOUT_URL}/?vd=${slug}`;
    if (!(await copiarTexto(link))) {
      setMessage(`Não deu para copiar sozinho. Selecione e copie: ${link}`);
      return;
    }
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  // carteira com dinheiro aparece mesmo sem vínculo ativo (link revogado ainda
  // tem comissão a receber)
  const walletComSaldo = wallet !== null && (wallet.balanceCents !== 0 || wallet.availableCents > 0);

  if (
    invites.length === 0 &&
    engagements.length === 0 &&
    sellerInvites.length === 0 &&
    sellerEngagements.length === 0 &&
    !walletComSaldo &&
    !loadError &&
    !message
  )
    return null;

  return (
    <section className="mb-6 space-y-4">
      {message ? <p className="text-[13px] font-bold text-brand">{message}</p> : null}

      {loadError ? (
        <div className="rounded-[18px] border border-danger/30 bg-danger/5 p-5 text-center">
          <p className="text-[13px] font-bold text-danger">
            Não foi possível carregar seus convites, links e carteira de promoter: {loadError}
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

      {invites.length > 0 ? (
        <div className="rounded-[18px] border border-brand/30 bg-brand/5 p-5">
          <h2 className="text-[15px] font-extrabold">Convites</h2>
          <p className="mt-1 text-[12px] font-semibold text-muted">
            Produtores querem você como promoter dos eventos deles.
          </p>
          <div className="mt-3 space-y-2">
            {invites.map((invite) => (
              <div
                key={invite.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3"
              >
                <div>
                  <p className="text-[13.5px] font-extrabold">
                    {invite.organization.displayName ?? invite.organization.name}
                  </p>
                  <p className="text-[12px] font-semibold text-muted">
                    convite para ser promoter
                    {invite.commissionType === "PERCENT"
                      ? ` · comissão de ${(invite.commissionBps / 100).toFixed(1).replace(".", ",")}% por venda`
                      : invite.commissionType === "FIXED"
                        ? ` · comissão de ${(invite.commissionFixedCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} por ingresso`
                        : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => respond(invite.id, true)}
                    className="h-10 rounded-xl bg-primary px-4 text-[13px] font-extrabold text-white"
                  >
                    Aceitar
                  </button>
                  <button
                    type="button"
                    onClick={() => respond(invite.id, false)}
                    className="h-10 rounded-xl border border-line px-4 text-[13px] font-bold"
                  >
                    Recusar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* SOU PROMOTER (2026-10-12): escolher o evento da agenda (antes só montava
          o link do primeiro) e QR do link para mostrar na fila. Evento privado
          não vem na agenda (regra decidida): o produtor manda o link dele. */}
      {engagements.length > 0 ? (
        <div className="rounded-[18px] border border-line bg-surface p-5">
          <h2 className="text-[15px] font-extrabold">Sou promoter</h2>
          <p className="mt-1 text-[12px] font-semibold text-muted">
            Divulgue seu link — toda compra que vier por ele conta para você.
          </p>
          <div className="mt-3 space-y-3">
            {engagements.map((eng) => (
              <div key={eng.id} className="rounded-xl bg-bg px-4 py-4">
                <p className="text-[13.5px] font-extrabold">{eng.hostName}</p>
                <p className="text-[12px] font-semibold text-muted">
                  {eng.paidOrders} venda{eng.paidOrders === 1 ? "" : "s"}
                  {/* "em comissões" (2026-10-12): é o total desta casa, não o saldo —
                      o saldo e o liberado estão em "Minhas comissões" */}
                  {eng.commissionType === "PERCENT"
                    ? ` · ${((eng.commissionBps ?? 0) / 100).toFixed(1).replace(".", ",")}% · ${brl(eng.commissionCents ?? 0)} em comissões`
                    : eng.commissionType === "FIXED"
                      ? ` · ${brl(eng.commissionFixedCents ?? 0)}/ingresso · ${brl(eng.commissionCents ?? 0)} em comissões`
                      : ""}
                </p>
                <LinkEQrDoPromoter engagement={eng} />
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <input
                    className="h-10 w-[200px] rounded-xl border border-line-input bg-surface px-3 text-[12.5px]"
                    placeholder="e-mail do vendedor"
                    value={sellerEmail[eng.id] ?? ""}
                    onChange={(e) => setSellerEmail((prev) => ({ ...prev, [eng.id]: e.target.value }))}
                  />
                  <button
                    type="button"
                    onClick={() => convidarVendedor(eng.id)}
                    className="h-10 rounded-xl border border-line bg-surface px-3 text-[12.5px] font-bold"
                  >
                    Convidar vendedor
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* CARTEIRA DO PROMOTER (2026-10-12): a tela só dizia "R$ X na sua carteira"
          por vínculo — sem dizer quanto já liberou nem como sacar. GET wallet/mine
          existia e ninguém usava. */}
      {/* ownedOrg undefined = lista de produtoras ainda não respondeu: sem chute de R$ 0,00 */}
      {(engagements.length > 0 || walletComSaldo) && ownedOrg !== undefined && (ownedOrg || wallet) ? (
        <div className="rounded-[18px] border border-line bg-surface p-5">
          <h2 className="text-[15px] font-extrabold">Minhas comissões</h2>
          {ownedOrg ? (
            <>
              <p className="mt-1 text-[12.5px] font-semibold text-muted">
                Suas comissões entram no caixa de {ownedOrg.displayName ?? ownedOrg.name} e liberam 2 dias úteis
                após o fim de cada evento, como as vendas. O saldo e o saque ficam no Financeiro.
              </p>
              <Link
                href={`/organizacoes/${ownedOrg.id}/financeiro`}
                className="mt-3 inline-flex h-10 items-center rounded-xl border border-line px-4 text-[13px] font-bold text-primary"
              >
                Ver no Financeiro →
              </Link>
            </>
          ) : wallet ? (
            <>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-bg px-4 py-3">
                  <p className="text-[12px] font-bold text-muted">Na sua carteira</p>
                  <p className="mt-0.5 text-[18px] font-extrabold">{brl(wallet.balanceCents)}</p>
                </div>
                <div className="rounded-xl bg-bg px-4 py-3">
                  <p className="text-[12px] font-bold text-muted">Já liberado</p>
                  <p className="mt-0.5 text-[18px] font-extrabold text-success">{brl(wallet.availableCents)}</p>
                </div>
              </div>
              <p className="mt-2 text-[12px] font-semibold text-muted">
                Cada comissão libera 2 dias úteis após o fim do evento em que a venda aconteceu.
              </p>
              {wallet.needsProducerAccount && ownedOrg === null ? (
                <p className="mt-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-[12.5px] font-semibold text-warning">
                  Para sacar, complete seu cadastro de produtor: toque em “Nova organização” e informe seu CPF ou
                  CNPJ. A carteira passa para a sua produtora, e o saque sai pelo Financeiro dela depois que a
                  BoraFest aprovar o cadastro e você cadastrar uma conta bancária.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {sellerInvites.length > 0 ? (
        <div className="rounded-[18px] border border-brand/30 bg-brand/5 p-5">
          <h2 className="text-[15px] font-extrabold">Convites para vender</h2>
          <div className="mt-3 space-y-2">
            {sellerInvites.map((invite) => (
              <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3">
                <div>
                  <p className="text-[13.5px] font-extrabold">
                    {invite.promoterLink.organization.displayName ?? invite.promoterLink.organization.name}
                  </p>
                  <p className="text-[12px] font-semibold text-muted">
                    convite de {invite.promoterLink.promoterUser.name ?? invite.promoterLink.promoterUser.email} para
                    vender os ingressos
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => respondSeller(invite.id, true)}
                    className="h-10 rounded-xl bg-primary px-4 text-[13px] font-extrabold text-white"
                  >
                    Aceitar
                  </button>
                  <button
                    type="button"
                    onClick={() => respondSeller(invite.id, false)}
                    className="h-10 rounded-xl border border-line px-4 text-[13px] font-bold"
                  >
                    Recusar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {sellerEngagements.length > 0 ? (
        <div className="rounded-[18px] border border-line bg-surface p-5">
          <h2 className="text-[15px] font-extrabold">Estou vendendo</h2>
          <p className="mt-1 text-[12px] font-semibold text-muted">
            Divulgue seu link — cada compra por ele entra na sua contagem.
          </p>
          <div className="mt-3 space-y-2">
            {sellerEngagements.map((eng) => (
              <div key={eng.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-bg px-4 py-3">
                <div>
                  <p className="text-[13.5px] font-extrabold">{eng.hostName}</p>
                  <p className="text-[12px] font-semibold text-muted">
                    com {eng.promoterName} · {eng.paidOrders} venda{eng.paidOrders === 1 ? "" : "s"} ·{" "}
                    {(eng.soldCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copySellerLink(eng.slug, eng.id)}
                  className="h-10 rounded-xl border border-line px-4 text-[13px] font-bold text-primary"
                >
                  {copied === eng.id ? "Copiado ✓" : "Copiar meu link"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function OrganizationsContent() {
  const { token } = useAuth();
  const [orgs, setOrgs] = useState<Array<Organization & { roleKey: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [kind, setKind] = useState<"INDIVIDUAL" | "COMPANY">("COMPANY");
  const [producerType, setProducerType] = useState<ProducerType | "">("");
  const [error, setError] = useState<string | null>(null);
  // falha ao listar mostrava "Nenhuma organização ainda — crie a primeira"
  // (2026-10-12): mesmo erro-que-vira-zero do laço da Marcela, agora com aviso
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    try {
      setOrgs(await organizationsApi.list(token));
    } catch (err) {
      setLoadError(err instanceof Error && err.message ? err.message : "Não foi possível carregar suas produtoras");
    } finally {
      setLoading(false);
    }
  }

  // dona de qual produtora? — é lá que caem as comissões de promoter.
  // undefined enquanto a lista não chegou (ou falhou): a carteira não chuta.
  const ownedOrg = loading || loadError ? undefined : (orgs.find((o) => o.roleKey === "owner") ?? null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleCreate() {
    if (!token) return;
    setError(null);
    try {
      if (!producerType) { setError("Escolha o tipo de produtor"); return; }
      const org = await organizationsApi.create(token, { name, document, kind, producerType });
      if (org.reused) {
        // o servidor devolveu a organização que JÁ é sua com esse documento:
        // fechar o formulário calado fazia parecer que o clique não pegou
        setError(`Você já tem a organização "${org.displayName ?? org.name}" com esse CPF/CNPJ — use a que já existe.`);
        return;
      }
      setShowForm(false);
      setName("");
      setDocument("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a organização");
    }
  }

  return (
    <>
      <div className="mb-4">
        <SalesPushButton />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] font-semibold text-muted">
          Suas produtoras e o status de cada uma. Para trocar a produtora que você
          está gerenciando, use o seletor no topo do menu ao lado.
        </p>
        <button
          type="button"
          className="rounded-xl border-[1.5px] border-line-input px-4 py-2.5 text-[13px] font-bold text-ink-soft"
          onClick={() => setShowForm((v) => !v)}
        >
          Nova organização
        </button>
      </div>

      <PromoterInbox ownedOrg={ownedOrg} />
      {showForm ? (
        <div className="mb-4 space-y-3 rounded-[18px] border border-line bg-surface p-5">
          <input placeholder="Nome" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          <input
            placeholder="CPF ou CNPJ"
            className={inputCls}
            value={document}
            onChange={(e) => setDocument(e.target.value.replace(/\D/g, ""))}
          />
          <select
            className={inputCls}
            value={kind}
            onChange={(e) => setKind(e.target.value as "INDIVIDUAL" | "COMPANY")}
          >
            <option value="COMPANY">Empresa (CNPJ)</option>
            <option value="INDIVIDUAL">Pessoa física (CPF)</option>
          </select>
          <select
            className={inputCls}
            value={producerType}
            onChange={(e) => setProducerType(e.target.value as ProducerType | "")}
          >
            <option value="">Tipo de produtor…</option>
            {PRODUCER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {error ? <p className="text-[12px] font-semibold text-danger">{error}</p> : null}
          <button
            type="button"
            className="h-11 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta"
            onClick={handleCreate}
          >
            Criar
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="text-[13px] font-semibold text-muted">Carregando…</p>
      ) : loadError ? (
        <div className="rounded-[18px] border border-danger/30 bg-danger/5 p-6 text-center">
          <p className="text-[13px] font-bold text-danger">{loadError}</p>
          <button
            type="button"
            onClick={load}
            className="mt-3 h-10 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta"
          >
            Tentar novamente
          </button>
        </div>
      ) : orgs.length === 0 ? (
        <div className="rounded-[18px] border border-line bg-surface p-10 text-center">
          <p className="text-[15px] font-extrabold">Nenhuma organização ainda</p>
          <p className="mt-1 text-[13px] font-semibold text-muted">Crie a primeira acima para começar a vender.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {orgs.map((org) => (
            <Link
              key={org.id}
              href={`/organizacoes/${org.id}`}
              className="flex items-center justify-between rounded-[14px] border border-line bg-surface px-5 py-4 hover:border-primary/40"
            >
              <span className="text-[14px] font-extrabold text-ink">{org.name}</span>
              <span className="text-[12px] font-semibold text-muted">
                {org.status} · {org.roleKey}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export default function OrganizationsPage() {
  return (
    <GuardedPanelShell title="Minhas produtoras">
      <OrganizationsContent />
    </GuardedPanelShell>
  );
}
