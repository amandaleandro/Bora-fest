import { ehEmailAnonimo, prisma } from "@borafest/database";
import { escapeHtml, getEmailSender } from "@borafest/notifications";
import { semEmailReal } from "@borafest/contracts";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "abandoned-cart" });

// tempo parado no pedido antes de considerar "abandonado" o suficiente pra
// lembrar. 15 min numa janela de pagamento de 30 (correção 2026-08-30): o
// default antigo era 20 min numa janela de 15 — conjunto VAZIO, o lembrete
// nunca disparou uma única vez em produção.
const ABANDONED_AFTER_MS = Number(process.env.ABANDONED_CART_AFTER_MS ?? 15 * 60_000);

// resgate pós-expiração (decisão do Arthur 2026-08-30): 1h depois de expirar,
// convida a recomeçar pelo hotsite do evento. O teto de idade protege o
// PRIMEIRO deploy: sem ele, todo o histórico de pedidos expirados receberia
// e-mail de uma vez.
const RESCUE_AFTER_MS = Number(process.env.ABANDONED_RESCUE_AFTER_MS ?? 60 * 60_000);
const RESCUE_MAX_AGE_MS = Number(process.env.ABANDONED_RESCUE_MAX_AGE_MS ?? 6 * 60 * 60_000);

/** O que o pedido gravou sobre quem trouxe a venda (vendedor, promoter ou atlética). */
export type AtribuicaoDoPedido = {
  promoterSeller: { slug: string; status: string; promoterLink: { status: string } } | null;
  promoterLink: { slug: string; status: string } | null;
  salesPartner: { slug: string; active: boolean } | null;
};

/**
 * Etiqueta do link de resgate, remontada do PEDIDO (2026-10-11). O site só
 * lembra ?vd=/?pr=/?p= no navegador onde o link original foi aberto; quem lia
 * o e-mail em outro aparelho (comprou no navegador do Instagram, abre no app
 * do Gmail) voltava sem etiqueta e a comissão sumia em silêncio. Mesma
 * prioridade do servidor (orders.service): vendedor > promoter > atlética.
 * Vínculo desativado no meio-tempo cai para o próximo — o servidor também o
 * ignoraria, e o site apaga os outros canais ao capturar um (last-click).
 */
export function etiquetaDoPedido(atribuicao: AtribuicaoDoPedido): { param: "vd" | "pr" | "p"; slug: string } | null {
  const { promoterSeller, promoterLink, salesPartner } = atribuicao;
  if (promoterSeller && promoterSeller.status === "ACTIVE" && promoterSeller.promoterLink.status === "ACTIVE") {
    return { param: "vd", slug: promoterSeller.slug };
  }
  if (promoterLink && promoterLink.status === "ACTIVE") return { param: "pr", slug: promoterLink.slug };
  if (salesPartner && salesPartner.active) return { param: "p", slug: salesPartner.slug };
  return null;
}

/**
 * Link do "Ainda dá tempo" (2026-10-11): direto em /{slug}, a página do evento
 * — /evento/{slug} é só o redirecionamento antigo, um salto a mais no celular.
 */
export function montarLinkDoResgate(webBaseUrl: string, eventSlug: string, atribuicao: AtribuicaoDoPedido): string {
  const pagina = `${webBaseUrl.replace(/\/+$/, "")}/${encodeURIComponent(eventSlug)}`;
  const etiqueta = etiquetaDoPedido(atribuicao);
  return etiqueta ? `${pagina}?${etiqueta.param}=${encodeURIComponent(etiqueta.slug)}` : pagina;
}

/**
 * Lembrete de carrinho abandonado: pedido criado há tempo, ainda sem
 * pagamento, mas dentro da janela (`expiresAt` no futuro — se já venceu,
 * quem cuida é o expire-orders). Um e-mail por pedido, marcado por
 * `abandonedReminderSentAt` pra não repetir.
 */
export async function sendAbandonedCartReminders(): Promise<void> {
  const threshold = new Date(Date.now() - ABANDONED_AFTER_MS);
  const stale = await prisma.order.findMany({
    where: {
      status: { in: ["CREATED", "PAYMENT_PENDING"] },
      createdAt: { lt: threshold },
      expiresAt: { gt: new Date() },
      abandonedReminderSentAt: null,
    },
    select: {
      id: true,
      publicToken: true,
      contactEmail: true,
      contactName: true,
      event: { select: { title: true } },
    },
    take: 100,
  });

  for (const order of stale) {
    try {
      await remindOrder(order);
    } catch (error) {
      log.error({ orderId: order.id, error: (error as Error).message }, "falha ao lembrar carrinho abandonado");
    }
  }
}

