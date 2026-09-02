import { prisma } from "./index";

/**
 * AUDITORIA DE E-MAILS DE COMPRA (queixa da Ana, 2026-09-02).
 *
 * Responde de verdade: "todos os e-mails de compra foram enviados?". A tabela
 * `notifications` é a fonte da verdade do que o SISTEMA tentou:
 *   - SENT    = o provedor (Resend) ACEITOU a mensagem (200). Atenção: NÃO é
 *               garantia de que caiu na caixa — bounce/spam acontecem DEPOIS
 *               disso e só aparecem no painel do Resend.
 *   - FAILED  = falhou nas 5 tentativas; o motivo fica em `error` (aqui mora o
 *               "domínio não verificado", "mailbox rejeitou", etc.).
 *   - PENDING = ainda na fila. Se for antigo, o worker de entrega não está
 *               drenando (fila parada / worker fora do ar).
 *
 * Uso:
 *   - resumo geral:   (console do container api/worker no EasyPanel)
 *                     cd packages/database && npx tsx src/auditoria-emails.ts
 *   - um comprador:   npx tsx src/auditoria-emails.ts ana.ramos3@ufu.br
 *                     (aceita e-mail, publicToken do pedido ou código do ingresso)
 *
 * NÃO altera nada — só lê. Sai 1 se achar e-mail de compra FAILED ou PENDING
 * preso (>15min), pra servir de alarme em cron.
 */

const COMPRA = ["ticket_delivery", "account_claim"]; // e-mails que o comprador espera após pagar

function pct(parte: number, total: number): string {
  return total === 0 ? "—" : `${((parte / total) * 100).toFixed(1)}%`;
}

