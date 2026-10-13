/**
 * LGPD — CONTAS APAGADAS ANTES DE 2026-10-12.
 *
 * Até esta data, "Excluir conta" só limpava a linha da conta (nome, e-mail,
 * telefone, CPF, senha) e o CPF dos pedidos. Pedidos (nome, e-mail, telefone),
 * ingressos de evento já encerrado, metadata de pagamento, IP do aceite,
 * fidelidade, mensagens, VIP, convites e auditoria continuavam identificando a
 * pessoa. A exclusão de hoje faz tudo isso (`anonimizarConta`, em
 * src/me/me.service.ts) — este script aplica a MESMA função às contas que já
 * tinham sido apagadas pelo código antigo.
 *
 * QUEM ENTRA: conta com o e-mail no formato antigo da exclusão,
 * `apagado-<8 primeiros caracteres do id>@anon.borafest.invalid`. A exclusão
 * de hoje grava o id inteiro — então a conta tratada aqui sai do formato
 * antigo e não entra de novo: rodar duas vezes não refaz nada (idempotente).
 *
 * O E-MAIL ORIGINAL JÁ NÃO ESTÁ NA CONTA. Sem ele, os pedidos da conta e os
 * ingressos recebidos são anonimizados (são achados pelo id), mas os pedidos
 * feitos SEM login, a fidelidade, as mensagens, o VIP e os convites são
 * achados pelo e-mail. O script recupera o endereço só de fontes que provam
 * que ele era o da conta:
 *   - pedido que CRIOU a conta (account_created_by_order): a conta nasceu com
 *     o e-mail digitado nele;
 *   - código de acesso por e-mail confirmado nesta conta (otp_challenges com
 *     user_id): o código só entra na conta daquele e-mail.
 * Endereço que HOJE é de outra conta (a pessoa voltou e se cadastrou de novo)
 * fica de fora: os pedidos sem login com ele são da conta nova. E-mail
 * sintético (porta, lista) também fica de fora. Telefone não se recupera — o
 * dos pedidos sai junto com eles.
 *
 * Cada conta vai numa transação própria, com a linha travada (FOR UPDATE),
 * como na exclusão: uma conta que falhar não desfaz as outras, e o script
 * termina com erro dizendo quantas falharam. Cada conta tratada ganha um
 * registro na auditoria (`account.delete.backfill`), sem dado pessoal.
 *
 * Uso (no container da api, com o DATABASE_URL de produção já definido):
 *   cd apps/api && npx tsx scripts/lgpd-contas-apagadas-antes.ts            (só conta)
 *   cd apps/api && npx tsx scripts/lgpd-contas-apagadas-antes.ts --aplicar
 * Faça o backup do banco antes do --aplicar: anonimizar não tem volta.
 */
import { Prisma, prisma } from "@borafest/database";
import { semEmailReal } from "@borafest/contracts";
import { anonimizarConta, type ResumoDaAnonimizacao } from "../src/me/me.service";
import { DOMINIO_ANONIMO } from "../src/me/exclusao-de-conta";

/** E-mail que a exclusão ANTIGA gravava na conta (só os 8 primeiros do id). */
function emailDoFormatoAntigo(userId: string): string {
  return `apagado-${userId.slice(0, 8)}@${DOMINIO_ANONIMO}`;
}

/** Endereço recuperado que pode ser usado: e-mail de verdade, não anônimo nem sintético. */
function enderecoAproveitavel(email: string | null | undefined): email is string {
  if (!email) return false;
  const limpo = email.trim().toLowerCase();
  if (!limpo.includes("@")) return false;
  if (limpo.endsWith(`@${DOMINIO_ANONIMO}`)) return false;
  return !semEmailReal(limpo);
}

/**
 * E-mails que comprovadamente eram desta conta (ver o cabeçalho), menos os
 * que hoje pertencem a outra conta. Minúsculos e sem repetição.
 */