async function remindOrder(order: {
  id: string;
  publicToken: string;
  contactEmail: string;
  contactName: string | null;
  event: { title: string };
}): Promise<void> {
  // conta excluída (LGPD, 2026-10-12): o pedido ficou com o e-mail anônimo
  // (.invalid, ninguém recebe) — não manda; marca como tratado para não
  // reavaliar a cada varredura. Idem e-mail sintético (Pix da porta, lista,
  // 2026-10-13): não tem caixa, o envio seria bounce garantido
  if (ehEmailAnonimo(order.contactEmail) || semEmailReal(order.contactEmail)) {
    await prisma.order.update({ where: { id: order.id }, data: { abandonedReminderSentAt: new Date() } });
    log.info({ orderId: order.id }, "lembrete pulado: o pedido não tem e-mail de verdade");
    return;
  }

  const webBaseUrl = process.env.CHECKOUT_BASE_URL ?? process.env.WEB_BASE_URL ?? (process.env.NODE_ENV === "production" ? "https://borafest.com.br" : "http://localhost:3000");
  const link = `${webBaseUrl}/pedido/${order.publicToken}`;
  const saudacao = order.contactName ? `Oi, ${order.contactName}!` : "Oi!";

  // título e nome são texto do produtor/comprador: escapados no HTML (2026-10-13)
  await getEmailSender().send({
    to: order.contactEmail,
    subject: `Seu Pix pra ${order.event.title} expira em breve`,
    html: `<p>${escapeHtml(saudacao)}</p><p>Você começou a comprar ingresso pra <strong>${escapeHtml(order.event.title)}</strong> e o Pix ainda está valendo — mas expira em breve.</p><p><a href="${escapeHtml(link)}">Concluir o pagamento</a></p><p style="color:#666;font-size:12px">Se você já pagou, pode ignorar este e-mail.</p>`,
    text: `${saudacao} Você começou a comprar ingresso pra ${order.event.title} e o Pix ainda está valendo, mas expira em breve. Conclua em: ${link}`,
  });

  // marca ANTES de considerar concluído seria arriscado (falha no meio deixaria
  // pedido sem marca e sem e-mail); marcar DEPOIS do send arrisca reenvio numa
  // corrida rara com o próprio sweep — aceitável pra um lembrete best-effort
  await prisma.order.update({
    where: { id: order.id },
    data: { abandonedReminderSentAt: new Date() },
  });

  log.info({ orderId: order.id }, "lembrete de carrinho abandonado enviado");
}

/**
 * Resgate pós-expiração (toque 2 do funil, 2026-08-30): o pedido morreu, o
 * estoque voltou — o link certo é o HOTSITE do evento, que recomeça o checkout
 * e lida sozinho com lote virado/esgotado. Regras:
 *  - só eventos publicados e que ainda não começaram;
 *  - nunca para quem JÁ COMPROU o mesmo evento em outro pedido (marcamos
 *    rescueReminderSentAt mesmo assim, pra não reavaliar a cada varredura);
 *  - nunca para pedido com lote restrito — link de convidado ou convite por
 *    e-mail (mesma marcação);
 *  - o link leva a etiqueta (?vd=/?pr=/?p=) que o pedido gravou;
 *  - teto de idade (RESCUE_MAX_AGE_MS) segura o backlog no primeiro deploy;
 *  - um e-mail por pedido, via rescueReminderSentAt.
 */
export async function sendExpiredRescueEmails(): Promise<void> {
  const agora = Date.now();
  const expirados = await prisma.order.findMany({
    where: {
      status: "EXPIRED",
      rescueReminderSentAt: null,
      expiresAt: {
        lt: new Date(agora - RESCUE_AFTER_MS),
        gt: new Date(agora - RESCUE_MAX_AGE_MS),
      },
      event: { status: "PUBLISHED", startsAt: { gt: new Date() } },
    },
    select: {
      id: true,
      eventId: true,
      contactEmail: true,
      contactName: true,
      event: { select: { title: true, slug: true } },
      // etiqueta de quem trouxe a venda e lotes do pedido (2026-10-11)
      promoterSeller: { select: { slug: true, status: true, promoterLink: { select: { status: true } } } },
      promoterLink: { select: { slug: true, status: true } },
      salesPartner: { select: { slug: true, active: true } },
      items: { select: { ticketLot: { select: { inviteMode: true } } } },
    },
    take: 100,
  });

  for (const order of expirados) {
    try {
      await resgatarPedido(order);
    } catch (error) {
      log.error({ orderId: order.id, error: (error as Error).message }, "falha no resgate pós-expiração");
    }
  }
}

