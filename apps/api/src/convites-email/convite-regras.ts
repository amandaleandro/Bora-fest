import { randomBytes } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { prisma, type Prisma } from "@borafest/database";
import { normalizarEmailDeConvite, type SituacaoConviteEmail } from "@borafest/contracts";

/**
 * CONVITE POR E-MAIL (2026-10-12) — as regras que mais de um lugar usa, num
 * lugar só: a vitrine (catalog), a reserva, o pedido, o cancelamento grátis e
 * a tela do produtor leem daqui. Regra de acesso duplicada é questão de tempo
 * até uma metade mudar sozinha (lição do origem-gratis.ts).
 *
 * A REGRA DE OURO: o convite vale enquanto não houver um pedido VIVO com ele.
 *  - SENT: vale.
 *  - CLAIMED: alguém pegou. Se esse pedido acabou sem ingresso (Pix que expirou,
 *    pedido cancelado, reembolsado), o convite volta a valer sozinho — sem
 *    depender de cada caminho que encerra pedido lembrar de devolvê-lo.
 *  - REVOKED: o produtor tirou; não vale.
 */

/** Pedido que terminou sem ingresso valendo: o convite usado nele volta a valer. */
export const PEDIDO_SEM_INGRESSO = ["EXPIRED", "CANCELED", "REFUNDED"] as const;

/** Pedido que ainda está esperando o pagamento (lote EMAIL pago). */
const PEDIDO_PAGANDO = ["CREATED", "PAYMENT_PENDING"] as const;

/** Mesmo formato que o site aceita no ?convite= (apps/checkout/lib/attribution.ts). */
const FORMATO_DO_CODIGO = /^[A-Za-z0-9_-]{8,80}$/;

/** Código do link pessoal: 128 bits aleatórios, seguro para URL (como o do lote LINK). */
export function novoCodigoDoConvite(): string {
  return randomBytes(16).toString("base64url");
}

export function codigoComFormatoValido(codigo: string | null | undefined): codigo is string {
  return typeof codigo === "string" && FORMATO_DO_CODIGO.test(codigo);
}

type Db = Pick<typeof prisma, "order">;

/** O convite ainda dá para usar? (regra de ouro acima) */
export async function conviteEstaLivre(
  convite: { status: string; orderId: string | null },
  db: Db = prisma,
): Promise<boolean> {
  if (convite.status === "SENT") return true;
  if (convite.status !== "CLAIMED") return false;
  if (!convite.orderId) return true;
  const pedido = await db.order.findUnique({ where: { id: convite.orderId }, select: { status: true } });
  return !pedido || (PEDIDO_SEM_INGRESSO as readonly string[]).includes(pedido.status);
}

export interface ConvitePeloCodigo {
  id: string;
  ticketLotId: string;
  email: string;
  status: "SENT" | "CLAIMED" | "REVOKED";
  orderId: string | null;
  livre: boolean;
}

/** Convite do código do link (?convite=), com a resposta "ainda vale?". null = não existe. */
export async function convitePeloCodigo(codigo: string | null | undefined): Promise<ConvitePeloCodigo | null> {
  if (!codigoComFormatoValido(codigo)) return null;
  const convite = await prisma.lotEmailInvite.findUnique({
    where: { token: codigo },
    select: { id: true, ticketLotId: true, email: true, status: true, orderId: true },
  });
  if (!convite) return null;
  return { ...convite, livre: await conviteEstaLivre(convite) };
}

/**
 * Lote EMAIL que este código libera na vitrine e na reserva — só com convite
 * ainda livre. null = o código não abre lote de convite por e-mail.
 */
export async function loteLiberadoPeloConvite(codigo: string | null | undefined): Promise<string | null> {
  const convite = await convitePeloCodigo(codigo);
  return convite?.livre ? convite.ticketLotId : null;
}

/** Recusa da reserva para lote EMAIL; null = pode reservar. */
export function motivoDaReservaRecusada(
  lotId: string,
  convite: ConvitePeloCodigo | null,
): string | null {
  if (!convite || convite.ticketLotId !== lotId) {
    return "Este ingresso é só para quem foi convidado por e-mail. Abra o link que chegou no seu e-mail.";
  }
  if (convite.livre) return null;
  return convite.status === "REVOKED"
    ? "Este convite foi cancelado pela produção do evento."
    : "Este convite já foi usado — o ingresso foi para o e-mail do convite. Procure em Minhas compras.";
}

/** Convite que o pedido vai marcar como usado (com o estado lido, para a troca atômica). */
export interface ConviteParaPegar {
  id: string;
  status: "SENT" | "CLAIMED";
  orderId: string | null;
}

/**
 * PEDIDO DE LOTE EMAIL: o e-mail do pedido tem que ser o do convite. Confere
 * antes da transação (recusa rápida, com mensagem clara) e devolve os
 * convites que `marcarConvitesComoUsados` vai trocar lá dentro.
 *
 * Conectado com OUTRA conta não pega: o pedido iria para a carteira de quem
 * está logado, e qualquer um com o link (que mostra o e-mail do convite)
 * levaria o ingresso de outra pessoa. Sem login, a conta do e-mail do convite
 * só abre o ingresso depois de provar o e-mail (código ou link de acesso).
 */
