import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { prisma, type Prisma } from "@borafest/database";
import { withContext } from "@borafest/observability";
import { PlatformAccessService } from "../common/platform-access.service";
import { lerCabecalhosSvix, verificarAssinaturaSvix } from "./assinatura-svix";
import {
  EVENTOS_DE_PROBLEMA,
  eventosAbaixoDe,
  lerEventoResend,
  planoDoEvento,
  type EventoResend,
  type PlanoDeEntrega,
} from "./eventos-resend";

const log = withContext({ module: "webhook-resend" });

/** Segredo de assinatura do webhook (painel do Resend → Webhooks → Signing secret). */
export const RESEND_WEBHOOK_SECRET_ENV = "RESEND_WEBHOOK_SECRET";

interface NotificacaoAlvo {
  id: string;
  providerMessageId: string | null;
}

/**
 * Entrega real do e-mail (2026-10-12). "Enviado" só dizia que o Resend aceitou
 * o e-mail; quando o comprador dizia "não recebi", o suporte não tinha como
 * saber se chegou, voltou ou caiu no spam. O webhook do Resend grava isso na
 * notificação, e a tela de E-mails do backoffice mostra.
 */
@Injectable()
export class WebhooksEmailService {
  constructor(private readonly platformAccess: PlatformAccessService) {}

  /**
   * Recebe um evento do Resend. Sem segredo configurado, RECUSA (503): aceitar
   * sem conferir deixaria qualquer um marcar e-mail como entregue. O Resend
   * tenta de novo mais tarde, então nada se perde enquanto o segredo não entra.
   */
  async receberResend(
    headers: Record<string, string | string[] | undefined>,
    corpoCru: Buffer | undefined,
    agora: Date = new Date(),
  ) {
    const segredo = process.env[RESEND_WEBHOOK_SECRET_ENV]?.trim();
    if (!segredo) {
      log.warn("webhook do Resend recusado: RESEND_WEBHOOK_SECRET não configurado na API");
      throw new ServiceUnavailableException(
        "Webhook do Resend desligado: defina RESEND_WEBHOOK_SECRET no ambiente da API",
      );
    }
    if (!corpoCru || corpoCru.length === 0) {
      throw new BadRequestException("Corpo do webhook vazio");
    }

    const assinatura = verificarAssinaturaSvix({
      segredo,
      cabecalhos: lerCabecalhosSvix(headers),
      corpo: corpoCru,
      agora,
    });
    if (!assinatura.ok) {
      log.warn({ motivo: assinatura.motivo }, "webhook do Resend recusado: assinatura inválida");
      throw new UnauthorizedException("Assinatura do webhook inválida");
    }

    let corpo: unknown;
    try {
      corpo = JSON.parse(corpoCru.toString("utf8"));
    } catch {
      throw new BadRequestException("Corpo do webhook não é JSON");
    }

    // daqui em diante sempre 200: o evento é legítimo; o que não nos interessa
    // é ignorado em vez de fazer o Resend repetir para sempre
    const evento = lerEventoResend(corpo, agora);
    if (!evento) return { recebido: true, ignorado: "evento sem tipo ou sem dados" };

    const plano = planoDoEvento(evento);
    if (!plano) return { recebido: true, ignorado: `evento ${evento.tipo} não é acompanhado` };

    const notificacao = await this.acharNotificacao(evento);
    if (!notificacao) {
      // e-mail que não passou pela fila de notificações (ex.: aviso direto) ou
      // enviado antes deste deploy, sem id gravado
      return { recebido: true, ignorado: "e-mail sem notificação registrada" };
    }

    await this.gravar(notificacao, evento, plano);
    log.info({ notificationId: notificacao.id, evento: evento.tipo }, "evento de entrega do Resend gravado");
    return { recebido: true };
  }