async function enderecosDaContaApagada(
  // o cliente de fora da transação também serve (é o que a contagem usa)
  db: Prisma.TransactionClient,
  userId: string,
): Promise<{ enderecos: string[]; deOutraConta: number }> {
  const linhas = await db.$queryRaw<Array<{ email: string | null }>>`
    SELECT LOWER(TRIM(contact_email)) AS email
    FROM orders
    WHERE user_id = ${userId}::uuid AND account_created_by_order = TRUE
    UNION
    SELECT LOWER(TRIM(destination)) AS email
    FROM otp_challenges
    WHERE user_id = ${userId}::uuid AND channel = 'EMAIL'
  `;
  const candidatos = [...new Set(linhas.map((l) => l.email).filter(enderecoAproveitavel))];
  if (candidatos.length === 0) return { enderecos: [], deOutraConta: 0 };

  // comparação exata em minúsculo — nada de ILIKE (o "_" do e-mail casaria
  // com qualquer letra e pegaria a conta de outra pessoa)
  const ocupados = await db.$queryRaw<Array<{ email: string }>>`
    SELECT LOWER(email) AS email
    FROM users
    WHERE id <> ${userId}::uuid AND LOWER(email) IN (${Prisma.join(candidatos)})
  `;
  const deOutra = new Set(ocupados.map((o) => o.email));
  return {
    enderecos: candidatos.filter((email) => !deOutra.has(email)),
    deOutraConta: candidatos.filter((email) => deOutra.has(email)).length,
  };
}

type Resultado =
  | { situacao: "tratada"; enderecos: number; deOutraConta: number; rodadas: ResumoDaAnonimizacao[] }
  | { situacao: "pulada" };

/** Uma conta, numa transação: trava, confere o formato antigo, anonimiza e registra. */
async function tratarConta(userId: string): Promise<Resultado> {
  return prisma.$transaction(
    async (tx) => {
      const [conta] = await tx.$queryRaw<Array<{ email: string | null; emailVerificado: boolean }>>`
        SELECT email, (email_verified_at IS NOT NULL) AS "emailVerificado"
        FROM users WHERE id = ${userId}::uuid FOR UPDATE
      `;
      // outra execução (ou uma exclusão nova) chegou antes: nada a fazer
      if (!conta || conta.email !== emailDoFormatoAntigo(userId)) return { situacao: "pulada" as const };

      const { enderecos, deOutraConta } = await enderecosDaContaApagada(tx, userId);
      const agora = new Date();
      const rodadas: ResumoDaAnonimizacao[] = [];
      // um endereço por rodada (quase sempre um só); sem endereço, uma rodada
      // pelo id — a conta, os pedidos dela e os ingressos que recebeu
      for (const email of enderecos.length > 0 ? enderecos : [null]) {
        // e-mail recuperado só liga o que não tem dono se a conta tinha
        // provado o e-mail (mesma regra da exclusão, revisão 2026-10-13)
        rodadas.push(
          await anonimizarConta(tx, userId, { email, phone: null, emailVerificado: conta.emailVerificado }, agora),
        );
      }

      await tx.auditLog.create({
        data: {
          actorUserId: null,
          action: "account.delete.backfill",
          entityType: "user",
          entityId: userId,
          metadata: {
            motivo: "conta apagada antes de 2026-10-12: anonimização completa aplicada depois",
            enderecosRecuperados: enderecos.length,
            enderecosDeOutraConta: deOutraConta,
            rodadas,
          } as Prisma.InputJsonValue,
        },
      });
      return { situacao: "tratada" as const, enderecos: enderecos.length, deOutraConta, rodadas };
    },
    // mesmo fôlego da exclusão: muitas tabelas numa transação só
    { timeout: 30_000, maxWait: 10_000 },
  );
}

