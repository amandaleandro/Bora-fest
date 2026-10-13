import { Prisma } from "@prisma/client";
import type { DbClient } from "./inventory-ops";

/**
 * ANONIMIZAÇÃO DE CONTA EXCLUÍDA — regra compartilhada (LGPD, 2026-10-12).
 *
 * A exclusão de conta (`MeService.deleteAccount`, na API) anonimiza na hora o
 * que é de evento que JÁ TERMINOU; ingresso, participante, reserva VIP e
 * convite por e-mail de evento que ainda vai acontecer seguem valendo (com
 * nome e CPF na portaria). Quando esse evento termina, o worker
 * (`anonimizar-contas-apagadas`) faz o resto. Os dois gravam pelas funções
 * abaixo — os mesmos campos, os mesmos valores.
 *
 * As constantes e as regras puras (e-mail anônimo, "evento já terminou",
 * tirar dado pessoal de JSON) são IGUAIS às de
 * `apps/api/src/me/exclusao-de-conta.ts`, que o `deleteAccount` usa. O teste
 * `apps/worker/src/__tests__/anonimizar-contas-apagadas.test.ts` compara as
 * duas; mudou uma, mude a outra.
 */

export const DOMINIO_ANONIMO = "anon.borafest.invalid";

/** Colunas de nome que não aceitam vazio (participante do pedido, reserva VIP). */
export const NOME_REMOVIDO = "Removido a pedido do titular";

/** Motivo gravado nas mensagens que não saíram porque a conta foi excluída. */
export const ENVIO_CANCELADO = "Envio cancelado: a pessoa excluiu a conta";

/** E-mail que entra no lugar do real, na conta e nos pedidos dela (id INTEIRO). */
export function emailAnonimoDaConta(userId: string): string {
  return `apagado-${userId}@${DOMINIO_ANONIMO}`;
}

/** Marcador único por linha para colunas de e-mail com índice único (convite, fidelidade). */
export function emailAnonimoDoRegistro(registroId: string): string {
  return `apagado-${registroId}@${DOMINIO_ANONIMO}`;
}

/**
 * Endereço de conta apagada (ou de linha anonimizada)? Domínio `.invalid` é
 * reservado (RFC 2606): nenhum e-mail chega lá — mandar é bounce garantido.
 */
export function ehEmailAnonimo(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(`@${DOMINIO_ANONIMO}`);
}

/** O evento já acabou? Ingresso de evento que ainda vai acontecer continua valendo. */
export function eventoJaTerminou(endsAt: Date, agora: Date): boolean {
  return endsAt.getTime() <= agora.getTime();
}

/**
 * Chaves que carregam dado pessoal em JSON livre (metadata de pagamento e de
 * auditoria, corpo de aviso do gateway). Valores financeiros, datas e ids não
 * casam e ficam.
 */
const CHAVE_PESSOAL =
  /(name|nome|mail|cpf|cnpj|document|identification|phone|fone|celular|whatsapp|address|endereco|endereço|billing|holder|payer|customer|recipient|destinat|birth|nascimento)/i;
const CHAVE_IP = /^(ip|remote_?ip|client_?ip|ip_?address)$/i;
const PARECE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Cópia do JSON sem dado pessoal: tira as chaves pessoais (em qualquer nível) e
 * troca por null qualquer texto que seja um e-mail. Não altera o original.
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

// ---------------------------------------------------------------------------
// O que sai de cada registro quando o evento JÁ TERMINOU (exclusão e worker)
// ---------------------------------------------------------------------------

/** Ingresso: some nome, e-mail e CPF de quem entra; código, situação e check-in ficam. */
export async function apagarDadosDosIngressos(db: DbClient, ingressoIds: string[]): Promise<number> {
  if (ingressoIds.length === 0) return 0;
  const { count } = await db.ticket.updateMany({
    where: { id: { in: ingressoIds } },
    data: { attendeeName: null, attendeeEmail: null, attendeeCpf: null },
  });
  return count;
}

/** Participantes dos pedidos (nome e CPF por ingresso nominal): o nome vira o aviso. */
export async function apagarParticipantesDosPedidos(db: DbClient, pedidoIds: string[]): Promise<number> {
  if (pedidoIds.length === 0) return 0;
  const { count } = await db.orderAttendee.updateMany({
    where: { orderId: { in: pedidoIds } },
    data: { name: NOME_REMOVIDO, cpf: null },
  });
  return count;
}

/** Quem é a pessoa: pelos e-mails dela (exclusão) ou pelos ids já achados (worker). */
type Alvo = { emails: string[] } | { ids: string[] };

/**
 * Reserva VIP de evento que JÁ TERMINOU: sai nome, e-mail, telefone e o
 * recado; valores e situação (registro da Casa) ficam. O e-mail vira o
 * anônimo da conta.
 */
export async function apagarReservasVipDeEventoEncerrado(
  db: DbClient,
  alvo: Alvo & { emailAnonimo: string; agora: Date },
): Promise<number> {
  const quem = "emails" in alvo ? alvo.emails : alvo.ids;
  if (quem.length === 0) return 0;
  const { count } = await db.vipReservation.updateMany({
    where: {
      ...("emails" in alvo ? { contactEmail: { in: alvo.emails } } : { id: { in: alvo.ids } }),
      inventory: { event: { endsAt: { lte: alvo.agora } } },
    },
    data: { contactName: NOME_REMOVIDO, contactEmail: alvo.emailAnonimo, contactPhone: "", customerNote: null },
  });
  return count;
}

/**
 * Convite por e-mail de evento que JÁ TERMINOU: o e-mail vira um marcador
 * único por convite (índice único lote + e-mail). Devolve os ids mexidos — a
 * auditoria deles também é limpa.
 */
export async function apagarEmailDosConvitesDeEventoEncerrado(
  db: DbClient,
  alvo: Alvo & { agora: Date },
): Promise<string[]> {
  const quem = "emails" in alvo ? alvo.emails : alvo.ids;
  if (quem.length === 0) return [];
  const convites = await db.lotEmailInvite.findMany({
    where: {
      ...("emails" in alvo ? { email: { in: alvo.emails } } : { id: { in: alvo.ids } }),
      ticketLot: { ticketType: { event: { endsAt: { lte: alvo.agora } } } },
    },
    select: { id: true },
  });
  for (const convite of convites) {
    await db.lotEmailInvite.update({
      where: { id: convite.id },
      data: { email: emailAnonimoDoRegistro(convite.id) },
    });
  }
  return convites.map((convite) => convite.id);
}

/**
 * Auditoria ligada à pessoa: o registro fica, sem nome, e-mail e documento no
 * metadata. Devolve quantas linhas mudaram.
 */
export async function limparDadoPessoalDaAuditoria(db: DbClient, where: Prisma.AuditLogWhereInput): Promise<number> {
  const auditorias = await db.auditLog.findMany({ where, select: { id: true, metadata: true } });
  let mudadas = 0;
  for (const auditoria of auditorias) {
    if (auditoria.metadata === null) continue;
    const limpo = semDadoPessoal(auditoria.metadata);
    if (!mudou(auditoria.metadata, limpo)) continue;
    await db.auditLog.update({
      where: { id: auditoria.id },
      data: { metadata: limpo === null ? Prisma.DbNull : (limpo as Prisma.InputJsonValue) },
    });
    mudadas++;
  }
  return mudadas;
}
