import { prisma } from "@borafest/database";

/** Saldo atual = soma de todos os lançamentos (nunca um campo mutável). */
export async function getOrganizationBalanceCents(organizationId: string): Promise<number> {
  const ledgerAccount = await prisma.ledgerAccount.findUnique({ where: { organizationId } });
  if (!ledgerAccount) return 0;

  const sum = await prisma.ledgerEntry.aggregate({
    where: { ledgerAccountId: ledgerAccount.id },
    _sum: { amountCents: true },
  });
  return sum._sum.amountCents ?? 0;
}

/**
 * Saldo maduro = tudo menos os créditos ainda dentro da janela de reembolso
 * (availableAt no futuro). Débitos contam sempre — dívida não espera janela.
 */
export async function getMaturedBalanceCents(organizationId: string): Promise<number> {
  const ledgerAccount = await prisma.ledgerAccount.findUnique({ where: { organizationId } });
  if (!ledgerAccount) return 0;

  const [total, held] = await Promise.all([
    prisma.ledgerEntry.aggregate({
      where: { ledgerAccountId: ledgerAccount.id },
      _sum: { amountCents: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: {
        ledgerAccountId: ledgerAccount.id,
        availableAt: { gt: new Date() },
        amountCents: { gt: 0 },
      },
      _sum: { amountCents: true },
    }),
  ]);
  return (total._sum.amountCents ?? 0) - (held._sum.amountCents ?? 0);
}

/**
 * Saldo reservado por repasses AINDA NÃO debitados do caixa.
 *
 * Auditoria 2026-08-10: contávamos PENDING + PAID, mas o repasse PAGO já vira
 * PAYOUT_DEBIT no ledger (markPayoutPaid / execução automática) — a mesma
 * quantia saía duas vezes do saldo disponível, e o produtor via menos dinheiro
 * do que tem. Reservado agora é só o que está EM TRÂNSITO (PENDING).
 */
export async function getReservedPayoutCents(organizationId: string): Promise<number> {
  const sum = await prisma.payout.aggregate({
    where: { organizationId, status: "PENDING" },
    _sum: { amountCents: true },
  });
  return sum._sum.amountCents ?? 0;
}

export interface PayoutAvailability {
  /** saldo contábil total */
  balanceCents: number;
  /** parcela ainda dentro da janela de reembolso */
  heldCents: number;
  /** o que pode ser sacado agora, já descontando repasses reservados */
  availableForPayoutCents: number;
  /** taxa de antecipação estimada se sacar availableForPayoutCents (só INSTANT) */
  anticipationFeeCents: number;
  settlementMode: "STANDARD" | "INSTANT";
}

function anticipationBpsMonthly(): number {
  // padrão de mercado repassado (Asaas: a partir de 1,25% a.m.)
  return Number(process.env.ANTICIPATION_FEE_BPS_MONTHLY ?? 125);
}

/**
 * Disponibilidade de saque conforme o modo de repasse da organização
 * (decisão 2026-07-28):
 * - STANDARD: só o saldo maduro (fora da janela de reembolso).
 * - INSTANT (casas de confiança): saldo total, com taxa de antecipação
 *   pró-rata sobre a parcela ainda na janela e responsabilidade contratual
 *   de reembolso transferida à casa (minuta em docs/juridico).
 */
export async function getPayoutAvailability(organizationId: string): Promise<PayoutAvailability> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { settlementMode: true },
  });
  const [balance, matured, reserved] = await Promise.all([
    getOrganizationBalanceCents(organizationId),
    getMaturedBalanceCents(organizationId),
    getReservedPayoutCents(organizationId),
  ]);
  const heldCents = balance - matured;

  if (org.settlementMode === "INSTANT") {
    const available = Math.max(balance - reserved, 0);
    return {
      balanceCents: balance,
      heldCents,
      availableForPayoutCents: available,
      anticipationFeeCents: await computeAnticipationFeeCents(organizationId, available),
      settlementMode: "INSTANT",
    };
  }

  return {
    balanceCents: balance,
    heldCents,
    availableForPayoutCents: Math.max(matured - reserved, 0),
    anticipationFeeCents: 0,
    settlementMode: "STANDARD",
  };
}

/**
 * Taxa de antecipação para um saque de `amountCents` de uma org INSTANT:
 * a parte do valor que ultrapassa o saldo maduro livre é alocada nos créditos
 * ainda em janela (mais antigos primeiro) e paga pró-rata pelos dias que
 * faltam para cada um liberar. Para STANDARD retorna 0 por construção
 * (o saque nunca alcança a parcela em janela).
 */
export async function computeAnticipationFeeCents(
  organizationId: string,
  amountCents: number,
): Promise<number> {
  if (amountCents <= 0) return 0;
  const [matured, reserved] = await Promise.all([
    getMaturedBalanceCents(organizationId),
    getReservedPayoutCents(organizationId),
  ]);
  let anticipated = amountCents - Math.max(matured - reserved, 0);
  if (anticipated <= 0) return 0;

  const ledgerAccount = await prisma.ledgerAccount.findUnique({ where: { organizationId } });
  if (!ledgerAccount) return 0;
  const now = Date.now();
  const heldEntries = await prisma.ledgerEntry.findMany({
    where: {
      ledgerAccountId: ledgerAccount.id,
      availableAt: { gt: new Date() },
      amountCents: { gt: 0 },
    },
    orderBy: { availableAt: "asc" },
    select: { amountCents: true, availableAt: true },
  });

  const bpsMonthly = anticipationBpsMonthly();
  let feeCents = 0;
  for (const entry of heldEntries) {
    if (anticipated <= 0) break;
    const slice = Math.min(entry.amountCents, anticipated);
    const remainingDays = Math.max(
      1,
      Math.ceil((entry.availableAt.getTime() - now) / (24 * 60 * 60 * 1000)),
    );
    feeCents += Math.ceil((slice * bpsMonthly * remainingDays) / (10000 * 30));
    anticipated -= slice;
  }
  return feeCents;
}

/** Disponível de saque no modo da organização (atalho usado por chamadas antigas). */
export async function getAvailableForPayoutCents(organizationId: string): Promise<number> {
  const { availableForPayoutCents } = await getPayoutAvailability(organizationId);
  return availableForPayoutCents;
}
