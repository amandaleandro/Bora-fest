import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma, Prisma } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import {
  LIMITE_CONVITES_POR_ENVIO,
  motivoEmailDeConviteInvalido,
  normalizarEmailDeConvite,
  type SituacaoConviteEmail,
} from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";
import { motivoForaDaJanela } from "../common/janela-do-lote";
import {
  conviteEstaLivre,
  convitePeloCodigo,
  novoCodigoDoConvite,
  quandoDoEvento,
  situacaoDoConvite,
  urlDoConvite,
} from "./convite-regras";

/** Template do worker (deliver-notifications.ts → renderLotEmailInviteEmail). */
export const TEMPLATE_CONVITE_EMAIL = "lot_email_invite";

/** Reenvio em sequência: clique duplo e "reenviar, reenviar, reenviar" mandam um e-mail só. */
const INTERVALO_ENTRE_ENVIOS_MS = 5 * 60_000;

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O que a tela do produtor precisa do lote (e da festa) para convidar. */
const loteSelect = {
  id: true,
  name: true,
  status: true,
  inviteMode: true,
  priceCents: true,
  capacity: true,
  soldCount: true,
  reservedCount: true,
  startsAt: true,
  endsAt: true,
  ticketType: {
    select: {
      name: true,
      event: {
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          startsAt: true,
          timezone: true,
          organizationId: true,
          organization: { select: { name: true, displayName: true } },
        },
      },
    },
  },
} satisfies Prisma.TicketLotSelect;

type LoteDoConvite = Prisma.TicketLotGetPayload<{ select: typeof loteSelect }>;

const conviteSelect = {
  id: true,
  ticketLotId: true,
  email: true,
  token: true,
  status: true,
  orderId: true,
  notificationId: true,
  sentAt: true,
  createdAt: true,
  claimedAt: true,
} satisfies Prisma.LotEmailInviteSelect;

type ConviteLido = Prisma.LotEmailInviteGetPayload<{ select: typeof conviteSelect }>;

/** Uma linha da tabela do produtor. O código do link NUNCA vai para a tela. */
export interface ConviteNaTela {
  id: string;
  email: string;
  situacao: SituacaoConviteEmail;
  enviadoEm: Date;
  criadoEm: Date;
  pegouEm: Date | null;
  podeReenviar: boolean;
  podeCorrigir: boolean;
  podeRevogar: boolean;
}

export interface ResultadoDoEnvio {
  /** e-mails que receberam convite agora (novos ou reconvidados depois de revogados) */
  enviados: string[];
  /** já tinham convite valendo neste lote: ninguém recebe e-mail repetido */
  jaConvidados: string[];
  invalidos: Array<{ email: string; motivo: string }>;
  /** o mesmo e-mail colado mais de uma vez na lista */
  repetidosNaLista: number;
}

/**
 * Por que não dá para mandar convite agora; null = pode. Cada recusa diz a
 * verdade que importa: um convite cujo link não abre o ingresso é pior que
 * não mandar.
 */
export function motivoParaNaoMandar(lot: LoteDoConvite, agora = Date.now()): string | null {
  if (lot.inviteMode !== "EMAIL") {
    return 'Este lote não é de convite por e-mail. Em "Quem pode pegar", escolha "Só quem eu convidar por e-mail".';
  }
  const evento = lot.ticketType.event;
  if (evento.status === "CANCELED") return "Este evento foi cancelado.";
  if (evento.status === "DRAFT") {
    return "Publique o evento antes de mandar os convites — sem isso, o link do convite não abre.";
  }
  if (evento.status === "SALES_PAUSED") {
    return "As vendas do evento estão pausadas — retome as vendas para mandar os convites.";
  }
  if (evento.status !== "PUBLISHED") return "As vendas deste evento já encerraram.";
  if (lot.status === "DRAFT" || lot.status === "SCHEDULED") {
    return "Ative o lote antes de mandar os convites — sem isso, quem abrir o link não vê o ingresso.";
  }
  if (lot.status !== "ACTIVE") return "Este lote está encerrado — os convites dele não abrem mais o ingresso.";
  const janela = motivoForaDaJanela(lot, agora);
  if (janela) return `${janela} Quem abrir o link do convite fora do período de vendas do lote não vê o ingresso.`;
  return null;
}