async function resumoGeral(): Promise<boolean> {
  const [total, porStatus, porTemplate] = await Promise.all([
    prisma.notification.count(),
    prisma.notification.groupBy({ by: ["status"], _count: true }),
    prisma.notification.groupBy({ by: ["template", "status"], _count: true }),
  ]);

  console.log("======================================================");
  console.log("  AUDITORIA DE NOTIFICAÇÕES — geral");
  console.log("======================================================");
  console.log(`Total de notificações na fila persistente: ${total}`);
  const s = Object.fromEntries(porStatus.map((r) => [r.status, r._count as number]));
  const sent = s.SENT ?? 0, failed = s.FAILED ?? 0, pending = s.PENDING ?? 0;
  console.log(`  SENT    ${sent}\t(${pct(sent, total)})  — aceito pelo provedor`);
  console.log(`  FAILED  ${failed}\t(${pct(failed, total)})  — NÃO enviado (motivo em 'error')`);
  console.log(`  PENDING ${pending}\t(${pct(pending, total)})  — ainda na fila`);

  // foco no que o COMPRADOR espera
  console.log("\n--- só e-mails de COMPRA (ticket_delivery / account_claim) ---");
  const compra = porTemplate.filter((r) => COMPRA.includes(r.template));
  const agrupa: Record<string, Record<string, number>> = {};
  for (const r of compra) {
    agrupa[r.template] ??= {};
    agrupa[r.template][r.status] = r._count as number;
  }
  for (const tpl of COMPRA) {
    const g = agrupa[tpl] ?? {};
    const t = (g.SENT ?? 0) + (g.FAILED ?? 0) + (g.PENDING ?? 0);
    console.log(`  ${tpl.padEnd(16)} total ${t}\tSENT ${g.SENT ?? 0}\tFAILED ${g.FAILED ?? 0}\tPENDING ${g.PENDING ?? 0}`);
  }

  // os que NÃO chegaram por culpa nossa: FAILED de compra, com o motivo agrupado
  const falhados = await prisma.notification.findMany({
    where: { template: { in: COMPRA }, status: "FAILED" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { recipient: true, template: true, error: true, attempts: true, createdAt: true, orderId: true },
  });
  if (falhados.length) {
    console.log(`\n⚠️  ${falhados.length} e-mail(s) de COMPRA FAILED (não chegaram) — motivos:`);
    const porMotivo: Record<string, number> = {};
    for (const f of falhados) {
      const chave = (f.error ?? "sem mensagem").slice(0, 80);
      porMotivo[chave] = (porMotivo[chave] ?? 0) + 1;
    }
    for (const [motivo, n] of Object.entries(porMotivo).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${n}×  ${motivo}`);
    }
    console.log("  destinatários (até 50 mais recentes):");
    for (const f of falhados) {
      console.log(`    ${f.createdAt.toISOString().slice(0, 16)}  ${f.recipient}  [${f.template}]`);
    }
  } else {
    console.log("\n✓ Nenhum e-mail de compra FAILED.");
  }

  // presos: PENDING de compra com mais de 15 min = worker não está drenando
  const limite = new Date(Date.now() - 15 * 60 * 1000);
  const presos = await prisma.notification.findMany({
    where: { template: { in: COMPRA }, status: "PENDING", createdAt: { lt: limite } },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { recipient: true, template: true, attempts: true, availableAt: true, createdAt: true },
  });
  if (presos.length) {
    console.log(`\n⚠️  ${presos.length} e-mail(s) de COMPRA presos há >15min (worker de entrega parado?):`);
    for (const p of presos) {
      console.log(`    ${p.createdAt.toISOString().slice(0, 16)}  ${p.recipient}  attempts=${p.attempts}  próx=${p.availableAt.toISOString().slice(0, 16)}`);
    }
  } else {
    console.log("✓ Nenhum e-mail de compra preso na fila.");
  }

  return falhados.length === 0 && presos.length === 0;
}

async function drilldown(termo: string): Promise<void> {
  console.log("======================================================");
  console.log(`  AUDITORIA — comprador: ${termo}`);
  console.log("======================================================");

  // acha o(s) pedido(s) por e-mail, publicToken ou código de ingresso
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { contactEmail: { equals: termo, mode: "insensitive" } },
        { publicToken: termo },
        { user: { email: { equals: termo, mode: "insensitive" } } },
        { tickets: { some: { code: { equals: termo, mode: "insensitive" } } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true, publicToken: true, status: true, contactEmail: true, contactName: true,
      totalCents: true, createdAt: true, paidAt: true,
      user: { select: { email: true, emailVerifiedAt: true } },
      tickets: { select: { code: true, status: true } },
      event: { select: { title: true } },
    },
  });

  if (!orders.length) {
    console.log("Nenhum pedido encontrado para esse termo.");
    return;
  }

  for (const o of orders) {
    console.log(`\nPedido ${o.publicToken}  [${o.status}]  ${o.event.title}`);
    console.log(`  comprador: ${o.contactName ?? "—"} <${o.contactEmail}>  total R$ ${(o.totalCents / 100).toFixed(2)}`);
    console.log(`  criado ${o.createdAt.toISOString()}  pago ${o.paidAt?.toISOString() ?? "—"}`);
    console.log(`  conta: ${o.user ? `${o.user.email} (verificada: ${o.user.emailVerifiedAt ? "SIM" : "NÃO — recebe account_claim, não o QR"})` : "sem conta"}`);
    console.log(`  ingressos: ${o.tickets.map((t) => `${t.code}[${t.status}]`).join(", ") || "—"}`);

    const notifs = await prisma.notification.findMany({
      where: { orderId: o.id },
      orderBy: { createdAt: "asc" },
      select: { channel: true, template: true, recipient: true, status: true, attempts: true, error: true, sentAt: true, createdAt: true },
    });
    if (!notifs.length) {
      console.log("  📭  NENHUMA notificação foi criada para este pedido — o sistema nunca tentou enviar.");
      console.log("      (pedido pago sem emissão? worker não rodou o issue-tickets deste pedido)");
      continue;
    }
    console.log("  notificações:");
    for (const n of notifs) {
      const quando = n.sentAt ? `SENT ${n.sentAt.toISOString().slice(0, 16)}` : n.status;
      console.log(`    [${n.channel}] ${n.template.padEnd(16)} -> ${n.recipient}`);
      console.log(`        status=${n.status}  ${quando}  attempts=${n.attempts}${n.error ? `  erro="${n.error.slice(0, 120)}"` : ""}`);
    }
    console.log("  ↳ SENT = Resend aceitou. Se o comprador ainda diz que não recebeu, confira no");
    console.log("    painel do Resend (Logs) se ESTE e-mail deu 'delivered', 'bounced' ou 'complained'.");
  }
}

async function main(): Promise<void> {
  const termo = process.argv[2]?.trim();
  let saudavel = true;
  if (termo) {
    await drilldown(termo);
  } else {
    saudavel = await resumoGeral();
  }
  await prisma.$disconnect();
  console.log("\n" + (saudavel ? "✅ Sem e-mail de compra perdido (FAILED/preso)." : "⚠️  Há e-mail(s) de compra sem entrega — ver acima."));
  process.exit(saudavel ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
