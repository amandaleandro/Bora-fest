import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  Prisma,
  prisma,
  apagarDadosDosIngressos,
  apagarEmailDosConvitesDeEventoEncerrado,
  apagarParticipantesDosPedidos,
  apagarReservasVipDeEventoEncerrado,
} from "@borafest/database";
import { isValidCpf } from "@borafest/auth";
import {
  DOMINIO_ANONIMO,
  ENVIO_CANCELADO,
  contaJaApagada,
  emailAnonimoDaConta,
  eventoJaTerminou,
  mudou,
  semDadoPessoal,
} from "./exclusao-de-conta";

/** Pedido da pessoa e quando o evento dele termina (decide o que pode ser apagado). */
type PedidoDaPessoa = { id: string; endsAt: Date };

/**
 * Pedidos da pessoa: os da conta e os feitos SEM login com o e-mail dela (nascem
 * sem dono). A comparação do e-mail ignora maiúsculas e é feita em SQL: o
 * `mode: "insensitive"` do Prisma vira ILIKE, e o `_` (comum em e-mail) casaria
 * com qualquer letra — pegaria pedido de outra pessoa.
 */
async function pedidosDaPessoa(
  db: Prisma.TransactionClient,
  userId: string,
  emailMinusculo: string | null,
): Promise<PedidoDaPessoa[]> {
  return db.$queryRaw<PedidoDaPessoa[]>`
    SELECT o.id, e.ends_at AS "endsAt"
    FROM orders o
    JOIN events e ON e.id = o.event_id
    WHERE o.user_id = ${userId}::uuid
       OR (${emailMinusculo}::text IS NOT NULL AND o.user_id IS NULL AND lower(o.contact_email) = ${emailMinusculo}::text)
  `;
}

/**
 * Ingressos da pessoa: os dos pedidos dela que NÃO foram passados a outra
 * conta, mais os que ela recebeu por transferência.
 */
function filtroIngressosDaPessoa(userId: string, pedidoIds: string[]): Prisma.TicketWhereInput {
  return {
    OR: [
      { orderId: { in: pedidoIds }, OR: [{ ownerUserId: null }, { ownerUserId: userId }] },
      { ownerUserId: userId },
    ],
  };
}

/** E-mail e telefone da própria conta (os desafios de código de acesso deles saem na exclusão). */
function destinosDaConta(conta: { email: string | null; phone: string | null }): string[] {
  const lista = [conta.email, conta.email?.trim().toLowerCase(), conta.phone];
  return [...new Set(lista.map((d) => d?.trim()).filter((d): d is string => Boolean(d)))];
}

/**
 * QUAIS MENSAGENS SÃO DELA (revisão 2026-10-13) — mesma regra na exclusão e
 * na exportação:
 *  - pelo e-mail da conta, em qualquer lugar e sem diferença de grafia — SÓ
 *    se o e-mail foi provado (código, link de acesso): conta não verificada
 *    pode ter nascido com o e-mail de outra pessoa;
 *  - dentro dos pedidos dela (order_id): para o e-mail da conta e para os
 *    telefones da conta e desses pedidos. Telefone nunca vale "no sistema
 *    inteiro": o da conta é copiado do que foi digitado na 1ª compra, sem
 *    prova — pode ser de outra pessoa. E-mail DIGITADO num pedido que não é
 *    o da conta também não entra (pode ser de quem ganhou o ingresso; mesma
 *    regra do worker anonimizar-contas-apagadas).
 */
interface MensagensDaPessoa {
  emailProvado: string | null;
  pedidoIds: string[];
  chavesNosPedidos: string[];
}

async function mensagensDaPessoa(
  db: Prisma.TransactionClient,
  conta: { email: string | null; phone: string | null },
  emailProvado: string | null,
  pedidoIds: string[],
): Promise<MensagensDaPessoa> {
  const telefones = pedidoIds.length
    ? (await db.order.findMany({ where: { id: { in: pedidoIds } }, select: { contactPhone: true } })).map(
        (p) => p.contactPhone,
      )
    : [];
  const chaves = [conta.email, conta.phone, ...telefones]
    .map((d) => d?.trim().toLowerCase())
    .filter((d): d is string => Boolean(d));
  return { emailProvado, pedidoIds, chavesNosPedidos: [...new Set(chaves)] };
}

