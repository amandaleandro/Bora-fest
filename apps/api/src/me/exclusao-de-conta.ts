import type { Prisma } from "@borafest/database";

/**
 * EXCLUSÃO DE CONTA — LGPD (2026-10-12). Regras puras usadas pelo
 * `MeService.deleteAccount` (e testadas sem banco). A exclusão anonimiza: os
 * registros financeiros e de auditoria continuam existindo, mas sem nada que
 * identifique a pessoa.
 */

export const DOMINIO_ANONIMO = "anon.borafest.invalid";

/**
 * E-mail que entra no lugar do real (na conta e nos pedidos dela). Leva o id
 * INTEIRO: até 2026-10-12 eram só os 8 primeiros caracteres, e duas contas com
 * o mesmo começo de id derrubavam a segunda exclusão no índice único do e-mail.
 * O domínio `.invalid` é reservado (RFC 2606): nenhum e-mail sai para ele.
 */
export function emailAnonimoDaConta(userId: string): string {
  return `apagado-${userId}@${DOMINIO_ANONIMO}`;
}

/**
 * Marcador único por linha para colunas de e-mail que não aceitam vazio e têm
 * índice único junto com outra coluna (fidelidade: Casa + e-mail; convite:
 * lote + e-mail). O id da própria linha garante que não colide.
 */
export function emailAnonimoDoRegistro(registroId: string): string {
  return `apagado-${registroId}@${DOMINIO_ANONIMO}`;
}

/** Conta já anonimizada (clique duplo, duas abas): a 2ª exclusão não refaz nada. */
export function contaJaApagada(userId: string, email: string | null): boolean {
  if (!email) return false;
  return email === emailAnonimoDaConta(userId) || email === `apagado-${userId.slice(0, 8)}@${DOMINIO_ANONIMO}`;
}

/** Colunas de nome que não aceitam vazio (participante do pedido, reserva VIP). */
export const NOME_REMOVIDO = "Removido a pedido do titular";

/** Motivo gravado nas mensagens que ainda não tinham saído quando a conta foi excluída. */
export const ENVIO_CANCELADO = "Envio cancelado: a pessoa excluiu a conta";

/** O evento já acabou? Ingresso de evento que ainda vai acontecer continua valendo. */
export function eventoJaTerminou(endsAt: Date, agora: Date): boolean {
  return endsAt.getTime() <= agora.getTime();
}

/**
 * Chaves que carregam dado pessoal em JSON livre: metadata do pagamento, corpo
 * cru do webhook do gateway (Pagar.me manda `customer` com nome, e-mail e
 * documento; Mercado Pago manda `payer`) e metadata da auditoria
 * (`buyerName`, `buyerDocument`, `fromEmail`, `toEmail`, `newEmail`...).
 * Valores financeiros (`amountMismatch`, `chargebackReversal`, centavos,
 * datas, ids) não casam e ficam.
 */
const CHAVE_PESSOAL =
  /(name|nome|mail|cpf|cnpj|document|identification|phone|fone|celular|whatsapp|address|endereco|endereço|billing|holder|payer|customer|recipient|destinat|birth|nascimento)/i;
const CHAVE_IP = /^(ip|remote_?ip|client_?ip|ip_?address)$/i;
const PARECE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Cópia do JSON sem dado pessoal: tira as chaves pessoais (em qualquer nível) e
 * troca por null qualquer texto que seja um e-mail (ex.: `de`/`para` da
 * auditoria "este pedido é meu"). Não altera o original.
 */
export function semDadoPessoal(valor: Prisma.JsonValue): Prisma.JsonValue {
  if (Array.isArray(valor)) return valor.map((item) => semDadoPessoal(item as Prisma.JsonValue));
  if (valor !== null && typeof valor === "object") {
    const limpo: Prisma.JsonObject = {};
    for (const [chave, item] of Object.entries(valor)) {
      if (CHAVE_PESSOAL.test(chave) || CHAVE_IP.test(chave)) continue;
      limpo[chave] = semDadoPessoal(item as Prisma.JsonValue);
    }
    return limpo;
  }
  if (typeof valor === "string" && PARECE_EMAIL.test(valor.trim())) return null;
  return valor;
}

/** A limpeza mudou alguma coisa? (só grava a linha quando precisa) */
export function mudou(antes: Prisma.JsonValue, depois: Prisma.JsonValue): boolean {
  return JSON.stringify(antes) !== JSON.stringify(depois);
}
