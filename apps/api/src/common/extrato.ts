export interface LinhaDeExtrato {
  type: string;
  amountCents: number;
  referenceType: string;
  referenceId: string;
}

/**
 * Junta os lançamentos crus do ledger nas linhas que o produtor lê.
 *
 * O ledger guarda uma venda em duas linhas (crédito do bruto + débito da taxa)
 * porque é assim que a contabilidade fecha. O produtor não tem por que ver a
 * taxa da plataforma: ele quer saber o que entrou pra ele.
 *
 * São duas fusões, não uma:
 *   venda   = SALE_CREDIT  + taxa cobrada   (PLATFORM_FEE negativa)
 *   estorno = REFUND_DEBIT + taxa devolvida (PLATFORM_FEE positiva)
 *
 * Assim uma venda de R$ 55 com R$ 5 de taxa lê "+R$ 50" e, se for devolvida
 * num cancelamento, "−R$ 50": o que entrou e o que saiu do bolso do produtor,
 * simétrico, com a taxa invisível dos dois lados. Somar as linhas agrupadas dá
 * exatamente o mesmo total de antes — o extrato continua batendo com o saldo.
 */
export function agruparExtrato<T extends LinhaDeExtrato>(entradas: T[]): T[] {
  const chave = (entrada: T): string | null => {
    if (entrada.type === "SALE_CREDIT") return `venda:${entrada.referenceId}`;
    if (entrada.type === "REFUND_DEBIT") return `estorno:${entrada.referenceId}`;
    if (entrada.type === "PLATFORM_FEE") {
      return entrada.amountCents < 0
        ? `venda:${entrada.referenceId}`
        : `estorno:${entrada.referenceId}`;
    }
    return null;
  };

  const linhas: T[] = [];
  const posicao = new Map<string, number>();

  for (const entrada of entradas) {
    const k = chave(entrada);
    if (!k) {
      linhas.push(entrada);
      continue;
    }
    const existente = posicao.get(k);
    if (existente === undefined) {
      posicao.set(k, linhas.length);
      linhas.push({ ...entrada, type: k.startsWith("venda:") ? "SALE_CREDIT" : "REFUND_DEBIT" });
      continue;
    }
    linhas[existente] = {
      ...linhas[existente],
      amountCents: linhas[existente].amountCents + entrada.amountCents,
    };
  }

  // uma taxa isolada no corte da página (o par ficou pra próxima) viraria uma
  // linha de R$ 0,00 sem significado — some com ela
  return linhas.filter((l) => l.amountCents !== 0);
}
