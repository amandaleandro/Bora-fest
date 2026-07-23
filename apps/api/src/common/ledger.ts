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

/** Saldo já reservado por repasses pendentes/pagos (não pode ser pedido de novo). */
export async function getReservedPayoutCents(organizationId: string): Promise<number> {
  const sum = await prisma.payout.aggregate({
    where: { organizationId, status: { in: ["PENDING", "PAID"] } },
    _sum: { amountCents: true },
  });
  return sum._sum.amountCents ?? 0;
}

export async function getAvailableForPayoutCents(organizationId: string): Promise<number> {
  const [balance, reserved] = await Promise.all([
    getOrganizationBalanceCents(organizationId),
    getReservedPayoutCents(organizationId),
  ]);
  return Math.max(balance - reserved, 0);
}
