import { z } from "zod";
import { semEmailReal } from "./email-sintetico";
import { mensagemTypoEmail, temTypoCerto } from "./email-typo";

/**
 * CONVITE POR E-MAIL (2026-10-12) — 3ª forma do ingresso restrito, no formato
 * da Sympla. O produtor cola a lista de e-mails, cada pessoa recebe um link
 * pessoal e só pega o ingresso com o MESMO e-mail do convite.
 */

/** Quantos e-mails por envio: uma lista de festa cabe folgada; mais que isso vai em partes. */
export const LIMITE_CONVITES_POR_ENVIO = 200;

/** Mesma limpeza do e-mail de compra (orders.ts): sem espaços e minúsculo. */
export function normalizarEmailDeConvite(bruto: string): string {
  return bruto.trim().toLowerCase();
}

/**
 * Separa o que o produtor colou: um por linha, mas também aceita vírgula,
 * ponto e vírgula, vários e-mails separados por espaço e o formato
 * "Nome <email>" de quem copia do Gmail. Nada é descartado calado: o que não
 * for e-mail segue para a validação e volta como recusado, com o motivo.
 * (O painel tem uma cópia desta função em convites/page.tsx — mudar as duas.)
 */
export function separarEmailsColados(texto: string): string[] {
  const pedacos: string[] = [];
  for (const linha of texto.split(/[\n\r,;]+/)) {
    const limpa = linha.trim();
    if (!limpa) continue;
    const entreSinais = limpa.match(/<([^>]+)>/);
    if (entreSinais) {
      pedacos.push(entreSinais[1]);
      continue;
    }
    const partes = limpa.split(/\s+/);
    if (partes.length > 1 && partes.every((p) => p.includes("@"))) pedacos.push(...partes);
    else pedacos.push(limpa);
  }
  return pedacos
    .map((p) => normalizarEmailDeConvite(p).replace(/^[("'<]+|[>)"'.]+$/g, ""))
    .filter(Boolean);
}

const formatoDeEmail = z.string().email();

/** null = e-mail bom; senão, o motivo em português para a tela. */
export function motivoEmailDeConviteInvalido(email: string): string | null {
  const limpo = normalizarEmailDeConvite(email);
  if (!limpo || limpo.length > 254 || !formatoDeEmail.safeParse(limpo).success) {
    return "E-mail inválido";
  }
  // endereço que a própria plataforma inventa (porta, lista) não tem caixa
  if (semEmailReal(limpo)) return "E-mail inválido";
  // "@gmail.comm": o convite iria para uma caixa que não existe
  if (temTypoCerto(limpo)) return mensagemTypoEmail(limpo);
  return null;
}

export const criarConvitesEmailSchema = z.object({
  emails: z
    .array(z.string().max(320))
    .min(1, "Cole pelo menos um e-mail")
    .max(LIMITE_CONVITES_POR_ENVIO, `Cole no máximo ${LIMITE_CONVITES_POR_ENVIO} e-mails por vez`),
});
export type CriarConvitesEmailInput = z.infer<typeof criarConvitesEmailSchema>;

export const corrigirConviteEmailSchema = z.object({
  email: z
    .string()
    .max(320)
    .transform(normalizarEmailDeConvite)
    .superRefine((email, ctx) => {
      const motivo = motivoEmailDeConviteInvalido(email);
      if (motivo) ctx.addIssue({ code: z.ZodIssueCode.custom, message: motivo });
    }),
});
export type CorrigirConviteEmailInput = z.infer<typeof corrigirConviteEmailSchema>;

/**
 * Situação de cada convite na tela do produtor. Calculada no servidor a partir
 * do convite, do pedido e da notificação:
 *  - ENVIADO: link valendo, e-mail aceito pelo provedor (ou ainda saindo)
 *  - ENTREGUE: o provedor confirmou que chegou na caixa
 *  - VOLTOU: o e-mail voltou (endereço não existe ou caixa recusou)
 *  - NAO_SAIU: o envio falhou de vez (5 tentativas)
 *  - PAGANDO: pegou num lote pago e o pagamento ainda não caiu
 *  - PEGOU: tem ingresso
 *  - REVOGADO: o produtor revogou; o link não vale
 */
export type SituacaoConviteEmail =
  | "ENVIADO"
  | "ENTREGUE"
  | "VOLTOU"
  | "NAO_SAIU"
  | "PAGANDO"
  | "PEGOU"
  | "REVOGADO";