export async function convitesParaOPedido(
  lotIds: string[],
  contactEmail: string | null | undefined,
  userId: string | undefined,
): Promise<ConviteParaPegar[]> {
  if (lotIds.length === 0) return [];
  const lotesDeConvite = await prisma.ticketLot.findMany({
    where: { id: { in: lotIds }, inviteMode: "EMAIL" },
    select: { id: true },
  });
  if (lotesDeConvite.length === 0) return [];

  const email = normalizarEmailDeConvite(contactEmail ?? "");
  const convites = email
    ? await prisma.lotEmailInvite.findMany({
        where: { ticketLotId: { in: lotesDeConvite.map((l) => l.id) }, email },
        select: { id: true, ticketLotId: true, status: true, orderId: true },
      })
    : [];

  const paraPegar: ConviteParaPegar[] = [];
  for (const { id: lotId } of lotesDeConvite) {
    const convite = convites.find((c) => c.ticketLotId === lotId);
    if (!convite) {
      throw new BadRequestException(
        "Este ingresso é só para quem foi convidado por e-mail. Use o mesmo e-mail que recebeu o convite.",
      );
    }
    if (convite.status === "REVOKED") {
      throw new BadRequestException("Este convite foi cancelado pela produção do evento.");
    }
    if (!(await conviteEstaLivre(convite))) {
      throw new BadRequestException(
        "Este convite já foi usado — o ingresso foi para este e-mail. Procure em Minhas compras.",
      );
    }
    paraPegar.push({ id: convite.id, status: convite.status as "SENT" | "CLAIMED", orderId: convite.orderId });
  }

  if (userId) {
    const conta = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (normalizarEmailDeConvite(conta?.email ?? "") !== email) {
      throw new BadRequestException(
        `Este convite é de ${email} e você entrou com outra conta. Saia da conta (ou entre com ${email}) para pegar o ingresso.`,
      );
    }
  }
  return paraPegar;
}

/**
 * Marca os convites como usados por este pedido, DENTRO da transação do
 * pedido. A troca só acontece se o convite ainda estiver como foi lido: dois
 * pedidos com o mesmo convite chegam juntos, um troca e o outro recebe count 0
 * — e o throw desfaz o pedido inteiro (estoque, cupom, reserva).
 */
export async function marcarConvitesComoUsados(
  tx: Prisma.TransactionClient,
  convites: ConviteParaPegar[],
  orderId: string,
): Promise<void> {
  for (const convite of convites) {
    const trocou = await tx.lotEmailInvite.updateMany({
      where:
        convite.status === "SENT"
          ? { id: convite.id, status: "SENT" }
          : { id: convite.id, status: "CLAIMED", orderId: convite.orderId },
      data: { status: "CLAIMED", orderId, claimedAt: new Date() },
    });
    if (trocou.count === 0) {
      throw new BadRequestException(
        "Este convite acabou de ser usado em outro pedido. Confira seu e-mail: o ingresso pode já estar com você.",
      );
    }
  }
}

/**
 * Situação de cada convite para o produtor (tela de convites). A notificação é
 * a do último e-mail mandado; entregue/voltou chegam pelo webhook do Resend.
 */
export function situacaoDoConvite(
  convite: { status: string },
  pedido: { status: string } | null,
  notificacao: {
    status: string;
    deliveredAt: Date | null;
    bouncedAt: Date | null;
    /** último evento do Resend (webhooks-email/eventos-resend.ts) */
    deliveryEvent?: string | null;
  } | null,
): SituacaoConviteEmail {
  if (convite.status === "REVOKED") return "REVOGADO";
  if (convite.status === "CLAIMED" && pedido && !(PEDIDO_SEM_INGRESSO as readonly string[]).includes(pedido.status)) {
    return (PEDIDO_PAGANDO as readonly string[]).includes(pedido.status) ? "PAGANDO" : "PEGOU";
  }
  // devolvido, ou bloqueado porque o endereço já tinha devolvido antes: não chegou
  if (
    notificacao?.bouncedAt ||
    notificacao?.deliveryEvent === "email.bounced" ||
    notificacao?.deliveryEvent === "email.suppressed"
  ) {
    return "VOLTOU";
  }
  if (notificacao?.status === "FAILED" || notificacao?.deliveryEvent === "email.failed") return "NAO_SAIU";
  if (notificacao?.deliveredAt) return "ENTREGUE";
  return "ENVIADO";
}

/** "sexta, 17/10, 23h" no fuso do evento (texto do e-mail); null se o fuso for inválido. */
export function quandoDoEvento(inicio: Date, fuso: string): string | null {
  try {
    const partes = new Intl.DateTimeFormat("pt-BR", {
      timeZone: fuso,
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(inicio);
    const parte = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? "";
    const dia = parte("weekday").replace(/-feira$/, "");
    const hora = String(Number(parte("hour")));
    const minuto = parte("minute");
    if (!dia || !parte("day") || !parte("month") || hora === "NaN") return null;
    return `${dia}, ${parte("day")}/${parte("month")}, ${hora}h${minuto && minuto !== "00" ? minuto : ""}`;
  } catch {
    return null;
  }
}

/** Link pessoal do convite: <site>/<slug>?convite=<código>. */
export function urlDoConvite(slug: string, codigo: string): string {
  const base = (
    process.env.WEB_BASE_URL ??
    (process.env.NODE_ENV === "production" ? "https://borafest.com.br" : "http://localhost:3000")
  ).replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(slug)}?convite=${encodeURIComponent(codigo)}`;
}