/** WHERE das mensagens dela (null = nenhuma). */
function ondeMensagensDela(m: MensagensDaPessoa): Prisma.Sql | null {
  const partes: Prisma.Sql[] = [];
  if (m.emailProvado) partes.push(Prisma.sql`lower(trim(recipient)) = ${m.emailProvado}`);
  if (m.pedidoIds.length > 0 && m.chavesNosPedidos.length > 0) {
    partes.push(
      Prisma.sql`(order_id IN (${Prisma.join(m.pedidoIds.map((id) => Prisma.sql`${id}::uuid`))}) AND lower(trim(recipient)) IN (${Prisma.join(m.chavesNosPedidos)}))`,
    );
  }
  return partes.length > 0 ? Prisma.sql`(${Prisma.join(partes, " OR ")})` : null;
}

/** JSON limpo pronto para gravar numa coluna que aceita vazio. */
function jsonOuVazio(valor: Prisma.JsonValue): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return valor === null ? Prisma.DbNull : (valor as Prisma.InputJsonValue);
}

/** O que a anonimização fez — vai para a auditoria da exclusão. */
export type ResumoDaAnonimizacao = {
  pedidos: number;
  ingressosAnonimizados: number;
  ingressosDeEventoFuturoMantidos: number;
};

/**
 * ANONIMIZAÇÃO COMPLETA de uma conta (LGPD, 2026-10-12), dentro da transação
 * de quem chama — que já travou a linha da conta (FOR UPDATE) e conferiu que
 * ela ainda não foi anonimizada. `conta` traz o e-mail e o telefone ORIGINAIS:
 * são eles que ligam os pedidos feitos sem login, a fidelidade, os convites e
 * as mensagens. Usada pela exclusão de conta (MeService.deleteAccount) e pelo
 * script das contas apagadas antes desta data
 * (scripts/lgpd-contas-apagadas-antes.ts) — uma regra só para as duas. Não
 * grava a auditoria da exclusão: cada chamador grava a sua.
 */
