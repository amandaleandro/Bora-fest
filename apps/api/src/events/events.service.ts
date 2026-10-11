import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { PERMISSIONS } from "@borafest/auth";
import { getEmailSender } from "@borafest/notifications";
import type { CreateEventInput, UpdateEventInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";
import { semSegredoDoEvento } from "../common/event-public";
import { estornarTaxaDaPlataforma, executarReembolso } from "../common/refund-order";
import { cancelarPedidoGratis } from "../common/cancelar-pedido-gratis";
import { semEmailReal } from "@borafest/contracts";
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
    let venueId = input.venue
      ? (await this.upsertVenue(organizationId, input.venue)).id
      : input.venueId;
    // venue do corpo tem que ser DESTA organização (auditoria 2026-08-30): o
    // update() já checava isto, mas o create() aceitava um venueId de outra
    // casa — o evento apontava para o local alheio e o dashboard vazava o
    // endereço/mapa por id (IDOR cross-tenant).
    if (!input.venue && input.venueId) {
      const venue = await prisma.venue.findUnique({ where: { id: input.venueId } });
      if (!venue || venue.organizationId !== organizationId) {
        throw new BadRequestException("Local inválido para esta organização");
      }
      venueId = input.venueId;
    }

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

    // NUNCA devolver o metaCapiToken (auditoria 2026-08-29): ele é o segredo do
    // envio server-side pra Meta e vazava aqui para papéis de portaria/vendedor.
    // Mesmo padrão do catálogo público — remove o campo de cada evento.
    const eventos = await prisma.event.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
    return eventos.map(({ metaCapiToken: _segredo, ...evento }) => evento);
  }

  async update(eventId: string, actorUserId: string, input: UpdateEventInput) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");

    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    let venueId = input.venue
      ? (await this.upsertVenue(event.organizationId, input.venue)).id
      : input.venueId;
    // venue do corpo tem que ser da MESMA produtora (auditoria 2026-08-29):
    // senão um evento apontava para o local de outra casa
    if (!input.venue && input.venueId) {
      const venue = await prisma.venue.findUnique({ where: { id: input.venueId } });
      if (!venue || venue.organizationId !== event.organizationId) {
        throw new BadRequestException("Local inválido para esta organização");
      }
      venueId = input.venueId;
    }

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

    const atualizado = await prisma.event.update({
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
        isPrivate: input.isPrivate,
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

    // privado → público (2026-10-11): é a primeira vez que quem segue a Casa
    // pode saber do evento, então anuncia — se estiver à venda, não encerrado
    // e ainda sem a marca de "já avisado". Ligar e desligar a chave de novo
    // nunca reenvia.
    let followersNotifiedAt = atualizado.followersNotifiedAt;
    if (event.isPrivate && input.isPrivate === false) {
      followersNotifiedAt =
        (await this.anunciarAosSeguidoresUmaVez(eventId, actorUserId, "abriu_ao_publico")) ??
        followersNotifiedAt;
    }

    // NUNCA devolver o metaCapiToken na resposta (auditoria 2026-08-30): o
    // painel só precisa saber se está configurado. Mesmo padrão do dashboard.
    const { metaCapiToken: _segredo, ...publico } = atualizado;
    return { ...publico, followersNotifiedAt };
  }

  async publish(eventId: string, actorUserId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");

    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_PUBLISH);

    if (event.status !== "DRAFT") {
      return semSegredoDoEvento(event);
    }

    const published = await prisma.event.update({
      where: { id: eventId },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });

    // melhor esforço — não bloqueia a publicação se o envio falhar.
    // Evento privado não é anunciado: abre só por link (revisão pré-deploy 2026-10-11);
    // se ele virar público depois, o update() anuncia. A marca de "já avisado"
    // impede que dois cliques em Publicar mandem o e-mail duas vezes.
    const followersNotifiedAt =
      (await this.anunciarAosSeguidoresUmaVez(eventId, actorUserId, "publicou")) ??
      published.followersNotifiedAt;

    return semSegredoDoEvento({ ...published, followersNotifiedAt });
  }

  /**
   * Anuncia o evento aos seguidores da Casa UMA vez só (2026-10-11).
   *
   * Primeiro reserva a marca `followersNotifiedAt` numa escrita condicional:
   * só grava se ela estiver vazia e o evento estiver público, à venda e não
   * encerrado — conferido no banco na hora, não no que a tela mandou. Só quem
   * consegue gravar manda o e-mail. Assim dois salvamentos ao mesmo tempo,
   * Publicar duas vezes ou ligar/desligar a chave "privado" nunca reenviam.
   *
   * Devolve a data gravada, ou null quando não anunciou. Melhor esforço:
   * falha aqui nunca derruba a publicação nem o salvamento.
   */
  private async anunciarAosSeguidoresUmaVez(
    eventId: string,
    actorUserId: string,
    motivo: "publicou" | "abriu_ao_publico" | "reabriu_vendas",
  ): Promise<Date | null> {
    try {
      const agora = new Date();
      const reserva = await prisma.event.updateMany({
        where: {
          id: eventId,
          followersNotifiedAt: null,
          isPrivate: false,
          status: "PUBLISHED",
          endsAt: { gt: agora },
        },
        data: { followersNotifiedAt: agora },
      });
      if (reserva.count === 0) return null;

      // lido DEPOIS da reserva: se o mesmo salvamento trocou nome ou link, o
      // e-mail sai com o atual
      const evento = await prisma.event.findUnique({
        where: { id: eventId },
        select: { id: true, organizationId: true, title: true, slug: true },
      });
      if (!evento) return agora;

      // envio fora do caminho da requisição: e-mail lento não segura a tela
      this.notifyFollowers(evento).catch(() => undefined);

      await prisma.auditLog
        .create({
          data: {
            actorUserId,
            organizationId: evento.organizationId,
            action: "event.followers_notified",
            entityType: "event",
            entityId: eventId,
            metadata: { motivo },
          },
        })
        .catch(() => undefined);

      return agora;
    } catch {
      // anunciar é bom, mas nunca ao ponto de travar a publicação
      return null;
    }
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
      return semSegredoDoEvento(event);
    }

    const pausado = await prisma.event.update({
      where: { id: eventId },
      data: { status: "SALES_PAUSED" },
    });
    return semSegredoDoEvento(pausado);
  }

  /** Republicar depois de pausar (SALES_PAUSED → PUBLISHED). */
  async republish(eventId: string, actorUserId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");

    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_PUBLISH);

    if (event.status !== "SALES_PAUSED") {
      return semSegredoDoEvento(event);
    }

    const republicado = await prisma.event.update({
      where: { id: eventId },
      data: { status: "PUBLISHED" },
    });

    // reabrir vendas de evento que nunca foi anunciado (ex.: virou público
    // enquanto estava pausado) anuncia agora — mesma regra de uma vez só
    // (2026-10-11). Evento que já foi anunciado não manda de novo.
    const followersNotifiedAt =
      (await this.anunciarAosSeguidoresUmaVez(eventId, actorUserId, "reabriu_vendas")) ??
      republicado.followersNotifiedAt;

    return semSegredoDoEvento({ ...republicado, followersNotifiedAt });
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

    // perf 2026-08-30: banner saía CRU da câmera (1,27MB medidos, 49s de
    // download em produção). Normaliza tudo pra WebP <=1600px q80 (~100KB) —
    // .rotate() aplica o EXIF antes de descartá-lo, senão foto de celular
    // deita. Se o sharp engasgar (arquivo corrompido), rejeita como inválido.
    let processado: Buffer;
    try {
      // limitInputPixels (achado 2026-09-01): 5MB de ARQUIVO podem virar 268MP
      // decodificados (~1GB de RAM) — 30MP cobre qualquer foto real de celular
      processado = await sharp(content, { limitInputPixels: 30_000_000 })
        .rotate()
        .resize({ width: 1600, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
    } catch {
      throw new BadRequestException("Não consegui ler a imagem — tente outro arquivo");
    }

    const name = `evento-${eventId}-${Date.now()}-${randomBytes(4).toString("hex")}.webp`;
    await writeFile(join(UPLOADS_DIR, name), processado);

    // remove o banner anterior — SÓ se o nome for de arquivo deste evento
    // (auditoria 2026-08-29): o bannerUrl é editável via PATCH, então apontá-lo
    // para o arquivo de outra produtora fazia este unlink apagar arte alheia.
    // Todo upload nomeia `evento-<id>-...`, então exigimos esse prefixo.
    if (event.bannerUrl) {
      const previousName = basename(event.bannerUrl);
      if (previousName.startsWith(`evento-${eventId}-`)) {
        await unlink(join(UPLOADS_DIR, previousName)).catch(() => undefined);
      }
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

  /**
   * Pedidos grátis cancelados por chamada. Não passam pelo gateway (é só banco),
   * então cabem mais que os reembolsos — mas uma lista com milhares de nomes
   * ainda estouraria o tempo de uma requisição só.
   */
  private static readonly LOTE_GRATIS = 50;

  /**
   * Pedidos de R$ 0 ainda valendo (2026-10-11): lote grátis, cupom de 100%,
   * cortesia e lista. Não têm dinheiro a devolver, então ficavam fora de
   * `restantePorPedido` — o ingresso seguia "Válido" na carteira de um evento
   * cancelado. Pedido em que todo mundo já entrou fica de fora: não há o que
   * cancelar (cancelarPedidoGratis recusaria).
   */
  private async pedidosGratisACancelar(eventId: string): Promise<string[]> {
    const pedidos = await prisma.order.findMany({
      where: {
        eventId,
        totalCents: 0,
        status: { in: ["PAID", "FULFILLED"] },
        OR: [
          { tickets: { none: {} } },
          { tickets: { some: { status: { in: ["ISSUED", "ACTIVE"] } } } },
        ],
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    return pedidos.map((p) => p.id);
  }

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
      // pedidos de PORTA ficam de fora (decisão do Arthur, 2026-09-14): quem entrou
      // consumiu o ingresso e não tem reembolso — o laço e a prévia partem daqui,
      // então os dois concordam
      where: { eventId, soldByUserId: null, status: { in: [...EventsService.A_REEMBOLSAR] } },
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
    // ingressos grátis que serão cancelados junto (2026-10-11) — sem dinheiro,
    // por isso fora de `orders`, que conta quem recebe de volta
    const freeOrders = (await this.pedidosGratisACancelar(eventId)).length;

    if (idsDePedido.length === 0) {
      return {
        eventId,
        alreadyCanceled: event.status === "CANCELED",
        orders: 0,
        freeOrders,
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
      freeOrders,
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
        // só quem PAGOU (2026-10-11): o pedido de R$ 0 recebia "seu dinheiro está
        // voltando" sem ter pago nada. Ele ganha o e-mail próprio ("O evento X foi
        // cancelado") quando é cancelado no laço do cancel(), por cancelarPedidoGratis
        where: { eventId: event.id, totalCents: { gt: 0 }, status: { in: [...EventsService.A_REEMBOLSAR] } },
        select: { contactEmail: true, soldByUserId: true },
      });
      // e-mail sintético (porta, lista) não tem caixa: enviar é bounce garantido
      const reais = (lista: typeof pedidos) => [
        ...new Set(lista.map((p) => p.contactEmail).filter((e): e is string => !semEmailReal(e))),
      ];
      // VENDA DE PORTA (revisão 2026-10-11): o laço do cancel() não estorna venda
      // de porta (restantePorPedido exclui soldByUserId) — prometer "seu dinheiro
      // está voltando" a ela era falso. Ela recebe o aviso sem essa promessa.
      const destinatarios = reais(pedidos.filter((p) => !p.soldByUserId));
      const daPorta = reais(pedidos.filter((p) => p.soldByUserId)).filter((e) => !destinatarios.includes(e));
      if (destinatarios.length === 0 && daPorta.length === 0) return;

      const organization = await prisma.organization.findUnique({
        where: { id: event.organizationId },
        select: { name: true, displayName: true },
      });
      const casa = organization?.displayName ?? organization?.name ?? "A produtora";
      const sender = getEmailSender();
      const motivo = reason.trim();

      await Promise.allSettled(
        daPorta.map((to) =>
          sender.send({
            to,
            subject: `${event.title} foi cancelado`,
            html:
              `<p><strong>${event.title}</strong> foi cancelado por ${casa}.</p>` +
              `<p>Motivo: ${motivo}</p>` +
              `<p>Seu ingresso foi comprado na porta: para o valor pago, fale direto com a produção do evento.</p>`,
            text:
              `${event.title} foi cancelado por ${casa}. Motivo: ${motivo}. ` +
              `Seu ingresso foi comprado na porta: para o valor pago, fale direto com a produção do evento.`,
          }),
        ),
      );
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
    const refundedNow = lote.length - errors.length;

    /*
     * INGRESSOS GRÁTIS (2026-10-11): sem dinheiro a devolver, ficavam fora da
     * fila acima — seguiam "Válidos" na carteira de um evento cancelado e
     * levavam o e-mail "seu dinheiro está voltando". Agora são CANCELADOS pela
     * mesma operação do "Cancelar ingresso" do painel: QR deixa de valer, vaga
     * e cupom voltam, lista sincroniza, e a pessoa recebe "O evento X foi
     * cancelado" com o motivo — sem falar de dinheiro. Falha vai para `errors`
     * e entra no `pular` da tela, como os reembolsos.
     */
    const filaGratis = (await this.pedidosGratisACancelar(eventId)).filter((id) => !pular.has(id));
    const loteGratis = filaGratis.slice(0, EventsService.LOTE_GRATIS);
    let freeCanceledNow = 0;
    for (const orderId of loteGratis) {
      try {
        await cancelarPedidoGratis(orderId, actorUserId, `Evento cancelado — ${input.reason}`, {
          origem: "evento_cancelado",
          aviso: { tipo: "evento", motivo: input.reason },
        });
        freeCanceledNow++;
      } catch (error) {
        errors.push({ orderId, message: (error as Error).message });
      }
    }

    return {
      canceled: true,
      refundedNow,
      refundedCents,
      feeBackCents,
      /** ingressos grátis cancelados nesta chamada (não entram em refundedNow: não houve dinheiro) */
      freeCanceledNow,
      /** ainda por tentar (reembolsos + grátis), já sem os que a tela mandou pular */
      remaining:
        Math.max(fila.length - lote.length, 0) + Math.max(filaGratis.length - loteGratis.length, 0),
      errors,
    };
  }

}
