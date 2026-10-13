/**
 * PAGOU UM VALOR DIFERENTE DO COBRADO (2026-10-12).
 *
 * Quando o gateway informa um valor pago MENOR que o cobrado, nada é faturado
 * (packages/payments apply-status.ts, `registerAmountMismatch`): o pedido fica
 * pendente, expira na janela normal, e o backoffice recebe o alerta para cobrar
 * a diferença ou devolver o que entrou. O pagamento ganha
 * `metadata.amountMismatch = { expectedCents, paidCents, detectedAt }`.
 *
 * Sem este sinal, a tela do Pix ficava em "Aguardando pagamento" até expirar —
 * para quem JÁ pagou. Daqui sai só um sim/não: valores e o resto do metadata
 * (que pode ter dado do pagador) não saem.
 */

/** Pedido que chegou a ser pago (ou seguiu dali): o caso de valor diferente já foi resolvido. */
const JA_FOI_PAGO = ["PAID", "FULFILLED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED", "CHARGEBACK"];

export function pagouValorDiferente(order: { status: string; payments: Array<{ metadata: unknown }> }): boolean {
  if (JA_FOI_PAGO.includes(order.status)) return false;
  return order.payments.some((p) => {
    const metadata = p.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
    const marca = (metadata as Record<string, unknown>).amountMismatch;
    return Boolean(marca) && typeof marca === "object" && !Array.isArray(marca);
  });
}
