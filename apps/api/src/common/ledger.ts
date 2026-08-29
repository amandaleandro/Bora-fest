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
 * Saldo maduro = tudo menos o LÍQUIDO do que ainda não liberou (availableAt no
 * futuro). Correção 2026-08-19: antes descontava só os créditos POSITIVOS em
 * janela, então a taxa da plataforma (débito, nascida madura) era subtraída do
 * saldo sacável de HOJE enquanto seu crédito só entrava depois do evento —
 * cada venda futura derrubava o que o produtor podia sacar.
 *
 * Dívida de verdade (reembolso, saque, comissão paga, antecipação) continua
 * contando na hora: esses lançamentos nascem com availableAt = agora, então
 * ficam fora do bloco "em janela" por construção.
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

export interface OrganizationEarnings {
  /** tudo que já virou dinheiro do produtor, desde sempre */
  totalCents: number;
  /** o que já caiu na conta dele (repasses efetivamente pagos) */
  receivedCents: number;
  /** repasse já pedido, ainda a caminho */
  inTransitCents: number;
  /** pode pedir saque agora */
  availableCents: number;
  /** vendas de evento que ainda não liberou */
  pendingReleaseCents: number;
  /** saldo devedor: já sacou e depois houve estorno. Zero na esmagadora maioria. */
  debtCents: number;
}

/**
 * Os ganhos REAIS da produtora (2026-08-29).
 *
 * A tela de Resumo somava `order.totalCents` dos pedidos pagos — o BRUTO, que
 * inclui a taxa da plataforma que o comprador pagou — e ainda perdia o pedido
 * inteiro quando ele tinha reembolso parcial (o status sai de PAID e o filtro
 * derrubava a linha toda). O produtor via um número que não era dele e que
 * mentia depois de qualquer estorno.
 *
 * Aqui a fonte é o ledger, que é a contabilidade de verdade: ele já credita a
 * venda, debita a taxa, debita o reembolso (total ou parcial), debita a
 * comissão do promoter e debita o saque. Somar o ledger é, por definição, "o
 * que é do produtor" — nada é estimado e nada é inventado.
 *
 * As parcelas somam o total por construção:
 *   total = recebido + a caminho + disponível + a liberar − em aberto
 * `pendingRelease` sai por diferença justamente para essa conta nunca abrir,
 * inclusive no modo INSTANT (onde não há parcela retida) e quando o saque
 * reservado passa do saldo maduro.
 *
 * `debtCents` existe porque a diferença PODE dar negativo (revisão adversarial
 * 2026-08-29): quem já sacou tudo e depois sofre estorno — ou cancela um evento
 * com o dinheiro na mão — fica com saldo devedor. Prender isso num `Math.max`
 * em zero fazia as parcelas somarem MAIS que o total, e o produtor via um
 * "já recebido" que não existia mais. Agora a dívida aparece com esse nome.
 */
export async function getOrganizationEarnings(organizationId: string): Promise<OrganizationEarnings> {
  const [availability, pagos, inTransitCents] = await Promise.all([
    getPayoutAvailability(organizationId),
    prisma.payout.aggregate({
      where: { organizationId, status: "PAID" },
      _sum: { amountCents: true },
    }),
    getReservedPayoutCents(organizationId),
  ]);

  const receivedCents = pagos._sum.amountCents ?? 0;
  const availableCents = availability.availableForPayoutCents;
  const porLiberar = availability.balanceCents - inTransitCents - availableCents;

  return {
    totalCents: availability.balanceCents + receivedCents,
    receivedCents,
    inTransitCents,
    availableCents,
    pendingReleaseCents: Math.max(porLiberar, 0),
    debtCents: Math.max(-porLiberar, 0),
  };
}

/**
 * Quanto cada evento da produtora rendeu LÍQUIDO para ela.
 *
 * Um lançamento chega ao evento por dois caminhos, porque foi assim que o
 * ledger cresceu: venda, taxa e estorno de PDV apontam para o pedido
 * (`reference_type = 'order'`), enquanto estorno de gateway e comissão de
 * promoter apontam para o pagamento (`reference_type = 'payment'`). Os dois
 * são resolvidos aqui — ignorar o segundo faria um evento com reembolso
 * aparecer rendendo mais do que rendeu.
 *
 * Saque e taxa de antecipação apontam para `payout` e ficam de fora de
 * propósito: retirar dinheiro não é um evento render menos.
 *
 * O CTE é MATERIALIZED para o filtro de tipo rodar ANTES do cast de uuid —
 * sem isso o planner pode tentar converter um `reference_id` de outro tipo e
 * derrubar a consulta.
 */
export async function getEarningsByEventCents(organizationId: string): Promise<Map<string, number>> {
  const ledgerAccount = await prisma.ledgerAccount.findUnique({ where: { organizationId } });
  if (!ledgerAccount) return new Map();

  const linhas = await prisma.$queryRaw<Array<{ eventId: string; netCents: bigint }>>`
    WITH entradas AS MATERIALIZED (
      SELECT reference_type, reference_id::uuid AS ref, amount_cents
      FROM ledger_entries
      WHERE ledger_account_id = ${ledgerAccount.id}::uuid
        AND reference_type IN ('order', 'payment')
    )
    SELECT o.event_id AS "eventId", SUM(en.amount_cents)::bigint AS "netCents"
    FROM entradas en
    LEFT JOIN payments p ON en.reference_type = 'payment' AND p.id = en.ref
    JOIN orders o ON o.id = CASE WHEN en.reference_type = 'order' THEN en.ref ELSE p.order_id END
    GROUP BY o.event_id
  `;

  return new Map(linhas.map((l) => [l.eventId, Number(l.netCents)]));
}

/**
 * Líquido de um evento só — mesma resolução de `getEarningsByEventCents`
 * (pedido e pagamento), usada no painel do próprio evento.
 */
export async function getEventNetCents(eventId: string): Promise<number> {
  // SÓ a conta da casa dona do evento (revisão adversarial 2026-08-29): sem
  // este filtro a consulta somava TODAS as contas do ledger, e a comissão do
  // promoter — débito na casa, crédito na carteira DELE, ambos com o mesmo
  // referenceId — se anulava. O painel do evento anunciava um "Seu ganho"
  // maior que o dinheiro que o produtor tem, e brigava com o Resumo (que
  // sempre filtrou) na mesma sessão.
  const evento = await prisma.event.findUnique({
    where: { id: eventId },
    select: { organizationId: true },
  });
  if (!evento) return 0;
  const ledgerAccount = await prisma.ledgerAccount.findUnique({
    where: { organizationId: evento.organizationId },
  });
  if (!ledgerAccount) return 0;

  const linhas = await prisma.$queryRaw<Array<{ netCents: bigint | null }>>`
    WITH entradas AS MATERIALIZED (
      SELECT reference_type, reference_id::uuid AS ref, amount_cents
      FROM ledger_entries
      WHERE ledger_account_id = ${ledgerAccount.id}::uuid
        AND reference_type IN ('order', 'payment')
    )
    SELECT SUM(en.amount_cents)::bigint AS "netCents"
    FROM entradas en
    LEFT JOIN payments p ON en.reference_type = 'payment' AND p.id = en.ref
    JOIN orders o ON o.id = CASE WHEN en.reference_type = 'order' THEN en.ref ELSE p.order_id END
    WHERE o.event_id = ${eventId}::uuid
  `;
  return Number(linhas[0]?.netCents ?? 0);
}