/** Uma linha da tabela: situação e o que o produtor pode fazer com ela. */
function linhaDaTela(
  convite: ConviteLido,
  pedido: Parameters<typeof situacaoDoConvite>[1],
  notificacao: Parameters<typeof situacaoDoConvite>[2],
  motivoParaNaoMandarAgora: string | null,
): ConviteNaTela {
  const situacao = situacaoDoConvite(convite, pedido, notificacao);
  const livre = situacao !== "REVOGADO" && situacao !== "PEGOU" && situacao !== "PAGANDO";
  const podeMandar = motivoParaNaoMandarAgora === null;
  return {
    id: convite.id,
    email: convite.email,
    situacao,
    enviadoEm: convite.sentAt,
    criadoEm: convite.createdAt,
    pegouEm: situacao === "PEGOU" || situacao === "PAGANDO" ? convite.claimedAt : null,
    // e-mail que voltou não se reenvia para o mesmo endereço: corrige
    podeReenviar: podeMandar && livre && situacao !== "VOLTOU",
    podeCorrigir: podeMandar && livre,
    podeRevogar: livre,
  };
}

@Injectable()
export class ConvitesEmailService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  // ---------------------------------------------------------------------------
  // Produtor
  // ---------------------------------------------------------------------------

  /** Lotes EMAIL do evento — para escolher qual lote convidar quando a tela abre sem ?lote=. */
  async lotesDoEvento(eventId: string, userId: string) {
    if (!FORMATO_UUID.test(eventId)) throw new NotFoundException("Evento não encontrado");
    const evento = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, organizationId: true },
    });
    if (!evento) throw new NotFoundException("Evento não encontrado");
    await this.orgAccess.assertPermission(evento.organizationId, userId, PERMISSIONS.EVENT_CREATE);

    const lotes = await prisma.ticketLot.findMany({
      where: { ticketType: { eventId }, inviteMode: "EMAIL" },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, status: true, ticketType: { select: { name: true } } },
    });
    const contagem = lotes.length
      ? await prisma.lotEmailInvite.groupBy({
          by: ["ticketLotId"],
          where: { ticketLotId: { in: lotes.map((l) => l.id) }, status: { not: "REVOKED" } },
          _count: { _all: true },
        })
      : [];
    return lotes.map((l) => ({
      id: l.id,
      name: l.name,
      ticketTypeName: l.ticketType.name,
      status: l.status,
      convites: contagem.find((c) => c.ticketLotId === l.id)?._count._all ?? 0,
    }));
  }

  /** Convites do lote com a situação de cada um (enviado, entregue, voltou, pegou, revogado). */
  async listar(lotId: string, userId: string) {
    const lot = await this.loteComPermissao(lotId, userId);
    const convites = await prisma.lotEmailInvite.findMany({
      where: { ticketLotId: lot.id },
      orderBy: { createdAt: "desc" },
      select: conviteSelect,
    });

    const pedidoIds = [...new Set(convites.map((c) => c.orderId).filter((id): id is string => Boolean(id)))];
    const notificacaoIds = [
      ...new Set(convites.map((c) => c.notificationId).filter((id): id is string => Boolean(id))),
    ];
    const [pedidos, notificacoes] = await Promise.all([
      pedidoIds.length
        ? prisma.order.findMany({ where: { id: { in: pedidoIds } }, select: { id: true, status: true } })
        : Promise.resolve([]),
      notificacaoIds.length
        ? prisma.notification.findMany({
            where: { id: { in: notificacaoIds } },
            select: { id: true, status: true, deliveredAt: true, bouncedAt: true, deliveryEvent: true },
          })
        : Promise.resolve([]),
    ]);
    const pedidoPorId = new Map(pedidos.map((p) => [p.id, p]));
    const notificacaoPorId = new Map(notificacoes.map((n) => [n.id, n]));

    const motivo = motivoParaNaoMandar(lot);
    const linhas = convites.map((c) =>
      linhaDaTela(
        c,
        c.orderId ? (pedidoPorId.get(c.orderId) ?? null) : null,
        c.notificationId ? (notificacaoPorId.get(c.notificationId) ?? null) : null,
        motivo,
      ),
    );

    const evento = lot.ticketType.event;
    return {
      lote: {
        id: lot.id,
        name: lot.name,
        ticketTypeName: lot.ticketType.name,
        status: lot.status,
        inviteMode: lot.inviteMode,
        priceCents: lot.priceCents,
        capacity: lot.capacity,
        disponiveis: Math.max(lot.capacity - lot.soldCount - lot.reservedCount, 0),
      },
      evento: { id: evento.id, title: evento.title, slug: evento.slug },
      /** null = dá para mandar; senão, o motivo (a tela mostra e trava o envio) */
      motivoParaNaoMandar: motivo,
      resumo: {
        convidados: linhas.filter((l) => l.situacao !== "REVOGADO").length,
        pegaram: linhas.filter((l) => l.situacao === "PEGOU").length,
        voltaram: linhas.filter((l) => l.situacao === "VOLTOU" || l.situacao === "NAO_SAIU").length,
      },
      convites: linhas,
    };
  }

  /**
   * Convida os e-mails colados. Normaliza, recusa formato inválido e typo certo,
   * ignora repetidos (na lista e no lote), reconvida quem tinha sido revogado
   * (com link NOVO) e manda um e-mail por convite — tudo numa transação: o
   * convite e o e-mail dele nascem juntos ou não nascem.
   */
  async criar(lotId: string, userId: string, emailsColados: string[]): Promise<ResultadoDoEnvio> {
    // o limite também vale aqui, não só no corpo validado pelo controller
    if (emailsColados.length > LIMITE_CONVITES_POR_ENVIO) {
      throw new BadRequestException(`Cole no máximo ${LIMITE_CONVITES_POR_ENVIO} e-mails por vez`);
    }
    const lot = await this.loteComPermissao(lotId, userId);
    const motivo = motivoParaNaoMandar(lot);
    if (motivo) throw new BadRequestException(motivo);

    const invalidos: ResultadoDoEnvio["invalidos"] = [];
    const validos = new Set<string>();
    let repetidosNaLista = 0;
    for (const bruto of emailsColados) {
      const email = normalizarEmailDeConvite(bruto ?? "");
      if (!email) continue;
      const recusa = motivoEmailDeConviteInvalido(email);
      if (recusa) {
        invalidos.push({ email: bruto.trim().slice(0, 120), motivo: recusa });
        continue;
      }
      if (validos.has(email)) {
        repetidosNaLista += 1;
        continue;
      }
      validos.add(email);
    }
    if (validos.size === 0) {
      return { enviados: [], jaConvidados: [], invalidos, repetidosNaLista };
    }

    const existentes = await prisma.lotEmailInvite.findMany({
      where: { ticketLotId: lot.id, email: { in: [...validos] } },
      select: { id: true, email: true, status: true },
    });
    const jaExistem = new Set(existentes.map((e) => e.email));
    // ordem FIXA (e-mail, id): duas chamadas com as mesmas pessoas em ordens
    // diferentes travam as linhas na mesma sequência e nunca esperam uma pela
    // outra em cruz (deadlock)
    const novos = [...validos].filter((e) => !jaExistem.has(e)).sort();
    const revogados = existentes.filter((e) => e.status === "REVOKED").sort((a, b) => (a.id < b.id ? -1 : 1));
    const jaConvidados = existentes.filter((e) => e.status !== "REVOKED").map((e) => e.email);

    const evento = lot.ticketType.event;
    const textoBase = this.textoDoEmail(lot);
    const agora = new Date();

    const enviados = await prisma.$transaction(async (tx) => {
      // NOVOS: código e id da notificação gerados aqui, para gravar a lista
      // inteira em 3 consultas. skipDuplicates + releitura pelos ids: se um
      // clique duplo (ou outra aba) convidou o mesmo e-mail neste instante,
      // ele não ganha convite nem e-mail em dobro — fica com o da outra chamada
      const linhas = novos.map((email) => ({
        id: randomUUID(),
        ticketLotId: lot.id,
        email,
        token: novoCodigoDoConvite(),
        notificationId: randomUUID(),
        sentAt: agora,
      }));
      if (linhas.length) await tx.lotEmailInvite.createMany({ data: linhas, skipDuplicates: true });
      const criados = linhas.length
        ? await tx.lotEmailInvite.findMany({
            where: { id: { in: linhas.map((l) => l.id) } },
            select: { id: true, email: true, token: true, notificationId: true },
          })
        : [];

      // REVOGADO E COLADO DE NOVO: o produtor mudou de ideia. Link novo — o
      // antigo pode ter vazado, e foi por isso que revogaram
      const reconvidados: typeof criados = [];
      for (const r of revogados) {
        const token = novoCodigoDoConvite();
        const notificationId = randomUUID();
        const trocou = await tx.lotEmailInvite.updateMany({
          where: { id: r.id, status: "REVOKED" },
          data: { status: "SENT", token, notificationId, sentAt: agora, orderId: null, claimedAt: null },
        });
        if (trocou.count === 1) reconvidados.push({ id: r.id, email: r.email, token, notificationId });
      }

      const mandar = [...criados, ...reconvidados];
      if (mandar.length === 0) return [];

      await tx.notification.createMany({
        data: mandar.map((c) => ({
          id: c.notificationId!,
          channel: "EMAIL" as const,
          recipient: c.email,
          template: TEMPLATE_CONVITE_EMAIL,
          payload: { ...textoBase, conviteUrl: urlDoConvite(evento.slug, c.token) },
        })),
      });

      // rastro: QUEM convidou, quantos e quais convites (os e-mails ficam no
      // próprio convite; o código do link nunca vai para o histórico)
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          organizationId: evento.organizationId,
          action: "lot_email_invite.create",
          entityType: "ticket_lot",
          entityId: lot.id,
          metadata: {
            eventId: evento.id,
            enviados: criados.length,
            reconvidados: reconvidados.length,
            jaConvidados: jaConvidados.length + (linhas.length - criados.length),
            invalidos: invalidos.length,
            convites: mandar.map((c) => c.id),
          },
        },
      });
      return mandar.map((c) => c.email);
    });

    const enviadosAgora = new Set(enviados);
    return {
      enviados,
      // inclui quem outra chamada convidou no mesmo instante (não recebeu e-mail desta)
      jaConvidados: [...jaConvidados, ...novos.filter((e) => !enviadosAgora.has(e))],
      invalidos,
      repetidosNaLista,
    };
  }

  /** Manda o e-mail do convite de novo, com o MESMO link. */
  async reenviar(conviteId: string, userId: string): Promise<ConviteNaTela> {
    const { convite, lot } = await this.conviteComPermissao(conviteId, userId);
    const motivo = motivoParaNaoMandar(lot);
    if (motivo) throw new BadRequestException(motivo);
    await this.exigirLivre(convite);

    const agora = new Date();
    if (convite.sentAt.getTime() > agora.getTime() - INTERVALO_ENTRE_ENVIOS_MS) {
      throw new BadRequestException("Este convite acabou de ser enviado — espere alguns minutos antes de reenviar.");
    }
    const notificationId = randomUUID();
    const evento = lot.ticketType.event;

    await prisma.$transaction(async (tx) => {
      // A TROCA É A TRAVA: só reenvia se o convite está como foi lido E o
      // último envio tem mais de 5 minutos. Clique duplo: o segundo encontra
      // count 0 e não manda outro e-mail.
      const trocou = await tx.lotEmailInvite.updateMany({
        where: {
          id: convite.id,
          token: convite.token,
          status: convite.status,
          orderId: convite.orderId,
          sentAt: { lte: new Date(agora.getTime() - INTERVALO_ENTRE_ENVIOS_MS) },
        },
        // convite "pegou" com pedido que acabou sem ingresso: volta a SENT de vez
        data: { notificationId, sentAt: agora, status: "SENT", orderId: null, claimedAt: null },
      });
      if (trocou.count === 0) {
        throw new BadRequestException("Este convite acabou de ser enviado — espere alguns minutos antes de reenviar.");
      }
      await tx.notification.create({
        data: {
          id: notificationId,
          channel: "EMAIL",
          recipient: convite.email,
          template: TEMPLATE_CONVITE_EMAIL,
          payload: { ...this.textoDoEmail(lot), conviteUrl: urlDoConvite(evento.slug, convite.token) },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          organizationId: evento.organizationId,
          action: "lot_email_invite.resend",
          entityType: "lot_email_invite",
          entityId: convite.id,
          metadata: { ticketLotId: lot.id, email: convite.email },
        },
      });
    });
    return this.conviteNaTela(convite.id);
  }

  /**
   * Troca o e-mail do convite (o que voltou ou foi digitado errado) e manda de
   * novo, com link NOVO — o antigo foi para um endereço errado e para de valer.
   */
  async corrigir(conviteId: string, userId: string, emailNovo: string): Promise<ConviteNaTela> {
    const { convite, lot } = await this.conviteComPermissao(conviteId, userId);
    const motivo = motivoParaNaoMandar(lot);
    if (motivo) throw new BadRequestException(motivo);
    await this.exigirLivre(convite);

    const email = normalizarEmailDeConvite(emailNovo ?? "");
    const recusa = motivoEmailDeConviteInvalido(email);
    if (recusa) throw new BadRequestException(recusa);
    if (email === convite.email) {
      throw new BadRequestException("É o mesmo e-mail do convite. Confira com a pessoa o endereço certo.");
    }

    const token = novoCodigoDoConvite();
    const notificationId = randomUUID();
    const agora = new Date();
    const evento = lot.ticketType.event;

    try {
      await prisma.$transaction(async (tx) => {
        const trocou = await tx.lotEmailInvite.updateMany({
          where: { id: convite.id, token: convite.token, status: convite.status, orderId: convite.orderId },
          data: { email, token, notificationId, sentAt: agora, status: "SENT", orderId: null, claimedAt: null },
        });
        if (trocou.count === 0) {
          throw new BadRequestException("Este convite mudou enquanto você corrigia — atualize a lista e tente de novo.");
        }
        await tx.notification.create({
          data: {
            id: notificationId,
            channel: "EMAIL",
            recipient: email,
            template: TEMPLATE_CONVITE_EMAIL,
            payload: { ...this.textoDoEmail(lot), conviteUrl: urlDoConvite(evento.slug, token) },
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            organizationId: evento.organizationId,
            action: "lot_email_invite.correct",
            entityType: "lot_email_invite",
            entityId: convite.id,
            metadata: { ticketLotId: lot.id, emailAntes: convite.email, emailDepois: email },
          },
        });
      });
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
        throw new BadRequestException(`${email} já tem convite neste lote.`);
      }
      throw erro;
    }
    return this.conviteNaTela(convite.id);
  }

  /** Revoga: o link para de valer na hora. Quem já pegou o ingresso não é afetado aqui. */
  async revogar(conviteId: string, userId: string): Promise<ConviteNaTela> {
    const { convite, lot } = await this.conviteComPermissao(conviteId, userId);
    // clique duplo: o segundo encontra revogado e devolve como está
    if (convite.status === "REVOKED") return this.conviteNaTela(convite.id);
    if (!(await conviteEstaLivre(convite))) {
      throw new BadRequestException(
        "Esta pessoa já pegou o ingresso — revogar não tira o ingresso dela. Para isso, cancele o pedido em Vendas.",
      );
    }

    await prisma.$transaction(async (tx) => {
      const trocou = await tx.lotEmailInvite.updateMany({
        where: { id: convite.id, status: convite.status, orderId: convite.orderId },
        data: { status: "REVOKED", orderId: null, claimedAt: null },
      });
      if (trocou.count === 0) {
        const agora = await tx.lotEmailInvite.findUnique({ where: { id: convite.id }, select: { status: true } });
        if (agora?.status === "REVOKED") return; // outra aba revogou junto
        throw new BadRequestException("Este convite mudou enquanto você revogava — atualize a lista.");
      }
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          organizationId: lot.ticketType.event.organizationId,
          action: "lot_email_invite.revoke",
          entityType: "lot_email_invite",
          entityId: convite.id,
          metadata: { ticketLotId: lot.id, email: convite.email },
        },
      });
    });
    return this.conviteNaTela(convite.id);
  }

  // ---------------------------------------------------------------------------
  // Público (link do e-mail)
  // ---------------------------------------------------------------------------

  /**
   * Quem abriu o link do convite: o e-mail (o próprio dono precisa ver, para
   * o checkout travar nele), o evento e o lote. Só para convite que ainda vale.
   */
  async publico(codigo: string) {
    const convite = await convitePeloCodigo(codigo);
    if (!convite) throw new NotFoundException("Convite não encontrado. Confira o link que chegou no seu e-mail.");
    if (convite.status === "REVOKED") {
      throw new GoneException("Este convite foi cancelado pela produção do evento.");
    }
    if (!convite.livre) {
      throw new GoneException("Este convite já foi usado — o ingresso foi para o e-mail do convite. Procure em Minhas compras.");
    }
    const lote = await prisma.ticketLot.findUnique({
      where: { id: convite.ticketLotId },
      select: {
        id: true,
        name: true,
        priceCents: true,
        maxPerOrder: true,
        limitPerCpf: true,
        ticketType: { select: { name: true, event: { select: { slug: true, title: true } } } },
      },
    });
    if (!lote) throw new NotFoundException("Convite não encontrado. Confira o link que chegou no seu e-mail.");
    return {
      email: convite.email,
      eventSlug: lote.ticketType.event.slug,
      eventTitle: lote.ticketType.event.title,
      // o que a página do convite mostra: "Pista — Convidados VIP · Grátis · até 1 por pessoa"
      lote: {
        id: lote.id,
        name: lote.name,
        ticketTypeName: lote.ticketType.name,
        priceCents: lote.priceCents,
        maxPerOrder: lote.maxPerOrder,
        limitPerCpf: lote.limitPerCpf,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Internos
  // ---------------------------------------------------------------------------

  private async loteComPermissao(lotId: string, userId: string): Promise<LoteDoConvite> {
    if (!FORMATO_UUID.test(lotId)) throw new NotFoundException("Lote não encontrado");
    const lot = await prisma.ticketLot.findUnique({ where: { id: lotId }, select: loteSelect });
    if (!lot) throw new NotFoundException("Lote não encontrado");
    await this.orgAccess.assertPermission(lot.ticketType.event.organizationId, userId, PERMISSIONS.EVENT_CREATE);
    return lot;
  }

  private async conviteComPermissao(conviteId: string, userId: string) {
    if (!FORMATO_UUID.test(conviteId)) throw new NotFoundException("Convite não encontrado");
    const convite = await prisma.lotEmailInvite.findUnique({ where: { id: conviteId }, select: conviteSelect });
    if (!convite) throw new NotFoundException("Convite não encontrado");
    const lot = await this.loteComPermissao(convite.ticketLotId, userId);
    return { convite, lot };
  }

  /** Reenviar e corrigir só valem para convite que ainda não virou ingresso. */
  private async exigirLivre(convite: ConviteLido) {
    if (convite.status === "REVOKED") {
      throw new BadRequestException("Este convite foi revogado — cole o e-mail de novo para convidar outra vez.");
    }
    if (!(await conviteEstaLivre(convite))) {
      throw new BadRequestException("Esta pessoa já pegou o ingresso — o convite não vale mais.");
    }
  }

  /** Texto comum do e-mail (o link entra por convite). */
  private textoDoEmail(lot: LoteDoConvite) {
    const evento = lot.ticketType.event;
    return {
      casa: evento.organization.displayName ?? evento.organization.name,
      eventTitle: evento.title,
      eventStartsAt: quandoDoEvento(evento.startsAt, evento.timezone),
    };
  }

  /** Releitura de uma linha para a tela, com a situação atual. */
  private async conviteNaTela(conviteId: string): Promise<ConviteNaTela> {
    const convite = await prisma.lotEmailInvite.findUniqueOrThrow({ where: { id: conviteId }, select: conviteSelect });
    const lot = await prisma.ticketLot.findUniqueOrThrow({ where: { id: convite.ticketLotId }, select: loteSelect });
    const [pedido, notificacao] = await Promise.all([
      convite.orderId
        ? prisma.order.findUnique({ where: { id: convite.orderId }, select: { status: true } })
        : Promise.resolve(null),
      convite.notificationId
        ? prisma.notification.findUnique({
            where: { id: convite.notificationId },
            select: { status: true, deliveredAt: true, bouncedAt: true, deliveryEvent: true },
          })
        : Promise.resolve(null),
    ]);
    return linhaDaTela(convite, pedido, notificacao, motivoParaNaoMandar(lot));
  }
}
