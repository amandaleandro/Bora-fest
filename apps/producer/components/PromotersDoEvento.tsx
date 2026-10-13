"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { hotsiteUrl } from "@/lib/config";
import { ApiError, organizationsApi, type PromoterLinkEditado, type PromoterRow } from "@/lib/api";
import { copiarTexto } from "@/lib/copiar";
import { AJUDA_CODIGO_E_COTA, campoDoPromoterCls, useCodigoECota } from "@/components/CodigoECotaDoPromoter";

/**
 * PROMOTERS DO EVENTO (2026-10-12): código pessoal, cota de convidados e o
 * "Copiar link desta festa" de cada promoter que vale para este evento — os
 * da Casa inteira e os convidados só para ele.
 *
 * O link é o do evento com ?pr= e funciona também em evento privado: a agenda
 * do promoter não mostra festa privada (decisão de 2026-10-11), então é o
 * produtor quem manda o link.
 */
export function PromotersDoEvento({
  organizationId,
  event,
  privado,
}: {
  organizationId: string;
  event: { id: string; slug: string; status: string };
  /** undefined = não sabemos; aí o aviso de evento privado não aparece */
  privado?: boolean;
}) {
  const { token } = useAuth();
  const [promoters, setPromoters] = useState<PromoterRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [semPermissao, setSemPermissao] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!token) return;
    let ativo = true;
    setErro(null);
    setSemPermissao(false);
    organizationsApi
      .listPromoters(token, organizationId)
      .then((lista) => {
        if (ativo) setPromoters(lista);
      })
      .catch((err) => {
        if (!ativo) return;
        // financeiro vê o placar, mas código, cota e link são de quem gerencia a Casa
        if (err instanceof ApiError && err.status === 403) setSemPermissao(true);
        else setErro(err instanceof Error && err.message ? err.message : "Não foi possível carregar os promoters");
      });
    return () => {
      ativo = false;
    };
  }, [token, organizationId, tentativa]);

  function aoSalvar(editado: PromoterLinkEditado) {
    setPromoters((antes) =>
      antes
        ? antes.map((p) => (p.id === editado.id ? { ...p, code: editado.code, guestQuota: editado.guestQuota } : p))
        : antes,
    );
  }

  // vale para este evento: o promoter da Casa inteira e o convidado só para ele.
  // Sem `eventId` na resposta (API anterior a esta tela), só o da Casa inteira
  // é certeza — o de outro evento nunca ganha "Copiar link desta festa".
  const daFesta = (promoters ?? []).filter((p) =>
    p.eventId === undefined ? !p.eventTitle : !p.eventId || p.eventId === event.id,
  );
  const linkAbre = event.status === "PUBLISHED" || event.status === "SALES_PAUSED";

  return (
    <section className="mt-6 overflow-hidden rounded-3xl border border-line bg-surface">
      <div className="border-b border-line px-5 py-4">
        <h2 className="text-[15px] font-black text-ink">Código, cota e link desta festa</h2>
        <p className="mt-1 text-[11.5px] font-semibold text-muted">{AJUDA_CODIGO_E_COTA}</p>
        {privado ? (
          <p className="mt-2 rounded-xl bg-primary/5 px-3 py-2 text-[12px] font-bold text-primary">
            Evento privado: ele não aparece na agenda dos promoters. Mande a cada um o link desta festa.
          </p>
        ) : null}
        {!linkAbre ? (
          <p className="mt-2 rounded-xl bg-warning/10 px-3 py-2 text-[12px] font-bold text-warning">
            {event.status === "CANCELED"
              ? "Evento cancelado: o link não abre mais."
              : "O link só abre depois que o evento for publicado."}
          </p>
        ) : null}
      </div>

      {semPermissao ? (
        <p className="px-5 py-6 text-[12.5px] font-semibold text-muted">
          Só o dono ou um administrador da Casa vê e muda o código, a cota e o link de cada promoter.
        </p>
      ) : erro ? (
        <div className="px-5 py-6 text-center">
          <p className="text-[13px] font-bold text-danger">{erro}</p>
          <button
            type="button"
            onClick={() => setTentativa((t) => t + 1)}
            className="mt-3 h-10 rounded-xl bg-primary px-5 text-[13px] font-extrabold text-white shadow-cta"
          >
            Tentar novamente
          </button>
        </div>
      ) : promoters === null ? (
        <p className="px-5 py-6 text-[12.5px] font-semibold text-muted">Carregando promoters…</p>
      ) : daFesta.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-[14px] font-extrabold text-ink">Nenhum promoter nesta festa</p>
          <p className="mt-1 text-[12px] font-semibold text-muted">
            Convide na área da Casa, em{" "}
            <Link href={`/organizacoes/${organizationId}`} className="font-extrabold text-primary">
              Meus eventos → Promoters
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-bg/55 text-[10.5px] font-extrabold uppercase tracking-[.04em] text-muted-2">
                <th className="px-5 py-3">Promoter</th>
                <th className="px-3 py-3">Código</th>
                <th className="px-3 py-3">Cota de convidados</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {daFesta.map((p) => (
                <LinhaDoPromoter
                  key={p.id}
                  organizationId={organizationId}
                  promoter={p}
                  link={`${hotsiteUrl(event.slug)}?pr=${p.slug}`}
                  onSalvo={aoSalvar}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function LinhaDoPromoter({
  organizationId,
  promoter,
  link,
  onSalvo,
}: {
  organizationId: string;
  promoter: PromoterRow;
  link: string;
  onSalvo: (editado: PromoterLinkEditado) => void;
}) {
  const edicao = useCodigoECota(organizationId, promoter, onSalvo);
  const [copia, setCopia] = useState<"ok" | "falhou" | null>(null);

  async function copiar() {
    const ok = await copiarTexto(link);
    setCopia(ok ? "ok" : "falhou");
    if (ok) setTimeout(() => setCopia(null), 2000);
  }

  const aguardando = promoter.status !== "ACTIVE";
  const temAviso = Boolean(edicao.erro) || edicao.salvo || copia === "falhou";

  return (
    <>
      <tr className={temAviso ? "" : "border-b border-line-divider last:border-0"}>
        <td className="px-5 py-3">
          <p className="font-extrabold text-ink">{promoter.promoterName}</p>
          <p className="mt-0.5 text-[11px] font-semibold text-muted">
            {promoter.eventId ? "só este evento" : "todos os eventos"}
            {aguardando ? " · aguardando aceite" : ""}
          </p>
        </td>
        <td className="px-3 py-3">
          <input
            aria-label={`Código de ${promoter.promoterName}`}
            className={`${campoDoPromoterCls} w-[104px] uppercase`}
            placeholder="sem código"
            value={edicao.codigo}
            disabled={edicao.salvando}
            onChange={(e) => edicao.mudarCodigo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") edicao.salvar();
            }}
          />
        </td>
        <td className="px-3 py-3">
          <input
            aria-label={`Cota de convidados de ${promoter.promoterName}`}
            inputMode="numeric"
            className={`${campoDoPromoterCls} w-[72px]`}
            value={edicao.cota}
            disabled={edicao.salvando}
            onChange={(e) => edicao.mudarCota(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") edicao.salvar();
            }}
          />
        </td>
        <td className="px-5 py-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {edicao.alterado ? (
              <button
                type="button"
                onClick={edicao.salvar}
                disabled={edicao.salvando}
                className="h-9 rounded-xl bg-primary px-4 text-[12.5px] font-extrabold text-white disabled:opacity-50"
              >
                {edicao.salvando ? "Salvando…" : "Salvar"}
              </button>
            ) : null}
            {aguardando ? (
              // o link só conta depois do aceite: copiar agora daria venda sem atribuição
              <span className="text-[11.5px] font-bold text-muted">Link libera quando aceitar</span>
            ) : (
              <button
                type="button"
                onClick={copiar}
                className="h-9 whitespace-nowrap rounded-xl border-[1.5px] border-line-input bg-surface px-3 text-[12.5px] font-extrabold text-primary"
              >
                {copia === "ok" ? "Copiado ✓" : "Copiar link desta festa"}
              </button>
            )}
          </div>
        </td>
      </tr>
      {temAviso ? (
        <tr className="border-b border-line-divider last:border-0">
          <td colSpan={4} className="px-5 pb-3">
            {edicao.erro ? <p className="text-[12px] font-bold text-danger">{edicao.erro}</p> : null}
            {edicao.salvo ? <p className="text-[12px] font-bold text-success">Salvo — já vale.</p> : null}
            {copia === "falhou" ? (
              <p className="text-[12px] font-semibold text-muted">
                Não deu para copiar sozinho. Selecione e copie:{" "}
                <span className="select-all break-all font-mono text-ink">{link}</span>
              </p>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}
