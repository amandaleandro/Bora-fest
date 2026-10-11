/**
 * MÍNIMO DE UMA COBRANÇA ONLINE (Pix ou cartão pelo gateway). O Asaas recusa
 * cobrança abaixo de R$ 5,00 (REGISTRO, provado contra a API real); o valor
 * vem de PAYMENT_MIN_CHARGE_CENTS.
 *
 * Fonte única (2026-10-11): a trava só existia no "Gerar Pix", com o pedido já
 * criado — estoque, cupom e limite por CPF presos 30 min e e-mail de "seu Pix
 * expira" de um Pix que nunca existiu. Agora o lote e o pedido perguntam aqui
 * antes de gravar, com a MESMA regra do pagamento.
 */
export function minimoDaCobrancaCents(): number {
  return Number(process.env.PAYMENT_MIN_CHARGE_CENTS ?? 500);
}

/** "R$ 5,00" — mesmo formato da mensagem que o pagamento já mostrava. */
export function emReais(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Valor que não dá para cobrar online: acima de zero (R$ 0 é grátis, não passa
 * pelo gateway) e abaixo do mínimo. Nunca cobrar o mínimo no lugar (decisão do
 * Arthur 2026-10-11): o comprador é avisado e muda a quantidade.
 */
export function abaixoDoMinimoOnline(totalCents: number): boolean {
  return totalCents > 0 && totalCents < minimoDaCobrancaCents();
}
