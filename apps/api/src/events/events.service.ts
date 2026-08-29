import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { randomBytes } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { PERMISSIONS } from "@borafest/auth";
import { getEmailSender } from "@borafest/notifications";
import type { CreateEventInput, UpdateEventInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";
import { estornarTaxaDaPlataforma, executarReembolso } from "../common/refund-order";
import { getOrganizationBalanceCents } from "../common/ledger";
import { UPLOADS_DIR } from "../uploads/uploads.constants";

/** Assinatura (magic bytes) dos formatos aceitos — mimetype do multipart é só o que o cliente alegou. */
const MAGIC_BYTES: Record<string, { ext: string; signature: number[]; offset?: number }> = {
  "image/jpeg": { ext: "jpg", signature: [0xff, 0xd8, 0xff] },
  "image/png": { ext: "png", signature: [0x89, 0x50, 0x4e, 0x47] },
  "image/webp": { ext: "webp", signature: [0x57, 0x45, 0x42, 0x50], offset: 8 },
};

function detectImageExt(head: Buffer): string | null {
  for (const { ext, signature, offset = 0 } of Object.values(MAGIC_BYTES)) {
    if (head.length >= offset + signature.length) {
      const matches = signature.every((byte, i) => head[offset + i] === byte);
      if (matches) return ext;
    }
  }
  return null;
}

function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}


/**
 * Caminhos que já existem no site — um evento com esse slug sequestraria a
 * página (o link curto mora na raiz: borafest.com.br/nome-do-evento).
 */
const SLUGS_RESERVADOS = new Set([
  "acesso", "checkout", "evento", "explorar", "favoritos", "legal",
  "minhas-compras", "offline", "pedido", "perfil", "portaria",
  "api", "admin", "painel", "sitemap.xml", "robots.txt", "_next",
]);

/**
 * Slug curto e legível (2026-08-19): antes todo evento nascia com um sufixo
 * aleatório ("dvc-submundo-5z3vx") só para garantir unicidade, e isso ia parar
 * no cartaz. Agora tenta o nome limpo e só numera se realmente colidir.
 */
