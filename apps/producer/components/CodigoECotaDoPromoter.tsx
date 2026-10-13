"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { organizationsApi, type PromoterLinkEditado, type PromoterRow } from "@/lib/api";

/**
 * CÓDIGO E COTA DO PROMOTER (2026-10-12): a cota de convidados nascia 0 e não
 * havia onde liberar — o promoter tentava pôr alguém na lista e ouvia "peça
 * para a produção liberar a sua cota". O código pessoal também não tinha
 * campo. A regra mora no servidor (PATCH /v1/organizations/:id/promoters/:linkId);
 * aqui só a edição na linha, usada na área da Casa e na tela Promoters do evento.
 */

/** Texto aprovado no protótipo de 2026-10-12. */
export const AJUDA_CODIGO_E_COTA =
  "Cota 0 = o promoter não cadastra convidado. O código pessoal (ex.: BIA10) atribui a venda mesmo sem o link.";

export const campoDoPromoterCls =
  "h-[34px] rounded-xl border-[1.5px] border-line-input bg-surface px-2.5 text-[13px] font-bold outline-none focus:border-primary disabled:opacity-60";

/** O mesmo que o servidor aceita: só letras e números, em maiúsculas, até 16. */
function limparCodigo(valor: string): string {
  return valor.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}

export function useCodigoECota(
  organizationId: string,
  promoter: PromoterRow,
  onSalvo: (editado: PromoterLinkEditado) => void,
) {
  const { token } = useAuth();
  const codigoSalvo = promoter.code ?? "";
  // sem o número do servidor o campo fica vazio — nunca um "0" chutado
  const cotaSalva = typeof promoter.guestQuota === "number" ? String(promoter.guestQuota) : "";
  const [codigo, setCodigo] = useState(codigoSalvo);
  const [cota, setCota] = useState(cotaSalva);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  // trava de clique duplo: o estado do React só muda no próximo render
  const emAndamento = useRef(false);

  // a lista recarregou (ou o salvamento voltou): os campos mostram o que está gravado
  useEffect(() => {
    setCodigo(codigoSalvo);
    setCota(cotaSalva);
  }, [codigoSalvo, cotaSalva]);

  const alterado = codigo !== codigoSalvo || cota !== cotaSalva;

  function mudarCodigo(valor: string) {
    setCodigo(limparCodigo(valor));
    setErro(null);
    setSalvo(false);
  }

  function mudarCota(valor: string) {
    setCota(valor.replace(/\D/g, "").slice(0, 4));
    setErro(null);
    setSalvo(false);
  }

  async function salvar() {
    if (!token || emAndamento.current) return;
    const novoCodigo = limparCodigo(codigo);
    if (novoCodigo !== "" && novoCodigo.length < 3) {
      setErro("O código precisa de 3 a 16 letras ou números. Deixe em branco para ficar sem código.");
      return;
    }
    if (cota.trim() === "") {
      setErro("Informe a cota de convidados (0 = nenhum).");
      return;
    }
    const novaCota = Number(cota);
    if (!Number.isInteger(novaCota) || novaCota < 0 || novaCota > 1000) {
      setErro("A cota vai de 0 a 1000.");
      return;
    }

    // só o que mudou: o histórico da Casa registra exatamente isso
    const corpo: { code?: string | null; guestQuota?: number } = {};
    if (novoCodigo !== codigoSalvo) corpo.code = novoCodigo || null;
    if (novaCota !== promoter.guestQuota) corpo.guestQuota = novaCota;
    if (corpo.code === undefined && corpo.guestQuota === undefined) {
      setCodigo(codigoSalvo);
      setCota(cotaSalva);
      return;
    }

    emAndamento.current = true;
    setSalvando(true);
    setErro(null);
    setSalvo(false);
    try {
      const editado = await organizationsApi.updatePromoterLink(token, organizationId, promoter.id, corpo);
      onSalvo(editado);
      setSalvo(true);
    } catch (err) {
      setErro(err instanceof Error && err.message ? err.message : "Não foi possível salvar — tente de novo.");
    } finally {
      emAndamento.current = false;
      setSalvando(false);
    }
  }

  return { codigo, cota, mudarCodigo, mudarCota, alterado, salvar, salvando, erro, salvo };
}

/** Código e cota no cartão do promoter (área da Casa, em Meus eventos → Promoters). */
export function CodigoECotaDoPromoter({
  organizationId,
  promoter,
  onSalvo,
}: {
  organizationId: string;
  promoter: PromoterRow;
  onSalvo: (editado: PromoterLinkEditado) => void;
}) {
  const edicao = useCodigoECota(organizationId, promoter, onSalvo);
  const aoTeclar = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") edicao.salvar();
  };

  return (
    <div className="mt-3 border-t border-line-divider pt-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-muted">Código</span>
          <input
            className={`${campoDoPromoterCls} w-[120px] uppercase`}
            placeholder="sem código"
            value={edicao.codigo}
            disabled={edicao.salvando}
            onChange={(e) => edicao.mudarCodigo(e.target.value)}
            onKeyDown={aoTeclar}
          />
        </label>
        <label className="block">
          {/* a lista conta a cota em cada evento (guest-list.service) */}
          <span className="mb-1 block text-[11px] font-bold text-muted">Cota de convidados por evento</span>
          <input
            inputMode="numeric"
            className={`${campoDoPromoterCls} w-[96px]`}
            value={edicao.cota}
            disabled={edicao.salvando}
            onChange={(e) => edicao.mudarCota(e.target.value)}
            onKeyDown={aoTeclar}
          />
        </label>
        {edicao.alterado ? (
          <button
            type="button"
            onClick={edicao.salvar}
            disabled={edicao.salvando}
            className="h-[34px] rounded-xl bg-primary px-4 text-[12.5px] font-extrabold text-white disabled:opacity-50"
          >
            {edicao.salvando ? "Salvando…" : "Salvar"}
          </button>
        ) : null}
        {edicao.salvo ? <span className="pb-2 text-[12px] font-bold text-success">Salvo — já vale.</span> : null}
      </div>
      {edicao.erro ? <p className="mt-2 text-[12px] font-bold text-danger">{edicao.erro}</p> : null}
    </div>
  );
}