  /**
   * Pelo id do Resend; se ainda não foi gravado (o evento chegou antes de o
   * worker salvar a resposta do envio), pela tag notification_id — só se o
   * destinatário do evento for o da notificação.
   */
  private async acharNotificacao(evento: EventoResend): Promise<NotificacaoAlvo | null> {
    if (evento.emailId) {
      const porId = await prisma.notification.findFirst({
        where: { providerMessageId: evento.emailId },
        select: { id: true, providerMessageId: true },
      });
      if (porId) return porId;
    }
    if (evento.notificationId) {
      const porTag = await prisma.notification.findUnique({
        where: { id: evento.notificationId },
        select: { id: true, providerMessageId: true, channel: true, recipient: true },
      });
      const mesmoDestino =
        porTag?.channel === "EMAIL" &&
        evento.destinatarios.some((d) => d.toLowerCase() === porTag.recipient.toLowerCase());
      if (porTag && mesmoDestino) return { id: porTag.id, providerMessageId: porTag.providerMessageId };
    }
    return null;
  }

  /**
   * Cada campo com guarda própria no WHERE (idempotente e seguro com eventos
   * repetidos ou fora de ordem): datas só se ainda vazias; o último evento só
   * troca por um mais grave (PESO_EVENTO).
   */
  private async gravar(notificacao: NotificacaoAlvo, evento: EventoResend, plano: PlanoDeEntrega) {
    const id = notificacao.id;
    const passos: Prisma.PrismaPromise<Prisma.BatchPayload>[] = [];
    if (!notificacao.providerMessageId && evento.emailId) {
      passos.push(
        prisma.notification.updateMany({
          where: { id, providerMessageId: null },
          data: { providerMessageId: evento.emailId },
        }),
      );
    }
    if (plano.deliveredAt) {
      passos.push(
        prisma.notification.updateMany({
          where: { id, deliveredAt: null },
          data: { deliveredAt: plano.deliveredAt },
        }),
      );
    }
    if (plano.bouncedAt) {
      passos.push(
        prisma.notification.updateMany({
          where: { id, bouncedAt: null },
          data: { bouncedAt: plano.bouncedAt },
        }),
      );
    }
    passos.push(
      prisma.notification.updateMany({
        where: {
          id,
          OR: [{ deliveryEvent: null }, { deliveryEvent: { in: eventosAbaixoDe(plano.peso) } }],
        },
        // o motivo da devolução vai para `error`, que o suporte já lê
        data: { deliveryEvent: plano.deliveryEvent, ...(plano.erro ? { error: plano.erro } : {}) },
      }),
    );
    await prisma.$transaction(passos);
  }

  /**
   * Consulta do suporte: e-mails de um destinatário (ou os que voltaram/foram
   * marcados como spam), com o estado real de entrega. Nunca expõe `payload`
   * (carrega magic-link, código e PII — mesma defesa da listagem de FAILED).
   */
  async listarParaSuporte(userId: string, filtros: { destinatario?: string; situacao?: string }) {
    await this.platformAccess.assertStaff(userId);

    const destinatario = filtros.destinatario?.trim();
    if (destinatario !== undefined && destinatario !== "" && destinatario.length < 3) {
      throw new BadRequestException("Digite pelo menos 3 caracteres do e-mail");
    }
    const soProblemas = filtros.situacao === "problemas";

    const [itens, ultimos] = await Promise.all([
      prisma.notification.findMany({
        where: {
          channel: "EMAIL",
          ...(destinatario ? { recipient: { contains: destinatario, mode: "insensitive" as const } } : {}),
          ...(soProblemas
            ? { OR: [{ bouncedAt: { not: null } }, { deliveryEvent: { in: EVENTOS_DE_PROBLEMA } }] }
            : {}),
        },
        select: {
          id: true,
          template: true,
          recipient: true,
          status: true,
          attempts: true,
          error: true,
          createdAt: true,
          sentAt: true,
          orderId: true,
          providerMessageId: true,
          deliveredAt: true,
          bouncedAt: true,
          deliveryEvent: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.notification.aggregate({ _max: { deliveredAt: true, bouncedAt: true } }),
    ]);

    const datas = [ultimos._max.deliveredAt, ultimos._max.bouncedAt].filter((d): d is Date => d !== null);
    const ultimoRetornoEm = datas.length > 0 ? new Date(Math.max(...datas.map((d) => d.getTime()))) : null;

    return {
      itens,
      provedorEmail: process.env.EMAIL_PROVIDER ?? "devlog",
      webhookConfigurado: Boolean(process.env[RESEND_WEBHOOK_SECRET_ENV]?.trim()),
      ultimoRetornoEm,
    };
  }
}