async function gerarSlugUnico(titulo: string): Promise<string> {
  const base = slugify(titulo) || "evento";
  for (let n = 0; n < 50; n += 1) {
    const candidato = n === 0 ? base : `${base}-${n + 1}`;
    if (SLUGS_RESERVADOS.has(candidato)) continue;
    const existe = await prisma.event.findUnique({ where: { slug: candidato }, select: { id: true } });
    if (!existe) return candidato;
  }
  // saída de emergência: mantém o comportamento antigo
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

@Injectable()
export class EventsService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  async create(organizationId: string, actorUserId: string, input: CreateEventInput) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    const slug = await gerarSlugUnico(input.title);

    // local inline: reaproveita o mesmo (nome+cidade) da organização ou cria
    const venueId = input.venue
      ? (await this.upsertVenue(organizationId, input.venue)).id
      : input.venueId;

    return prisma.event.create({
      data: {
        organizationId,
        venueId,
        title: input.title,
        slug,
        description: input.description,
        lineup: input.lineup,
        amenities: input.amenities,
        minAge: input.minAge,
        category: input.category,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        timezone: input.timezone,
      },
    });
  }

  async listForOrganization(organizationId: string, actorUserId: string) {
    // qualquer papel com trabalho no evento precisa LISTAR os eventos, senão
    // o painel abre vazio (auditoria 2026-08-10: "Gestor do evento" e
    // "Check-in" recebiam 403 na primeira tela)
    const permitido = [
      PERMISSIONS.EVENT_CREATE,
      PERMISSIONS.SALES_PERFORM,
      PERMISSIONS.FINANCE_VIEW,
      PERMISSIONS.CHECKIN_PERFORM,
    ];
    let liberado = false;
    for (const permissao of permitido) {
      try {
        await this.orgAccess.assertPermission(organizationId, actorUserId, permissao);
        liberado = true;
        break;
      } catch {
        // tenta o próximo papel
      }
    }
    if (!liberado) {
      await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);
    }

    return prisma.event.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
  }

  async update(eventId: string, actorUserId: string, input: UpdateEventInput) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");

    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    const venueId = input.venue
      ? (await this.upsertVenue(event.organizationId, input.venue)).id
      : input.venueId;

    // merge parcial: enviar só um pixel (ex. metaPixelId) não deve apagar os outros já salvos
    let pixelSettings: Record<string, string> | undefined;
    if (input.pixelSettings) {
      const merged = {
        ...(event.pixelSettings as Record<string, string> | null),
        ...input.pixelSettings,
      } as Record<string, string | null>;
      // null/"" = apagar de verdade (não deixar o pixel antigo disparando)
      for (const [k, v] of Object.entries(merged)) {
        if (v === null || v === undefined || v === "") delete merged[k];
      }
      pixelSettings = merged as Record<string, string>;
    }

    return prisma.event.update({
      where: { id: eventId },
      data: {
        title: input.title,
        description: input.description,
        lineup: input.lineup,
        amenities: input.amenities,
        minAge: input.minAge,
        category: input.category === null ? null : input.category,
        bannerUrl: input.bannerUrl,
        waitingRoomEnabled: input.waitingRoomEnabled,
        waitingRoomConcurrency: input.waitingRoomConcurrency,
        pixelSettings,
        // token do CAPI: "" ou null desliga; undefined mantém o atual
        metaCapiToken:
          input.metaCapiToken === undefined
            ? undefined
            : input.metaCapiToken
              ? input.metaCapiToken
              : null,
        venueId,
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
        timezone: input.timezone,
      },
    });
  }

  async publish(eventId: string, actorUserId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");

    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_PUBLISH);

    if (event.status !== "DRAFT") {
      return event;
    }

    const published = await prisma.event.update({
      where: { id: eventId },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });

    // melhor esforço — não bloqueia a publicação se o envio falhar
    this.notifyFollowers(published).catch(() => undefined);

    return published;
  }

  private async notifyFollowers(event: { id: string; organizationId: string; title: string; slug: string }) {
    const [followers, organization] = await Promise.all([
      prisma.organizationFollow.findMany({
        where: { organizationId: event.organizationId },
        include: { user: { select: { email: true } } },
      }),
      prisma.organization.findUnique({ where: { id: event.organizationId }, select: { name: true } }),
    ]);
    const recipients = followers.map((f) => f.user.email).filter((email): email is string => !!email);
    if (recipients.length === 0) return;

    const webBaseUrl = process.env.WEB_BASE_URL ?? "http://localhost:3000";
    const link = `${webBaseUrl}/evento/${event.slug}`;
    const sender = getEmailSender();
    await Promise.allSettled(
      recipients.map((to) =>
        sender.send({
          to,
          subject: `${organization?.name ?? "Um produtor que você segue"} publicou um novo evento`,
          html: `<p>${event.title} já está com vendas abertas.</p><p><a href="${link}">${link}</a></p>`,
          text: `${event.title} já está com vendas abertas: ${link}`,
        }),
      ),
    );
  }

  /** Despublicar = pausar vendas (máquina de estados §9: PUBLISHED → SALES_PAUSED). */
  async unpublish(eventId: string, actorUserId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");

    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_PUBLISH);

    if (event.status !== "PUBLISHED") {
      return event;
    }

    return prisma.event.update({
      where: { id: eventId },
      data: { status: "SALES_PAUSED" },
    });
  }

  /** Republicar depois de pausar (SALES_PAUSED → PUBLISHED). */
  async republish(eventId: string, actorUserId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");

    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_PUBLISH);

    if (event.status !== "SALES_PAUSED") {
      return event;
    }

    return prisma.event.update({
      where: { id: eventId },
      data: { status: "PUBLISHED" },
    });
  }

  /**
   * Banner por upload de arquivo (decisão 2026-08-01: URL colada não presta —
   * produtor escolhe a imagem no aparelho). Limites: 5 MB, jpeg/png/webp.
   */
  async uploadBanner(
    eventId: string,
    actorUserId: string,
    file: { mimetype: string; filename: string; file: NodeJS.ReadableStream },
  ) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    const chunks: Buffer[] = [];
    for await (const chunk of file.file as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks);

    // extensão vem do conteúdo real do arquivo, não do mimetype alegado pelo
    // cliente na parte multipart (fácil de forjar)
    const ext = detectImageExt(content);
    if (!ext) {
      throw new BadRequestException("Formato inválido — use JPG, PNG ou WebP");
    }

    const name = `evento-${eventId}-${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
    await writeFile(join(UPLOADS_DIR, name), content);

    // remove o banner anterior deste evento para não acumular arquivo órfão
    if (event.bannerUrl) {
      const previousName = basename(event.bannerUrl);
      await unlink(join(UPLOADS_DIR, previousName)).catch(() => undefined);
    }

    const base = process.env.API_PUBLIC_URL ?? "http://localhost:3333";
    const bannerUrl = `${base}/uploads/${name}`;
    await prisma.event.update({ where: { id: eventId }, data: { bannerUrl } });
    return { bannerUrl };
  }

  /** Um Venue por (organização, nome, cidade) — evita duplicar a cada edição. */
  private async upsertVenue(
    organizationId: string,
    venue: { name: string; address?: string; mapsUrl?: string; city: string; state: string },
  ) {
    const existing = await prisma.venue.findFirst({
      where: {
        organizationId,
        name: { equals: venue.name, mode: "insensitive" },
        city: { equals: venue.city, mode: "insensitive" },
      },
    });
    const state = venue.state.toUpperCase();
    if (existing) {
      return prisma.venue.update({
        where: { id: existing.id },
        data: { address: venue.address, mapsUrl: venue.mapsUrl, state },
      });
    }
    return prisma.venue.create({ data: { organizationId, ...venue, state } });
  }

  // -------------------------------------------------------------------------
  // Cancelamento do evento (2026-08-29)
  // -------------------------------------------------------------------------

  /** Pedidos que ainda têm dinheiro do comprador para devolver. */
  private static readonly A_REEMBOLSAR = ["PAID", "FULFILLED", "PARTIALLY_REFUNDED"] as const;

  private async assertPodeCancelar(eventId: string, actorUserId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    // cancelar tira do ar E devolve dinheiro: exige as duas permissões
    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_PUBLISH);
    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.ORDER_REFUND);
    return event;
  }

  /**
   * Quanto ainda falta devolver de cada pedido vivo do evento.
   * O estorno do gateway aponta para o PAGAMENTO e o do PDV para o PEDIDO —
   * os dois entram na conta, senão um pedido já parcialmente devolvido
   * apareceria devendo o valor cheio.
   */
  private async restantePorPedido(eventId: string): Promise<Map<string, number>> {
    const pedidos = await prisma.order.findMany({
      where: { eventId, status: { in: [...EventsService.A_REEMBOLSAR] } },
      select: { id: true, totalCents: true, payments: { select: { id: true } } },
    });
    if (pedidos.length === 0) return new Map();

    const idsDePedido = pedidos.map((p) => p.id);
    const idsDePagamento = pedidos.flatMap((p) => p.payments.map((pg) => pg.id));

    const [porPedido, porPagamento] = await Promise.all([
      prisma.ledgerEntry.groupBy({
        by: ["referenceId"],
        where: { referenceType: "order", referenceId: { in: idsDePedido }, type: "REFUND_DEBIT" },
        _sum: { amountCents: true },
      }),
      idsDePagamento.length > 0
        ? prisma.ledgerEntry.groupBy({
            by: ["referenceId"],
            where: {
              referenceType: "payment",
              referenceId: { in: idsDePagamento },
              type: "REFUND_DEBIT",
            },
            _sum: { amountCents: true },
          })
        : Promise.resolve([] as Array<{ referenceId: string; _sum: { amountCents: number | null } }>),
    ]);

    const devolvidoPorPedido = new Map<string, number>();
    for (const linha of porPedido) {
      devolvidoPorPedido.set(linha.referenceId, Math.abs(linha._sum.amountCents ?? 0));
    }
    const pedidoDoPagamento = new Map<string, string>();
    for (const p of pedidos) {
      for (const pg of p.payments) pedidoDoPagamento.set(pg.id, p.id);
    }
    for (const linha of porPagamento) {
      const pedidoId = pedidoDoPagamento.get(linha.referenceId);
      if (!pedidoId) continue;
      devolvidoPorPedido.set(
        pedidoId,
        (devolvidoPorPedido.get(pedidoId) ?? 0) + Math.abs(linha._sum.amountCents ?? 0),
      );
    }

    const restante = new Map<string, number>();
    for (const p of pedidos) {
      const falta = p.totalCents - (devolvidoPorPedido.get(p.id) ?? 0);
      if (falta > 0) restante.set(p.id, falta);
    }
    return restante;
  }

  /**
   * O que vai acontecer se o evento for cancelado — para a tela avisar ANTES.
   * Mostra quantas pessoas recebem de volta, quanto sai, quanto da taxa a
   * plataforma devolve e como o saldo da casa fica depois de tudo.
   */
  async previewCancel(eventId: string, actorUserId: string) {
    const event = await this.assertPodeCancelar(eventId, actorUserId);
    const restante = await this.restantePorPedido(eventId);
    // o que o COMPRADOR recebe é sempre o bruto que falta — isso não depende
    // de como a venda foi lançada
    const refundTotalCents = [...restante.values()].reduce((soma, v) => soma + v, 0);

    const idsDePedido = [...restante.keys()];
    const balanceCents = await getOrganizationBalanceCents(event.organizationId);

    if (idsDePedido.length === 0) {
      return {
        eventId,
        alreadyCanceled: event.status === "CANCELED",
        orders: 0,
        refundTotalCents: 0,
        feeBackCents: 0,
        balanceCents,
        balanceAfterCents: balanceCents,
      };
    }

    // a taxa mora no PAGAMENTO na venda online e no PEDIDO no PDV — os dois
    // entram, senão a prévia prometeria devolver zero de taxa
    const idsDePagamento = (
      await prisma.payment.findMany({
        where: { orderId: { in: idsDePedido } },
        select: { id: true, orderId: true },
      })
    );
    const pedidoDoPagamento = new Map(idsDePagamento.map((p) => [p.id, p.orderId]));

    const lancamentos = await prisma.ledgerEntry.findMany({
      where: {
        OR: [
          { referenceType: "order", referenceId: { in: idsDePedido } },
          ...(idsDePagamento.length > 0
            ? [{ referenceType: "payment", referenceId: { in: [...pedidoDoPagamento.keys()] } }]
            : []),
        ],
      },
      select: { amountCents: true, type: true, referenceType: true, referenceId: true },
    });

    /*
     * IMPACTO NO SALDO = a soma dos saldos ATUAIS destes pedidos, porque
     * cancelar leva cada um deles a zero — o produtor não fica com nada nem
     * deve nada por uma festa que não aconteceu.
     *
     * Não dá pra prever com "menos o bruto, mais a taxa": os caminhos de
     * estorno debitam valores diferentes (total online debita o líquido;
     * parcial e PDV debitam o bruto), e essa conta erraria justamente no
     * caminho mais comum. O saldo é indiferente ao caminho.
     */
    const impactoCents = lancamentos.reduce((soma, l) => soma + l.amountCents, 0);

    const taxas = lancamentos.filter((l) => l.type === "PLATFORM_FEE");
    const feeBackCents = Math.max(taxas.reduce((soma, t) => soma - t.amountCents, 0), 0);

    return {
      eventId,
      alreadyCanceled: event.status === "CANCELED",
      orders: restante.size,
      refundTotalCents,
      feeBackCents,
      balanceCents,
      /** saldo da casa depois de devolver tudo (pode ficar negativo) */
      balanceAfterCents: balanceCents - impactoCents,
    };
  }

  /**
   * Avisa quem comprou que o evento foi cancelado, com o motivo que o produtor
   * escreveu (revisão adversarial 2026-08-29: a tela prometia "o comprador vai
   * ler isso" e o texto só existia no audit_log — a pessoa descobriria pelo
   * estorno na fatura, sem saber o que houve).
   *
   * Best-effort e fora da transação: e-mail que não sai não pode impedir o
   * dinheiro de voltar.
   */
  private async avisarCompradoresDoCancelamento(
    event: { id: string; title: string; organizationId: string },
    reason: string,
  ): Promise<void> {
    try {
      const pedidos = await prisma.order.findMany({
        where: { eventId: event.id, status: { in: [...EventsService.A_REEMBOLSAR] } },
        select: { contactEmail: true },
      });
      const destinatarios = [
        ...new Set(pedidos.map((p) => p.contactEmail).filter((e): e is string => !!e)),
      ];
      if (destinatarios.length === 0) return;

      const organization = await prisma.organization.findUnique({
        where: { id: event.organizationId },
        select: { name: true, displayName: true },
      });
      const casa = organization?.displayName ?? organization?.name ?? "A produtora";
      const sender = getEmailSender();
      const motivo = reason.trim();

      await Promise.allSettled(
        destinatarios.map((to) =>
          sender.send({
            to,
            subject: `${event.title} foi cancelado — seu dinheiro está voltando`,
            html:
              `<p><strong>${event.title}</strong> foi cancelado por ${casa}.</p>` +
              `<p>Motivo: ${motivo}</p>` +
              `<p>Você não precisa fazer nada: o valor pago está sendo devolvido pelo mesmo meio ` +
              `em que você pagou. No Pix costuma cair em minutos; no cartão, o estorno aparece ` +
              `na fatura conforme o prazo do seu banco.</p>`,
            text:
              `${event.title} foi cancelado por ${casa}. Motivo: ${motivo}. ` +
              `O valor pago está sendo devolvido pelo mesmo meio em que você pagou — ` +
              `Pix costuma cair em minutos; no cartão, o estorno aparece na fatura ` +
              `conforme o prazo do seu banco.`,
          }),
        ),
      );
    } catch {
      // avisar é importante, mas nunca ao ponto de travar o reembolso
    }
  }

  /**
   * Cancela o evento e devolve o dinheiro de todo mundo.
   *
   * O evento sai do ar na PRIMEIRA chamada e os reembolsos vão em lotes: o
   * estorno passa pelo gateway, um por pedido, e uma casa com centenas de
   * vendas estouraria o tempo da requisição. A tela chama de novo enquanto
   * `remaining` for maior que zero, então o progresso aparece acontecendo.
   *
   * Interromper no meio não corrompe nada: o evento já está cancelado, cada
   * pedido devolvido está devolvido, e abrir a tela de novo mostra quantos
   * faltam com o botão para continuar.
   *
   * A taxa da plataforma volta pro produtor a cada pedido (decisão do Arthur):
   * evento cancelado não pode custar dinheiro a quem não deu causa.
   */
  async cancel(
    eventId: string,
    actorUserId: string,
    input: { reason: string; batchSize?: number; skipOrderIds?: string[] },
  ) {
    const event = await this.assertPodeCancelar(eventId, actorUserId);

    if (event.status !== "CANCELED") {
      await prisma.event.update({ where: { id: eventId }, data: { status: "CANCELED" } });
      await prisma.auditLog.create({
        data: {
          actorUserId,
          organizationId: event.organizationId,
          action: "event.cancel",
          entityType: "event",
          entityId: eventId,
          metadata: { reason: input.reason },
        },
      });
      // uma vez só, quando o evento sai do ar: quem comprou precisa saber ANTES
      // de ver o estorno cair na fatura, e precisa saber POR QUÊ
      await this.avisarCompradoresDoCancelamento(event, input.reason);
    }

    const restante = await this.restantePorPedido(eventId);
    /*
     * Pedidos que já falharam nesta sessão saem da fila (revisão adversarial
     * 2026-08-29). Sem isso, um punhado de pedidos problemáticos no primeiro
     * lote fazia `refundedNow` voltar 0, o laço da tela parava na primeira
     * volta, e TODOS os outros compradores ficavam com o evento cancelado e sem
     * um centavo de volta.
     */
    const pular = new Set(input.skipOrderIds ?? []);
    const fila = [...restante.entries()].filter(([id]) => !pular.has(id));
    const lote = fila.slice(0, Math.min(input.batchSize ?? 10, 25));

    let refundedCents = 0;
    let feeBackCents = 0;
    const errors: Array<{ orderId: string; message: string }> = [];

    for (const [orderId, valor] of lote) {
      try {
        await executarReembolso(orderId, actorUserId, {
          amountCents: valor,
          reason: `Evento cancelado — ${input.reason}`,
        });
        refundedCents += valor;
        feeBackCents += await estornarTaxaDaPlataforma(orderId);
      } catch (error) {
        // um pedido problemático não pode travar a fila dos outros
        errors.push({ orderId, message: (error as Error).message });
      }
    }

    return {
      canceled: true,
      refundedNow: lote.length - errors.length,
      refundedCents,
      feeBackCents,
      /** ainda por tentar, já sem os que a tela mandou pular */
      remaining: Math.max(fila.length - lote.length, 0),
      errors,
    };
  }

}
