import { prisma } from "@borafest/database";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "retencao-webhooks" });

/**
 * RETENÇÃO DO CORPO CRU DOS WEBHOOKS DE PAGAMENTO (LGPD, 2026-10-12).
 *
 * `webhook_deliveries.raw_body` guarda o aviso do gateway exatamente como
 * chegou — o da Pagar.me traz o `customer` (nome, e-mail, CPF do pagador); o
 * do Mercado Pago, o `payer`. Serve para investigar um aviso logo depois que
 * ele chega; depois de alguns meses é só dado pessoal guardado sem motivo.
 *
 * Esta varredura esvazia o corpo ('') das linhas recebidas há mais de
 * WEBHOOK_RAW_RETENTION_DAYS dias. A linha FICA, com provedor, tipo, id do
 * evento, assinatura válida, situação, erro, cabeçalhos (já gravados sem
 * segredo) e datas — o histórico que o backoffice lista. A coluna não aceita
 * nulo (mudar seria migração): corpo vazio quer dizer "apagado pela
 * retenção". Nada relê o corpo gravado: a verificação de assinatura e a
 * aplicação do status usam o corpo que vai no job da fila.
 *
 * WEBHOOK_RAW_RETENTION_DAYS (worker): número inteiro de dias, mínimo 1.
 * Ausente ou vazio = 90. Valor inválido (texto, 0, negativo, fração) NÃO vira
 * o padrão em silêncio: a rodada falha com o motivo no log e nada é apagado
 * até corrigir — apagar com um prazo que ninguém escolheu é pior.
 */
export const RETENCAO_PADRAO_DIAS = 90;

const DIA_MS = 86_400_000;
/** linhas por UPDATE: transação curta, sem segurar a tabela */
const LOTE = 1000;
/** teto por rodada; o que passar fica para a próxima (a 1ª rodada pode ter meses de histórico) */
const LOTES_POR_RODADA = 50;

/** Dias de retenção a partir do valor da variável de ambiente. */
export function diasDeRetencaoDosWebhooks(valor: string | undefined): number {
  const texto = valor?.trim() ?? "";
  if (texto === "") return RETENCAO_PADRAO_DIAS;
  const dias = /^\d+$/.test(texto) ? Number(texto) : Number.NaN;
  if (!Number.isSafeInteger(dias) || dias < 1) {
    throw new Error(
      `WEBHOOK_RAW_RETENTION_DAYS inválido ("${texto}"): use um número inteiro de dias, a partir de 1 (padrão ${RETENCAO_PADRAO_DIAS})`,
    );
  }
  return dias;
}

/** Recebido ANTES deste instante = corpo apagado. */
export function corteDaRetencao(agora: Date, dias: number): Date {
  return new Date(agora.getTime() - dias * DIA_MS);
}

/** Apaga o corpo cru dos webhooks mais velhos que a retenção. Devolve quantas linhas mudaram. */
export async function limparCorpoDosWebhooksAntigos(agora: Date = new Date()): Promise<number> {
  const dias = diasDeRetencaoDosWebhooks(process.env.WEBHOOK_RAW_RETENTION_DAYS);
  const corte = corteDaRetencao(agora, dias);

  let total = 0;
  for (let lote = 0; lote < LOTES_POR_RODADA; lote++) {
    // received_at é timestamp sem fuso gravado em UTC (padrão do Prisma)
    const limpas = await prisma.$executeRaw`
      UPDATE webhook_deliveries
      SET raw_body = ''
      WHERE id IN (
        SELECT id
        FROM webhook_deliveries
        WHERE received_at < (${corte}::timestamptz AT TIME ZONE 'UTC')
          AND raw_body <> ''
        LIMIT ${LOTE}
        FOR UPDATE SKIP LOCKED
      )
    `;
    total += limpas;
    if (limpas < LOTE) break;
  }

  if (total > 0) log.info({ total, dias }, "corpo cru de webhooks antigos apagado (a linha fica)");
  if (total === LOTE * LOTES_POR_RODADA) {
    log.warn({ total }, "ainda há corpo cru de webhook antigo; a próxima rodada continua");
  }
  return total;
}
