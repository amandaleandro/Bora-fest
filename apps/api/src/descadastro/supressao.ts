import { Prisma, prisma } from "@borafest/database";
import { chaveDoEmail } from "./descadastro-token";

type Banco = typeof prisma | Prisma.TransactionClient;

/** Templates de e-mail que são CAMPANHA (o descadastro da Casa vale para eles). */
export const TEMPLATES_DE_CAMPANHA = new Set(["crm_reactivation"]);

/** Erro gravado na fila quando a pessoa sai antes de o e-mail da campanha sair. */
export const ERRO_DESCADASTRADO = "Não enviado: a pessoa pediu para não receber campanhas desta Casa";

const LOTE = 1000;

/**
 * Quais destes e-mails saíram das campanhas DESTA Casa (LGPD, 2026-10-12).
 * Devolve as chaves normalizadas (minúsculo, sem espaços). Consulta em lotes
 * para não estourar o limite de parâmetros do Postgres em público grande.
 */
export async function emailsDescadastrados(
  db: Banco,
  organizationId: string,
  emails: Iterable<string>,
): Promise<Set<string>> {
  const chaves = [...new Set([...emails].map(chaveDoEmail).filter((chave) => chave.length > 0))];
  const saiu = new Set<string>();
  for (let i = 0; i < chaves.length; i += LOTE) {
    const linhas = await db.marketingOptOut.findMany({
      where: { organizationId, emailKey: { in: chaves.slice(i, i + LOTE) } },
      select: { emailKey: true },
    });
    for (const linha of linhas) saiu.add(linha.emailKey);
  }
  return saiu;
}

/**
 * Grava o "não quero mais receber" da Casa e tira da fila os e-mails de
 * campanha dela que ainda não saíram para esta pessoa — tudo na mesma
 * transação. Repetir (clique duplo, um clique do Gmail + botão do site) não
 * duplica nada: a linha é única por Casa + e-mail.
 */
export async function registrarDescadastroDeCampanha(
  organizationId: string,
  email: string,
): Promise<{ jaTinhaSaido: boolean; tiradosDaFila: number }> {
  const emailKey = chaveDoEmail(email);
  return prisma.$transaction(async (tx) => {
    const criado = await tx.marketingOptOut.createMany({
      data: [{ organizationId, emailKey }],
      skipDuplicates: true,
    });
    // comparação exata por LOWER(TRIM()) — o filtro "insensitive" do Prisma
    // vira ILIKE, e um "_" no e-mail casaria com o endereço de outra pessoa
    const tiradosDaFila = await tx.$executeRaw`
      UPDATE notifications
      SET status = 'FAILED', error = ${ERRO_DESCADASTRADO}
      WHERE status = 'PENDING'
        AND channel = 'EMAIL'
        AND template IN (${Prisma.join([...TEMPLATES_DE_CAMPANHA])})
        AND LOWER(TRIM(recipient)) = ${emailKey}
        AND payload->>'organizationId' = ${organizationId}
    `;
    return { jaTinhaSaido: criado.count === 0, tiradosDaFila };
  });
}