async function resgatarPedido(
  order: AtribuicaoDoPedido & {
    id: string;
    eventId: string;
    contactEmail: string;
    contactName: string | null;
    event: { title: string; slug: string };
    items: Array<{ ticketLot: { inviteMode: string } }>;
  },
): Promise<void> {
  // LOTE RESTRITO (inviteMode LINK 2026-10-11; EMAIL 2026-10-12): a página só
  // mostra esse lote com o código do convite. Mandar o código ATUAL furaria a
  // troca de link (se o produtor trocou porque vazou, quem tinha o velho
  // receberia o novo); mandar sem código leva o convidado a uma página sem o
  // ingresso dele, com o e-mail prometendo "continuam à venda". No convite por
  // e-mail o link pessoal da pessoa continua valendo (o pedido expirado devolve
  // o convite) — o "Ainda dá tempo" sem ele só confundiria. Qualquer modo que
  // não seja o aberto (NONE) fica de fora, inclusive um que venha a existir:
  // não manda, marca como tratado (não reavalia a cada varredura) e registra.
  if (order.items.some((item) => item.ticketLot.inviteMode !== "NONE")) {
    await prisma.order.update({ where: { id: order.id }, data: { rescueReminderSentAt: new Date() } });
    log.info({ orderId: order.id }, "resgate pulado: pedido tem lote restrito (link ou convite por e-mail)");
    return;
  }

  // conta excluída (LGPD, 2026-10-12) ou e-mail sintético (porta, lista,
  // 2026-10-13): ninguém recebe
  if (ehEmailAnonimo(order.contactEmail) || semEmailReal(order.contactEmail)) {
    await prisma.order.update({ where: { id: order.id }, data: { rescueReminderSentAt: new Date() } });
    log.info({ orderId: order.id }, "resgate pulado: o pedido não tem e-mail de verdade");
    return;
  }

  // já comprou este evento por outro caminho? então nada de "ainda dá tempo"
  const jaComprou = await prisma.order.findFirst({
    where: {
      eventId: order.eventId,
      contactEmail: order.contactEmail,
      status: { in: ["PAID", "FULFILLED", "PARTIALLY_REFUNDED"] },
    },
    select: { id: true },
  });
  if (jaComprou) {
    await prisma.order.update({ where: { id: order.id }, data: { rescueReminderSentAt: new Date() } });
    log.info({ orderId: order.id }, "resgate pulado: comprador já concluiu outro pedido do evento");
    return;
  }

  const webBaseUrl = process.env.CHECKOUT_BASE_URL ?? process.env.WEB_BASE_URL ?? (process.env.NODE_ENV === "production" ? "https://borafest.com.br" : "http://localhost:3000");
  const link = montarLinkDoResgate(webBaseUrl, order.event.slug, order);
  const saudacao = order.contactName ? `Oi, ${order.contactName}!` : "Oi!";

  await getEmailSender().send({
    to: order.contactEmail,
    subject: `Ainda dá tempo: ingressos pra ${order.event.title}`,
    html: `<p>${escapeHtml(saudacao)}</p><p>Seu pedido pra <strong>${escapeHtml(order.event.title)}</strong> expirou, mas os ingressos continuam à venda.</p><p><a href="${escapeHtml(link)}">Garantir meu ingresso</a></p><p style="color:#666;font-size:12px">Se você já garantiu o seu, pode ignorar este e-mail.</p>`,
    text: `${saudacao} Seu pedido pra ${order.event.title} expirou, mas os ingressos continuam à venda: ${link}`,
  });

  await prisma.order.update({ where: { id: order.id }, data: { rescueReminderSentAt: new Date() } });
  log.info({ orderId: order.id, canal: etiquetaDoPedido(order)?.param ?? null }, "resgate pós-expiração enviado");
}