export async function anonimizarConta(
  tx: Prisma.TransactionClient,
  userId: string,
  conta: { email: string | null; phone: string | null; emailVerificado: boolean },
  agora: Date,
): Promise<ResumoDaAnonimizacao> {
  const emailAnonimo = emailAnonimoDaConta(userId);
  // o e-mail original é lido ANTES de anonimizar: é ele que liga os
  // pedidos feitos sem login, a fidelidade, os convites e as mensagens —
  // e só quando foi PROVADO (revisão 2026-10-13): conta não verificada fica
  // com o que tem o id dela, e nada do que só tem o e-mail
  const emailMinusculo = conta.email?.trim().toLowerCase() || null;
  const emailProvado = conta.emailVerificado ? emailMinusculo : null;
  const emails = emailProvado
    ? [...new Set([conta.email, emailProvado].filter((e): e is string => Boolean(e)))]
    : [];

  const pedidos = await pedidosDaPessoa(tx, userId, emailProvado);
  const pedidoIds = pedidos.map((p) => p.id);
  const destinos = destinosDaConta(conta);
  // telefones dos pedidos lidos ANTES do passo 3 (que os apaga)
  const mensagens = await mensagensDaPessoa(tx, conta, emailProvado, pedidoIds);
  const pedidosEncerrados = pedidos.filter((p) => eventoJaTerminou(p.endsAt, agora)).map((p) => p.id);
  const ingressos = await tx.ticket.findMany({
    where: filtroIngressosDaPessoa(userId, pedidoIds),
    select: { id: true, event: { select: { endsAt: true } } },
  });
  const ingressoIds = ingressos.map((i) => i.id);
  const ingressosEncerrados = ingressos
    .filter((i) => eventoJaTerminou(i.event.endsAt, agora))
    .map((i) => i.id);

  // 1. a conta. O bump de sessionVersion derruba as sessões vivas
  // (auditoria 2026-08-30); emailVerifiedAt fica: é o que mantém aberto o
  // ingresso de evento futuro (portão do 1º ingresso)
  await tx.user.update({
    where: { id: userId },
    data: {
      name: null,
      email: emailAnonimo,
      phone: null,
      cpf: null,
      passwordHash: null,
      totpSecret: null,
      totpEnabledAt: null,
      notifyWhatsapp: false,
      notifyEmailOffers: false,
      sessionVersion: { increment: 1 },
    },
  });

  // 2. jeitos de entrar e de receber aviso: nada disso serve sem a conta
  await tx.userIdentity.deleteMany({ where: { userId } });
  await tx.passwordResetToken.deleteMany({ where: { userId } });
  await tx.otpChallenge.deleteMany({
    where: { OR: [{ userId }, ...(destinos.length > 0 ? [{ destination: { in: destinos } }] : [])] },
  });
  await tx.webPushSubscription.deleteMany({ where: { userId } });
  await tx.pushToken.deleteMany({ where: { orderId: { in: pedidoIds } } });

  // 3. pedidos (todos, inclusive de evento futuro): sem nome, telefone e
  // CPF; o e-mail vira o anônimo da conta — o pedido sem dono deixa de
  // ser reivindicável por quem criar conta com o e-mail antigo
  await tx.order.updateMany({
    where: { id: { in: pedidoIds } },
    data: { contactName: null, contactPhone: null, contactCpf: null, contactEmail: emailAnonimo },
  });

  // 4. ingressos e participantes de evento que JÁ TERMINOU. Ingresso
  // passado a outra conta é da outra pessoa e não entra. Mesma regra
  // (@borafest/database) que o worker usa quando o evento futuro terminar
  await apagarDadosDosIngressos(tx, ingressosEncerrados);
  await apagarParticipantesDosPedidos(tx, pedidosEncerrados);

  // 5. pagamentos: o registro financeiro fica; sai do metadata o que
  // identifica o pagador (payerDocument...) e, do corpo guardado de cada
  // aviso do gateway, o cliente (nome, e-mail, documento)
  const pagamentos = await tx.payment.findMany({
    where: { orderId: { in: pedidoIds } },
    select: { id: true, metadata: true },
  });
  for (const pagamento of pagamentos) {
    if (pagamento.metadata === null) continue;
    const limpo = semDadoPessoal(pagamento.metadata);
    if (mudou(pagamento.metadata, limpo)) {
      await tx.payment.update({ where: { id: pagamento.id }, data: { metadata: jsonOuVazio(limpo) } });
    }
  }
  const avisosDoGateway = pagamentos.length
    ? await tx.paymentEvent.findMany({
        where: { paymentId: { in: pagamentos.map((p) => p.id) } },
        select: { id: true, payload: true },
      })
    : [];
  for (const aviso of avisosDoGateway) {
    const limpo = semDadoPessoal(aviso.payload);
    if (mudou(aviso.payload, limpo)) {
      await tx.paymentEvent.update({
        where: { id: aviso.id },
        data: { payload: (limpo ?? {}) as Prisma.InputJsonValue },
      });
    }
  }

  // 6. aceite dos termos: fica a prova (documento, versão, data), sem IP
  // e navegador
  await tx.consent.updateMany({
    where: { OR: [{ userId }, { orderId: { in: pedidoIds } }] },
    data: { ip: null, userAgent: null },
  });

  // 7. fidelidade: os pontos ficam com a Casa, sem dono — e-mail trocado
  // por um marcador único por conta de fidelidade (índice Casa + e-mail)
  await tx.$executeRaw`
    UPDATE loyalty_accounts
    SET email_key = 'apagado-' || id::text || '@' || ${DOMINIO_ANONIMO}::text,
        display_name = NULL,
        user_id = CASE WHEN user_id = ${userId}::uuid THEN NULL ELSE user_id END,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ${userId}::uuid
       OR (${emailProvado}::text IS NOT NULL AND email_key = ${emailProvado}::text)
  `;

  // 8. Casas seguidas saem; a avaliação fica só com a nota (o comentário
  // é texto livre dela)
  await tx.organizationFollow.deleteMany({ where: { userId } });
  await tx.eventReview.updateMany({ where: { userId }, data: { comment: null } });

  // 9. mensagens: o que ainda não saiu é cancelado; o que saiu fica como
  // registro (modelo, data, situação) sem destinatário e sem corpo
  // quais são dela: ondeMensagensDela (acima)
  const ondeDela = ondeMensagensDela(mensagens);
  if (ondeDela) {
    await tx.$executeRaw`
      UPDATE notifications SET status = 'FAILED', error = ${ENVIO_CANCELADO}
      WHERE status = 'PENDING' AND ${ondeDela}
    `;
    await tx.$executeRaw`
      UPDATE notifications SET recipient = ${emailAnonimo}, payload = '{}'::jsonb
      WHERE ${ondeDela}
    `;
  }
  // conta que nunca provou o e-mail: as mensagens DA CONTA (sem pedido —
  // código de acesso, CPF definido, transferência, senha) param de sair e
  // perdem o corpo, mas o destinatário fica: o endereço pode ser de outra
  // pessoa, e o histórico dela não some (revisão 2026-10-13)
  if (!emailProvado && emailMinusculo) {
    await tx.$executeRaw`
      UPDATE notifications SET status = 'FAILED', error = ${ENVIO_CANCELADO}
      WHERE status = 'PENDING' AND order_id IS NULL AND lower(trim(recipient)) = ${emailMinusculo}
    `;
    await tx.$executeRaw`
      UPDATE notifications SET payload = '{}'::jsonb
      WHERE order_id IS NULL AND lower(trim(recipient)) = ${emailMinusculo}
    `;
  }
  // aviso já enviado a OUTRA pessoa sobre o pedido dela (produtor, quem
  // recebeu transferência) perde o corpo; o que ainda vai sair não muda
  await tx.notification.updateMany({
    where: { orderId: { in: pedidoIds }, status: { not: "PENDING" } },
    data: { payload: {} },
  });

  // 10. reserva VIP e convite por e-mail de evento que JÁ TERMINOU (mesma
  // regra do ingresso: o de evento futuro segue como está — o worker
  // anonimiza quando ele terminar, pelas mesmas funções)
  await apagarReservasVipDeEventoEncerrado(tx, { emails, emailAnonimo, agora });
  const conviteIds = await apagarEmailDosConvitesDeEventoEncerrado(tx, { emails, agora });

  // 11. auditoria ligada a ela (conta, pedidos, ingressos, convites):
  // o registro fica, sem nome, e-mail e documento no metadata
  const auditorias = await tx.auditLog.findMany({
    where: {
      OR: [
        { entityType: "user", entityId: userId },
        { entityType: "order", entityId: { in: pedidoIds } },
        { entityType: "ticket", entityId: { in: ingressoIds } },
        { entityType: "lot_email_invite", entityId: { in: conviteIds } },
      ],
    },
    select: { id: true, metadata: true },
  });
  for (const auditoria of auditorias) {
    if (auditoria.metadata === null) continue;
    const limpo = semDadoPessoal(auditoria.metadata);
    if (mudou(auditoria.metadata, limpo)) {
      await tx.auditLog.update({ where: { id: auditoria.id }, data: { metadata: jsonOuVazio(limpo) } });
    }
  }

  return {
    pedidos: pedidoIds.length,
    ingressosAnonimizados: ingressosEncerrados.length,
    // evento que ainda vai acontecer: o ingresso segue valendo com o nome
    ingressosDeEventoFuturoMantidos: ingressos.length - ingressosEncerrados.length,
  };
}

