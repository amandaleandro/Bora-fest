import { prisma } from "./index";

/**
 * RESGATE DE PEDIDO PRESO EM CONTA-FANTASMA (incidente 2026-09-02, Maycon).
 *
 * Cenário: o comprador digitou o e-mail errado no checkout (ex.: "@gmail.comm"),
 * o pedido nasceu grudado numa conta criada com esse endereço inexistente, o
 * e-mail de acesso quicou e ele NÃO tem como se resgatar sozinho:
 *   - correctEmail recusa quando o e-mail certo JÁ tem conta ("ocupado");
 *   - a reivindicação por OTP só pega pedido SEM dono (userId: null).
 * Resultado: pagou, o ingresso existe, e a carteira dele fica vazia.
 *
 * Esta ferramenta move o pedido (e os ingressos) da conta-fantasma para a conta
 * REAL, aplicando as MESMAS invariantes do correctEmail:
 *   - a conta-fantasma tem de ter nascido deste pedido (accountCreatedByOrder),
 *     estar NÃO verificada e não ter senha (nunca mexe em conta de produtor);
 *   - a conta de destino tem de existir (é o dono comprovado do e-mail certo).
 *
 * Uso (console do container api/worker no EasyPanel):
 *   # 1) diagnóstico, não altera nada:
 *   cd packages/database && npx tsx src/resgatar-pedido.ts BF-5E059D96 maycon@gmail.com
 *   # 2) aplicar de fato:
 *   npx tsx src/resgatar-pedido.ts BF-5E059D96 maycon@gmail.com --aplicar
 *
 * O 1º argumento aceita o "#BF-XXXXXXXX" da tela, o publicToken inteiro ou o
 * e-mail errado. O 2º é o e-mail CERTO (destino).
 */

function normaliza(email: string): string {
  return email.trim().toLowerCase();
}

async function main(): Promise<void> {
  const alvo = process.argv[2]?.trim();
  const emailCerto = process.argv[3] ? normaliza(process.argv[3]) : undefined;
  const aplicar = process.argv.includes("--aplicar");

  if (!alvo || !emailCerto) {
    console.log("uso: npx tsx src/resgatar-pedido.ts <#BF-XXXX|publicToken|email-errado> <email-certo> [--aplicar]");
    process.exit(1);
  }

  // aceita "#BF-5E059D96", "BF-5E059D96", publicToken inteiro ou o e-mail errado
  const prefixo = alvo.replace(/^#?BF-/i, "").toLowerCase();
  const order = await prisma.order.findFirst({
    where: alvo.includes("@")
      ? { contactEmail: { equals: normaliza(alvo), mode: "insensitive" } }
      : { publicToken: { startsWith: prefixo } },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, email: true, emailVerifiedAt: true, passwordHash: true } },
      event: { select: { title: true, startsAt: true } },
      tickets: { select: { id: true, code: true, status: true, ownerUserId: true } },
    },
  });

  if (!order) {
    console.log(`❌ Nenhum pedido encontrado para "${alvo}".`);
    process.exit(1);
  }

  console.log("======================================================");
  console.log("  RESGATE DE PEDIDO — diagnóstico");
  console.log("======================================================");
  console.log(`Pedido #BF-${order.publicToken.slice(0, 8).toUpperCase()}  [${order.status}]`);
  console.log(`  evento: ${order.event.title} (${order.event.startsAt.toISOString()})`);
  console.log(`  total: R$ ${(order.totalCents / 100).toFixed(2)}`);
  console.log(`  contactEmail (digitado): ${order.contactEmail}`);
  console.log(`  conta atual do pedido: ${order.user ? `${order.user.email} (verificada: ${order.user.emailVerifiedAt ? "SIM" : "não"}, senha: ${order.user.passwordHash ? "SIM" : "não"})` : "SEM DONO"}`);
  console.log(`  ingressos: ${order.tickets.map((t) => `${t.code}[${t.status}]`).join(", ") || "nenhum"}`);
  console.log(`  destino pedido: ${emailCerto}`);

  if (order.user?.email === emailCerto) {
    console.log("\n✓ O pedido JÁ está na conta certa — nada a fazer.");
    await prisma.$disconnect();
    return;
  }

  // invariantes de segurança (espelham o correctEmail)
  const problemas: string[] = [];
  if (order.user?.passwordHash) problemas.push("a conta atual tem SENHA (conta real de produtor) — jamais mexer por aqui");
  if (order.user && order.user.emailVerifiedAt) problemas.push("a conta atual JÁ foi verificada — e-mail verificado é identidade, mover seria sequestro");
  if (order.user && !order.accountCreatedByOrder) problemas.push("a conta atual NÃO nasceu deste pedido — mover pode roubar pedido de outra pessoa");
  if (problemas.length) {
    console.log("\n❌ RECUSADO — não é um caso de conta-fantasma:");
    for (const p of problemas) console.log(`   - ${p}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  const destino = await prisma.user.findUnique({
    where: { email: emailCerto },
    select: { id: true, email: true, emailVerifiedAt: true },
  });
  if (!destino) {
    console.log(`\n❌ Não existe conta para ${emailCerto}.`);
    console.log("   Neste caso o próprio comprador resolve: peça pra ele usar 'corrigir e-mail'");
    console.log("   na página do pedido (correctEmail), que renomeia a conta-fantasma.");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`\n  conta de destino: ${destino.email} (verificada: ${destino.emailVerifiedAt ? "SIM" : "não"}) id=${destino.id}`);
  console.log("\nO QUE SERÁ FEITO:");
  console.log(`  1. order.userId  -> ${destino.id}`);
  console.log(`  2. order.contactEmail -> ${emailCerto}`);
  const ticketsParaMover = order.tickets.filter((t) => t.ownerUserId && t.ownerUserId === order.user?.id);
  console.log(`  3. tickets com ownerUserId da conta-fantasma: ${ticketsParaMover.length} (serão movidos)`);
  console.log(`  4. auditLog "suporte.pedido.resgatado"`);

  if (!aplicar) {
    console.log("\n(dry-run — nada foi alterado. Rode de novo com --aplicar para aplicar.)");
    await prisma.$disconnect();
    return;
  }

  const fantasmaId = order.user?.id;
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: { userId: destino.id, contactEmail: emailCerto, accountCreatedByOrder: false },
    });
    if (fantasmaId) {
      await tx.ticket.updateMany({
        where: { orderId: order.id, ownerUserId: fantasmaId },
        data: { ownerUserId: destino.id },
      });
    }
    await tx.auditLog.create({
      data: {
        actorUserId: destino.id,
        action: "suporte.pedido.resgatado",
        entityType: "order",
        entityId: order.publicToken,
        metadata: {
          de: order.user?.email ?? null,
          para: emailCerto,
          motivo: "e-mail digitado errado no checkout (conta-fantasma)",
        },
      },
    });
  });

  console.log("\n✅ RESGATADO. O ingresso já aparece na carteira de " + emailCerto);
  console.log("   (peça pro comprador puxar a tela / entrar de novo).");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
