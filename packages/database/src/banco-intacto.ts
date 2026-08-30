import { prisma } from "./index";

/**
 * CHECAGEM "BANCO INTACTO" (padrão de projeto, incidente 2026-08-30).
 *
 * Regra do Arthur: TODA sessão de deploy/diagnóstico DEVE confirmar que o
 * banco segue intacto — tela vazia NUNCA é prova de dado perdido (no incidente,
 * a API morta fez o site parecer zerado com o banco 100% saudável).
 *
 * Uso:
 *   - local:      pnpm --filter @borafest/database run banco-intacto
 *   - produção:   (console do container api no EasyPanel)
 *                 cd packages/database && npx tsx src/banco-intacto.ts
 *
 * Sai com código 0 e "BANCO INTACTO" se as tabelas-núcleo têm dados;
 * sai com código 1 e alerta gritando se alguma tabela-núcleo estiver zerada.
 */
async function main(): Promise<void> {
  const [organizacoes, eventos, usuarios, pedidos, pagamentos, ingressos, ledger] =
    await Promise.all([
      prisma.organization.count(),
      prisma.event.count(),
      prisma.user.count(),
      prisma.order.count(),
      prisma.payment.count(),
      prisma.ticket.count(),
      prisma.ledgerEntry.count(),
    ]);

  const ultimoPedido = await prisma.order.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const linhas: Array<[string, number]> = [
    ["organizações", organizacoes],
    ["eventos", eventos],
    ["usuários", usuarios],
    ["pedidos", pedidos],
    ["pagamentos", pagamentos],
    ["ingressos", ingressos],
    ["lançamentos no ledger", ledger],
  ];

  console.log("\n=== CHECAGEM: BANCO INTACTO? ===");
  for (const [nome, n] of linhas) {
    console.log(`  ${nome.padEnd(22)} ${n}`);
  }
  console.log(`  último pedido em        ${ultimoPedido?.createdAt.toISOString() ?? "—"}`);

  // núcleo que NUNCA pode estar zerado numa produção que já vendeu
  const nucleo = { organizacoes, eventos, usuarios, pedidos };
  const zeradas = Object.entries(nucleo).filter(([, n]) => n === 0);

  if (zeradas.length > 0) {
    console.error(
      `\n🚨 ALERTA: tabela(s)-núcleo ZERADA(s): ${zeradas.map(([k]) => k).join(", ")} — ` +
        "PARE TUDO e confira DATABASE_URL/volume ANTES de qualquer migração ou deploy.",
    );
    process.exit(1);
  }
  console.log("\n✅ BANCO INTACTO — tabelas-núcleo com dados.\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error("Falha na checagem (conexão/schema):", error);
    await prisma.$disconnect();
    process.exit(1);
  });