async function main() {
  const aplicar = process.argv.includes("--aplicar");

  const candidatas = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id
    FROM users
    WHERE email = 'apagado-' || LEFT(id::text, 8) || '@' || ${DOMINIO_ANONIMO}::text
    ORDER BY id
  `;
  const [{ jaCompletas, formatoDesconhecido }] = await prisma.$queryRaw<
    Array<{ jaCompletas: number; formatoDesconhecido: number }>
  >`
    SELECT
      COUNT(*) FILTER (WHERE email = 'apagado-' || id::text || '@' || ${DOMINIO_ANONIMO}::text)::int AS "jaCompletas",
      COUNT(*) FILTER (
        WHERE email <> 'apagado-' || id::text || '@' || ${DOMINIO_ANONIMO}::text
          AND email <> 'apagado-' || LEFT(id::text, 8) || '@' || ${DOMINIO_ANONIMO}::text
      )::int AS "formatoDesconhecido"
    FROM users
    WHERE email LIKE 'apagado-%@' || ${DOMINIO_ANONIMO}::text
  `;

  console.log(`${aplicar ? "APLICANDO" : "SÓ CONTANDO (nada é gravado)"} — contas apagadas antes de 2026-10-12`);
  console.log(`  no formato antigo (a tratar): ${candidatas.length}`);
  console.log(`  já anonimizadas pela exclusão nova: ${jaCompletas}`);
  if (formatoDesconhecido > 0) {
    console.log(`  ATENÇÃO: ${formatoDesconhecido} conta(s) com "apagado-...@${DOMINIO_ANONIMO}" fora dos dois formatos — não tocadas, confira à mão`);
  }

  if (!aplicar) {
    let comEndereco = 0;
    let enderecos = 0;
    let deOutraConta = 0;
    for (const { id } of candidatas) {
      const achados = await enderecosDaContaApagada(prisma, id);
      if (achados.enderecos.length > 0) comEndereco += 1;
      enderecos += achados.enderecos.length;
      deOutraConta += achados.deOutraConta;
    }
    console.log(`  com e-mail original recuperado: ${comEndereco} (${enderecos} endereço(s))`);
    console.log(`  endereços que hoje são de outra conta (ficariam de fora): ${deOutraConta}`);
    console.log(`  sem e-mail recuperado (só a conta, os pedidos dela e os ingressos recebidos): ${candidatas.length - comEndereco}`);
    console.log("\nrode com --aplicar para gravar (faça o backup antes)");
    await prisma.$disconnect();
    return;
  }

  let tratadas = 0;
  let puladas = 0;
  let pedidos = 0;
  let ingressos = 0;
  let enderecos = 0;
  let deOutraConta = 0;
  const falhas: Array<{ id: string; erro: string }> = [];
  for (const { id } of candidatas) {
    try {
      const r = await tratarConta(id);
      if (r.situacao === "pulada") {
        puladas += 1;
        continue;
      }
      tratadas += 1;
      enderecos += r.enderecos;
      deOutraConta += r.deOutraConta;
      // a 1ª rodada já traz todos os pedidos da conta; as seguintes só somam
      // os feitos sem login com outro endereço — o maior número é o honesto
      pedidos += Math.max(...r.rodadas.map((x) => x.pedidos));
      ingressos += Math.max(...r.rodadas.map((x) => x.ingressosAnonimizados));
    } catch (error) {
      falhas.push({ id, erro: (error as Error).message });
    }
  }

  console.log(`  tratadas: ${tratadas}`);
  console.log(`  puladas (já tratadas por outra execução): ${puladas}`);
  console.log(`  endereços recuperados e usados: ${enderecos} · de outra conta (fora): ${deOutraConta}`);
  console.log(`  pedidos anonimizados (pelo menos): ${pedidos} · ingressos de evento encerrado: ${ingressos}`);
  if (falhas.length > 0) {
    console.error(`\nFALHARAM ${falhas.length} conta(s) — nada delas foi gravado; rode de novo depois de ver o motivo:`);
    for (const f of falhas) console.error(`  ${f.id}: ${f.erro}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