@Injectable()
export class MeService {
  async profile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        cpf: true,
        passwordHash: true,
        notifyWhatsapp: true,
        notifyEmailOffers: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException("Usuário não encontrado");
    const { passwordHash, ...publico } = user;
    return {
      ...publico,
      // conta VERIFICADA = tem CPF (recebe/transfere ingresso nominal)
      verified: Boolean(user.cpf),
      // tem senha = já consegue entrar no PAINEL; sem senha = 1º acesso cria uma
      hasPassword: Boolean(passwordHash),
    };
  }

  /**
   * Verificação da conta (decisão 2026-08-15): quem loga sem nunca ter
   * comprado pode informar o CPF aqui e ficar apto a RECEBER transferências.
   * CPF é definido UMA vez (trocar depois = suporte, anti-fraude) e é único.
   */
  async updateMe(
    userId: string,
    input: { name?: string; cpf?: string; notifyWhatsapp?: boolean; notifyEmailOffers?: boolean },
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Usuário não encontrado");

    let cpf: string | undefined;
    if (input.cpf !== undefined) {
      const digits = input.cpf.replace(/\D/g, "");
      if (digits.length !== 11) throw new BadRequestException("CPF inválido — são 11 dígitos");
      // dígitos verificadores: pega praticamente qualquer erro de digitação
      if (!isValidCpf(digits)) {
        throw new BadRequestException("CPF inválido — confira os números digitados");
      }
      if (user.cpf && user.cpf !== digits) {
        throw new BadRequestException("CPF já definido nesta conta — para trocar, fale com o suporte");
      }
      if (!user.cpf) {
        const dono = await prisma.user.findUnique({ where: { cpf: digits } });
        if (dono && dono.id !== userId) {
          throw new BadRequestException("Este CPF já está em outra conta BoraFest");
        }
        cpf = digits;
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(cpf ? { cpf } : {}),
        ...(input.notifyWhatsapp !== undefined ? { notifyWhatsapp: input.notifyWhatsapp } : {}),
        ...(input.notifyEmailOffers !== undefined ? { notifyEmailOffers: input.notifyEmailOffers } : {}),
      },
      select: { id: true, name: true, email: true, phone: true, cpf: true, notifyWhatsapp: true, notifyEmailOffers: true },
    });

    // trilha de segurança (2026-08-15): CPF recém-definido gera aviso por
    // e-mail — "se não foi você, fale com o suporte". Best-effort.
    if (cpf && updated.email) {
      await prisma.notification
        .create({
          data: {
            channel: "EMAIL",
            recipient: updated.email,
            template: "cpf_defined",
            payload: { cpfMasked: `${cpf.slice(0, 3)}.***.***-${cpf.slice(9)}`, name: updated.name },
          },
        })
        .catch(() => undefined);
    }
    return { ...updated, verified: Boolean(updated.cpf) };
  }

  async orders(userId: string) {
    return this.listarPedidos({ userId });
  }

  /** Mesma lista de "Minhas compras" — também usada pela exportação de dados. */
  private async listarPedidos(where: Prisma.OrderWhereInput) {
    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        publicToken: true,
        status: true,
        totalCents: true,
        discountCents: true,
        createdAt: true,
        event: { select: { title: true, slug: true, startsAt: true, endsAt: true } },
        items: { select: { quantity: true, ticketLot: { select: { name: true } } } },
        // só o último pedido de reembolso importa para a tela (2026-10-13)
        refundRequests: {
          orderBy: { requestedAt: "desc" },
          take: 1,
          select: { status: true, resolutionNote: true },
        },
      },
    });
    // o app mostra "reembolso em análise" e trava o botão com esta flag; a
    // situação do último pedido diz também "recusado" (com o motivo que o
    // comprador já recebeu por e-mail) e "aprovado"
    return orders.map(({ refundRequests, ...order }) => {
      const ultimo = refundRequests[0] ?? null;
      return {
        ...order,
        refundRequested: ultimo?.status === "PENDING",
        refundRequestStatus: ultimo?.status ?? null,
        refundRequestNote: ultimo?.status === "REJECTED" ? ultimo.resolutionNote : null,
      };
    });
  }

  /**
   * LGPD: portabilidade — tudo que temos sobre o titular, em JSON. Pedidos da
   * conta e os feitos sem login com o mesmo e-mail. Pagamentos sem o metadata
   * (cartão não é guardado; o metadata é do gateway). Mensagens (e-mail,
   * WhatsApp) só com modelo, data e situação: o corpo não sai — pode levar
   * link de acesso. Erro em qualquer parte derruba a exportação inteira: um
   * arquivo com "nenhum ponto" porque a consulta falhou seria mentira.
   */
  async dataExport(userId: string) {
    const user = await this.profile(userId);
    // mesma regra da exclusão (revisão 2026-10-13): o que só tem o e-mail
    // (pedido sem login, fidelidade, mensagens) entra só com o e-mail PROVADO
    const { emailVerifiedAt } = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    const emailMinusculo = (emailVerifiedAt && user.email?.trim().toLowerCase()) || null;
    const pedidos = await pedidosDaPessoa(prisma, userId, emailMinusculo);
    const pedidoIds = pedidos.map((p) => p.id);
    const ondeDela = ondeMensagensDela(await mensagensDaPessoa(prisma, user, emailMinusculo, pedidoIds));

    const [orders, tickets, payments, loyalty, reviews, follows, consents, emails] = await Promise.all([
      this.listarPedidos({ id: { in: pedidoIds } }),
      prisma.ticket.findMany({
        where: filtroIngressosDaPessoa(userId, pedidoIds),
        select: { id: true, code: true, status: true, issuedAt: true, attendeeName: true },
      }),
      prisma.payment.findMany({
        where: { orderId: { in: pedidoIds } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          orderId: true,
          method: true,
          status: true,
          amountCents: true,
          installments: true,
          paidAt: true,
          createdAt: true,
        },
      }),
      this.fidelidadeParaExportar(userId, emailMinusculo),
      prisma.eventReview.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { rating: true, comment: true, createdAt: true, event: { select: { title: true, slug: true } } },
      }),
      prisma.organizationFollow.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, organization: { select: { name: true, displayName: true, slug: true } } },
      }),
      prisma.consent.findMany({
        where: { OR: [{ userId }, { orderId: { in: pedidoIds } }] },
        orderBy: { acceptedAt: "desc" },
        select: { document: true, version: true, acceptedAt: true, orderId: true, ip: true, userAgent: true },
      }),
      ondeDela
        ? prisma.$queryRaw<
            Array<{
              channel: string;
              template: string;
              status: string;
              createdAt: Date;
              sentAt: Date | null;
              deliveredAt: Date | null;
              bouncedAt: Date | null;
            }>
          >`
            SELECT channel::text AS channel, template, status::text AS status, created_at AS "createdAt",
                   sent_at AS "sentAt", delivered_at AS "deliveredAt", bounced_at AS "bouncedAt"
            FROM notifications
            WHERE ${ondeDela}
            ORDER BY created_at DESC
          `
        : Promise.resolve([]),
    ]);

    return {
      exportedAt: new Date(),
      user,
      orders,
      tickets,
      payments,
      loyalty,
      reviews,
      followedHouses: follows.map((f) => ({
        name: f.organization.displayName ?? f.organization.name,
        slug: f.organization.slug,
        followedAt: f.createdAt,
      })),
      consents,
      emails,
    };
  }

  /** Pontos de fidelidade por Casa: saldo, lançamentos e resgates (tabelas em SQL cru). */
  private async fidelidadeParaExportar(userId: string, emailMinusculo: string | null) {
    const contas = await prisma.$queryRaw<
      Array<{ accountId: string; organizationName: string; organizationSlug: string; points: bigint | null }>
    >`
      SELECT
        a.id AS "accountId",
        COALESCE(o.display_name, o.name) AS "organizationName",
        o.slug AS "organizationSlug",
        COALESCE(SUM(e.delta_points), 0)::bigint AS points
      FROM loyalty_accounts a
      JOIN organizations o ON o.id = a.organization_id
      LEFT JOIN loyalty_entries e ON e.loyalty_account_id = a.id
      WHERE a.user_id = ${userId}::uuid
         OR (${emailMinusculo}::text IS NOT NULL AND a.email_key = ${emailMinusculo}::text)
      GROUP BY a.id, o.id
      ORDER BY "organizationName" ASC
    `;
    if (contas.length === 0) return [];

    const [lancamentos, resgates] = await Promise.all([
      prisma.$queryRaw<
        Array<{ accountId: string; deltaPoints: number; sourceType: string; description: string | null; createdAt: Date }>
      >`
        SELECT
          e.loyalty_account_id AS "accountId",
          e.delta_points AS "deltaPoints",
          e.source_type AS "sourceType",
          e.description,
          e.created_at AS "createdAt"
        FROM loyalty_entries e
        JOIN loyalty_accounts a ON a.id = e.loyalty_account_id
        WHERE a.user_id = ${userId}::uuid
           OR (${emailMinusculo}::text IS NOT NULL AND a.email_key = ${emailMinusculo}::text)
        ORDER BY e.created_at DESC
      `,
      prisma.$queryRaw<
        Array<{
          accountId: string;
          rewardName: string;
          pointsCost: number;
          status: string;
          code: string;
          createdAt: Date;
          usedAt: Date | null;
        }>
      >`
        SELECT
          r.loyalty_account_id AS "accountId",
          rw.name AS "rewardName",
          r.points_cost AS "pointsCost",
          r.status,
          r.code,
          r.created_at AS "createdAt",
          r.used_at AS "usedAt"
        FROM loyalty_redemptions r
        JOIN loyalty_rewards rw ON rw.id = r.reward_id
        JOIN loyalty_accounts a ON a.id = r.loyalty_account_id
        WHERE a.user_id = ${userId}::uuid
           OR (${emailMinusculo}::text IS NOT NULL AND a.email_key = ${emailMinusculo}::text)
        ORDER BY r.created_at DESC
      `,
    ]);

    return contas.map((conta) => ({
      house: conta.organizationName,
      houseSlug: conta.organizationSlug,
      points: Number(conta.points ?? 0n),
      entries: lancamentos
        .filter((l) => l.accountId === conta.accountId)
        .map(({ accountId: _conta, ...lancamento }) => lancamento),
      redemptions: resgates
        .filter((r) => r.accountId === conta.accountId)
        .map(({ accountId: _conta, ...resgate }) => resgate),
    }));
  }

  /**
   * LGPD/Apple 5.1.1(v): exclusão de conta — anonimização IMEDIATA, numa
   * transação só (ou sai tudo, ou nada muda). Registros financeiros e de
   * auditoria continuam, sem identificação. O que fica de propósito:
   * - ingresso de evento que AINDA VAI ACONTECER segue valendo como antes,
   *   com nome/CPF na portaria (decisão pendente do Arthur);
   * - nota da avaliação (o comentário sai), pontos de fidelidade (sem dono),
   *   pagamentos, lançamentos e auditoria (sem nome, e-mail, documento, IP).
   * Clique duplo / duas abas: a linha da conta fica travada até o fim; a 2ª
   * chamada espera e encontra a conta já apagada — não refaz nem duplica a
   * auditoria.
   */
  async deleteAccount(userId: string) {
    return prisma.$transaction(
      async (tx) => {
        const [conta] = await tx.$queryRaw<
          Array<{ email: string | null; phone: string | null; emailVerificado: boolean }>
        >`
          SELECT email, phone, (email_verified_at IS NOT NULL) AS "emailVerificado"
          FROM users WHERE id = ${userId}::uuid FOR UPDATE
        `;
        if (!conta) throw new NotFoundException("Usuário não encontrado");
        if (contaJaApagada(userId, conta.email)) return { deleted: true };

        const resumo = await anonimizarConta(tx, userId, conta, new Date());
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: "account.delete",
            entityType: "user",
            entityId: userId,
            metadata: resumo,
          },
        });
        return { deleted: true };
      },
      // muitas tabelas numa transação só: o padrão de 5 s do Prisma é curto
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  /**
   * Salva a inscrição de Web Push do navegador/PWA (gamificação de vendas). O
   * endpoint é único: o MESMO aparelho re-inscrevendo apenas atualiza as chaves
   * e o dono (upsert por endpoint).
   */
  async savePushSubscription(
    userId: string,
    input: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; userAgent?: string },
  ) {
    const endpoint = input.endpoint?.trim();
    const p256dh = input.keys?.p256dh;
    const auth = input.keys?.auth;
    if (!endpoint || !p256dh || !auth) {
      throw new BadRequestException("Inscrição de push inválida");
    }
    await prisma.webPushSubscription.upsert({
      where: { endpoint },
      update: { userId, p256dh, auth, userAgent: input.userAgent ?? null },
      create: { userId, endpoint, p256dh, auth, userAgent: input.userAgent ?? null },
    });
    return { subscribed: true };
  }

  async removePushSubscription(userId: string, endpoint: string) {
    if (!endpoint) return { removed: false };
    // só remove a inscrição do PRÓPRIO usuário (não apaga a de outra conta)
    await prisma.webPushSubscription.deleteMany({ where: { endpoint, userId } });
    return { removed: true };
  }
}
