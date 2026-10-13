import {
  DOMINIO_ANONIMO,
  NOME_REMOVIDO,
  Prisma,
  apagarDadosDosIngressos,
  apagarEmailDosConvitesDeEventoEncerrado,
  apagarParticipantesDosPedidos,
  apagarReservasVipDeEventoEncerrado,
  ehEmailAnonimo,
  emailAnonimoDaConta,
  eventoJaTerminou,
  limparDadoPessoalDaAuditoria,
  prisma,
} from "@borafest/database";
import { semEmailReal } from "@borafest/contracts";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "anonimizar-contas-apagadas" });

/**
 * ANONIMIZAÇÃO DEPOIS DO EVENTO (LGPD, 2026-10-12).
 *
 * A exclusão de conta (MeService.deleteAccount) apaga na hora tudo que é de
 * evento que JÁ TERMINOU e deixa valendo o que é de evento futuro: ingresso
 * (nome, e-mail e CPF na portaria), participante do pedido, reserva VIP e
 * convite por e-mail. Esta varredura faz o resto quando o evento termina, com
 * as MESMAS funções (@borafest/database, anonimizacao-conta.ts).
 *
 * Como acha o que é da pessoa depois que o e-mail dela sumiu:
 *  - pedidos: a exclusão trocou o e-mail de todos pelo anônimo da conta
 *    (`apagado-<id>@anon.borafest.invalid`);
 *  - ingressos: os desses pedidos (menos os passados a outra conta) e os que
 *    ela recebeu por transferência (dono = a conta);
 *  - reserva VIP e convite: a regra da exclusão é "com o e-mail da conta".
 *    Ele é remontado só do que prova que era o da conta — convite e entrega
 *    de ingresso cuja mensagem a exclusão passou para o anônimo, e ingresso
 *    recebido por transferência — e vale para o que foi criado ATÉ a
 *    exclusão. E-mail digitado num pedido que não era o da conta não entra
 *    (a exclusão também não mexeria).
 * Isso tudo é descoberto UMA vez (1ª passada, logo depois da exclusão,
 * enquanto os ingressos do evento futuro ainda têm o e-mail); o que ainda vai
 * acontecer fica anotado pelos ids — sem dado pessoal — na auditoria desta
 * varredura (`pendentes`), e as passadas seguintes só olham esses ids e os
 * pedidos. Quando nada dela sobra em evento futuro, a auditoria marca
 * `concluida` e a conta sai da varredura.
 *
 * Limite conhecido: reserva VIP de evento futuro de quem não deixou nenhuma
 * dessas provas do e-mail (só a reserva, sem ingresso entregue nem convite)
 * não tem como ser achada depois da exclusão — o e-mail era a única ligação.
 */

/** Ação da auditoria gravada na conta (entityType "user") por esta varredura. */
export const ACAO_ANONIMIZACAO_POS_EVENTO = "system.account.anonymize_after_event";

/** Contas olhadas por rodada (as excluídas mais recentes primeiro). */
const CONTAS_POR_RODADA = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ContaApagada = { userId: string; apagadaEm: Date };

export type ResultadoDaConta = {
  ingressos: number;
  participantes: number;
  reservasVip: number;
  convites: number;
  /** ids (sem dado pessoal) do que é dela em evento que ainda não terminou */
  pendentes: { ingressosRecebidos: string[]; reservasVip: string[]; convites: string[] };
  /** nada dela sobra em evento futuro: a conta sai da varredura */
  concluida: boolean;
};

export type ResumoDaRodada = {
  contas: number;
  ingressos: number;
  participantes: number;
  reservasVip: number;
  convites: number;
  concluidas: number;
};

/** O que as auditorias anteriores desta varredura deixaram anotado para a conta. */
export type Anotacoes = {
  /** nenhuma passada ainda: é a 1ª (descobre tudo que é da pessoa) */
  primeiraPassada: boolean;
  concluida: boolean;
  ingressosRecebidos: string[];
  reservasVip: string[];
  convites: string[];
};

function idsValidos(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((id): id is string => typeof id === "string" && UUID.test(id));
}

/** Junta o que as auditorias desta varredura anotaram (metadata livre: lê com cuidado). */
export function lerAnotacoes(metadatas: Prisma.JsonValue[]): Anotacoes {
  const ingressosRecebidos = new Set<string>();
  const reservasVip = new Set<string>();
  const convites = new Set<string>();
  let concluida = false;
  for (const metadata of metadatas) {
    if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) continue;
    if (metadata.concluida === true) concluida = true;
    const pendentes = metadata.pendentes;
    if (pendentes === null || typeof pendentes !== "object" || Array.isArray(pendentes)) continue;
    for (const id of idsValidos(pendentes.ingressosRecebidos)) ingressosRecebidos.add(id);
    for (const id of idsValidos(pendentes.reservasVip)) reservasVip.add(id);
    for (const id of idsValidos(pendentes.convites)) convites.add(id);
  }
  return {
    primeiraPassada: metadatas.length === 0,
    concluida,
    ingressosRecebidos: [...ingressosRecebidos],
    reservasVip: [...reservasVip],
    convites: [...convites],
  };
}

/**
 * E-mails da conta remontados dos registros que provam isso (ingresso
 * entregue a ela, ingresso recebido, convite), como gravados e em minúsculo —
 * igual à exclusão, que procura o e-mail como estava e em minúsculo. Fora:
 * vazio, anônimo (conta apagada) e sintético (venda na porta, lista).
 */
export function emailsDaPessoa(valores: Array<string | null | undefined>): string[] {
  const emails = new Set<string>();
  for (const valor of valores) {
    const email = valor?.trim();
    if (!email || !email.includes("@") || ehEmailAnonimo(email) || semEmailReal(email)) continue;
    emails.add(email);
    emails.add(email.toLowerCase());
  }
  return [...emails];
}

/**
 * Contas excluídas (formato atual do e-mail anônimo, id inteiro) que ainda não
 * foram concluídas por esta varredura. Parte da auditoria `account.delete` —
 * a exclusão grava uma por conta, na mesma transação — e traz a hora da
 * exclusão (o que foi criado depois não é da conta apagada).
 */
export async function contasApagadasPendentes(limite: number): Promise<ContaApagada[]> {
  return prisma.$queryRaw<ContaApagada[]>`
    WITH apagadas AS MATERIALIZED (
      SELECT entity_id::uuid AS user_id, MAX(created_at) AS apagada_em
      FROM audit_logs
      WHERE entity_type = 'user'
        AND action = 'account.delete'
        AND entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      GROUP BY entity_id
    )
    SELECT a.user_id::text AS "userId", a.apagada_em AS "apagadaEm"
    FROM apagadas a
    JOIN users u ON u.id = a.user_id
    WHERE u.email = 'apagado-' || u.id::text || '@' || ${DOMINIO_ANONIMO}::text
      AND NOT EXISTS (
        SELECT 1
        FROM audit_logs f
        WHERE f.entity_type = 'user'
          AND f.entity_id = a.user_id::text
          AND f.action = ${ACAO_ANONIMIZACAO_POS_EVENTO}
          AND f.metadata ->> 'concluida' = 'true'
      )
    ORDER BY a.apagada_em DESC
    LIMIT ${limite}
  `;
}

type IngressoDaPessoa = {
  id: string;
  orderId: string;
  ownerUserId: string | null;
  attendeeName: string | null;
  attendeeEmail: string | null;
  attendeeCpf: string | null;
  event: { endsAt: Date };
};

const temDado = (ingresso: IngressoDaPessoa) =>
  ingresso.attendeeName !== null || ingresso.attendeeEmail !== null || ingresso.attendeeCpf !== null;

const fimDoConvite = (convite: { ticketLot: { ticketType: { event: { endsAt: Date } } } }) =>
  convite.ticketLot.ticketType.event.endsAt;

/**
 * Uma conta: anonimiza o que é dela de evento que já terminou e anota o resto.
 * Transação só (ou tudo, ou nada) com a linha da conta travada: duas rodadas
 * ao mesmo tempo (duas réplicas do worker) esperam uma pela outra, e a 2ª
 * encontra o trabalho feito. Devolve null quando não há o que fazer (a conta
 * não é mais de exclusão, ou já foi concluída).
 */
export async function anonimizarContaApagada(conta: ContaApagada, agora: Date): Promise<ResultadoDaConta | null> {
  const { userId, apagadaEm } = conta;
  const emailAnonimo = emailAnonimoDaConta(userId);
  const terminou = (endsAt: Date) => eventoJaTerminou(endsAt, agora);

  return prisma.$transaction(
    async (tx) => {
      const [linha] = await tx.$queryRaw<Array<{ email: string | null; emailVerificado: boolean }>>`
        SELECT email, (email_verified_at IS NOT NULL) AS "emailVerificado"
        FROM users WHERE id = ${userId}::uuid FOR UPDATE
      `;
      if (!linha || linha.email !== emailAnonimo) return null;

      const anteriores = await tx.auditLog.findMany({
        where: { entityType: "user", entityId: userId, action: ACAO_ANONIMIZACAO_POS_EVENTO },
        select: { metadata: true },
      });
      const anotacoes = lerAnotacoes(anteriores.map((a) => a.metadata));
      if (anotacoes.concluida) return null;
      const primeira = anotacoes.primeiraPassada;

      // 1. pedidos dela: a exclusão pôs o e-mail anônimo da conta em todos
      const pedidos = await tx.$queryRaw<Array<{ id: string; endsAt: Date }>>`
        SELECT o.id, e.ends_at AS "endsAt"
        FROM orders o
        JOIN events e ON e.id = o.event_id
        WHERE o.contact_email = ${emailAnonimo} OR o.user_id = ${userId}::uuid
      `;
      const pedidoIds = pedidos.map((p) => p.id);
      const pedidosEncerrados = pedidos.filter((p) => terminou(p.endsAt)).map((p) => p.id);

      // 2. ingressos dela (mesmo filtro da exclusão): os dos pedidos dela que
      // não foram passados a outra conta, mais os que ela recebeu. Os
      // recebidos só se acham pelo dono (sem índice): 1ª passada procura,
      // as seguintes usam os ids anotados
      const recebidos: Prisma.TicketWhereInput = primeira
        ? { ownerUserId: userId }
        : { id: { in: anotacoes.ingressosRecebidos }, ownerUserId: userId };
      const ingressos: IngressoDaPessoa[] = await tx.ticket.findMany({
        where: {
          OR: [{ orderId: { in: pedidoIds }, OR: [{ ownerUserId: null }, { ownerUserId: userId }] }, recebidos],
        },
        select: {
          id: true,
          orderId: true,
          ownerUserId: true,
          attendeeName: true,
          attendeeEmail: true,
          attendeeCpf: true,
          event: { select: { endsAt: true } },
        },
      });
      const ingressosEncerrados = ingressos.filter((i) => terminou(i.event.endsAt));
      const ingressosParaApagar = ingressosEncerrados.filter(temDado).map((i) => i.id);
      // recebido por transferência (pedido de outra pessoa) de evento futuro:
      // fica anotado para as próximas passadas
      const pedidoSet = new Set(pedidoIds);
      const ingressosRecebidosPendentes = ingressos
        .filter((i) => !terminou(i.event.endsAt) && i.ownerUserId === userId && !pedidoSet.has(i.orderId))
        .map((i) => i.id);

      // 3. convites e reservas VIP — a regra da exclusão é "com o e-mail da
      // CONTA". Esse e-mail sumiu; na 1ª passada ele é remontado SÓ do que
      // prova que era o da conta (e-mail parecido, digitado num pedido ou
      // de outra pessoa não entra):
      //  (a) convite cuja mensagem foi para ela — a exclusão trocou o
      //      destinatário (e-mail da conta) pelo anônimo;
      //  (b) ingresso de pedido dela cuja entrega por e-mail foi para ela
      //      (mesma troca): o e-mail do ingresso é o mesmo da entrega;
      //  (c) ingresso recebido por transferência (pedido de outra pessoa): a
      //      transferência grava o e-mail da conta de quem recebe.
      // Com esses e-mails: reservas VIP e convites criados ATÉ a exclusão.
      // Passadas seguintes: os ids anotados.
      let conviteIds = [...anotacoes.convites];
      let emailsBusca: string[] = [];
      // conta que nunca provou o e-mail (revisão 2026-10-13, mesma regra da
      // exclusão): o e-mail pode ser de outra pessoa — nada é ligado por ele
      // (reservas VIP e convites ficam); o resto segue pelo id da conta
      if (primeira && linha.emailVerificado) {
        const convitesDaMensagem = await tx.$queryRaw<Array<{ id: string; email: string }>>`
          SELECT i.id, i.email
          FROM lot_email_invites i
          JOIN notifications n ON n.id = i.notification_id
          WHERE n.recipient = ${emailAnonimo}
        `;
        const entregasParaEla = pedidoIds.length
          ? await tx.notification.findMany({
              where: { orderId: { in: pedidoIds }, channel: "EMAIL", template: "ticket_delivery", recipient: emailAnonimo },
              select: { orderId: true },
              distinct: ["orderId"],
            })
          : [];
        const pedidosConfirmados = new Set(entregasParaEla.map((n) => n.orderId).filter((id): id is string => Boolean(id)));
        const emailsDosIngressos = ingressos
          .filter((i) => pedidosConfirmados.has(i.orderId) || (i.ownerUserId === userId && !pedidoSet.has(i.orderId)))
          .map((i) => i.attendeeEmail);
        conviteIds = [...new Set([...conviteIds, ...convitesDaMensagem.map((c) => c.id)])];
        emailsBusca = emailsDaPessoa([...emailsDosIngressos, ...convitesDaMensagem.map((c) => c.email)]);
      }

      const quemConvite: Prisma.LotEmailInviteWhereInput[] = [];
      if (conviteIds.length) quemConvite.push({ id: { in: conviteIds } });
      if (emailsBusca.length) quemConvite.push({ email: { in: emailsBusca }, createdAt: { lte: apagadaEm } });
      const convites = quemConvite.length
        ? await tx.lotEmailInvite.findMany({
            where: { OR: quemConvite, NOT: { email: { endsWith: `@${DOMINIO_ANONIMO}` } } },
            select: { id: true, ticketLot: { select: { ticketType: { select: { event: { select: { endsAt: true } } } } } } },
          })
        : [];

      const quemVip: Prisma.VipReservationWhereInput[] = [];
      if (anotacoes.reservasVip.length) quemVip.push({ id: { in: anotacoes.reservasVip } });
      if (emailsBusca.length) quemVip.push({ contactEmail: { in: emailsBusca }, createdAt: { lte: apagadaEm } });
      const reservas = quemVip.length
        ? await tx.vipReservation.findMany({
            where: { OR: quemVip, NOT: { contactEmail: { endsWith: `@${DOMINIO_ANONIMO}` } } },
            select: { id: true, inventory: { select: { event: { select: { endsAt: true } } } } },
          })
        : [];

      // 4. participantes de pedido de evento que terminou que ainda têm nome ou CPF
      const participantes = pedidosEncerrados.length
        ? await tx.orderAttendee.findMany({
            where: { orderId: { in: pedidosEncerrados }, OR: [{ cpf: { not: null } }, { name: { not: NOME_REMOVIDO } }] },
            select: { orderId: true },
            distinct: ["orderId"],
          })
        : [];

      // 5. grava — mesmas funções da exclusão de conta
      const ingressosApagados = await apagarDadosDosIngressos(tx, ingressosParaApagar);
      const participantesApagados = await apagarParticipantesDosPedidos(
        tx,
        participantes.map((p) => p.orderId),
      );
      const reservasApagadas = await apagarReservasVipDeEventoEncerrado(tx, {
        ids: reservas.filter((r) => terminou(r.inventory.event.endsAt)).map((r) => r.id),
        emailAnonimo,
        agora,
      });
      const convitesApagados = await apagarEmailDosConvitesDeEventoEncerrado(tx, {
        ids: convites.filter((c) => terminou(fimDoConvite(c))).map((c) => c.id),
        agora,
      });

      // 6. auditoria ligada ao que terminou (pedido, ingresso, convite): o
      // registro fica, sem nome, e-mail e documento — como na exclusão
      const auditoriasLigadas: Prisma.AuditLogWhereInput[] = [];
      if (pedidosEncerrados.length) auditoriasLigadas.push({ entityType: "order", entityId: { in: pedidosEncerrados } });
      if (ingressosEncerrados.length) {
        auditoriasLigadas.push({ entityType: "ticket", entityId: { in: ingressosEncerrados.map((i) => i.id) } });
      }
      if (convitesApagados.length) auditoriasLigadas.push({ entityType: "lot_email_invite", entityId: { in: convitesApagados } });
      if (auditoriasLigadas.length) await limparDadoPessoalDaAuditoria(tx, { OR: auditoriasLigadas });

      // 7. o que sobra em evento futuro (sem dado pessoal: só ids)
      const pendentes = {
        ingressosRecebidos: ingressosRecebidosPendentes,
        reservasVip: reservas.filter((r) => !terminou(r.inventory.event.endsAt)).map((r) => r.id),
        convites: convites.filter((c) => !terminou(fimDoConvite(c))).map((c) => c.id),
      };
      const concluida =
        pedidos.every((p) => terminou(p.endsAt)) &&
        ingressos.every((i) => terminou(i.event.endsAt)) &&
        pendentes.reservasVip.length === 0 &&
        pendentes.convites.length === 0;

      const resultado: ResultadoDaConta = {
        ingressos: ingressosApagados,
        participantes: participantesApagados,
        reservasVip: reservasApagadas,
        convites: convitesApagados.length,
        pendentes,
        concluida,
      };
      const mexeu =
        resultado.ingressos + resultado.participantes + resultado.reservasVip + resultado.convites > 0;
      // 1ª passada grava sempre (é ela que guarda os pendentes); depois, só
      // quando apagou algo ou concluiu — nada de uma linha por hora por conta
      if (primeira || mexeu || concluida) {
        await tx.auditLog.create({
          data: {
            actorUserId: null,
            action: ACAO_ANONIMIZACAO_POS_EVENTO,
            entityType: "user",
            entityId: userId,
            metadata: resultado as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return resultado;
    },
    // várias tabelas numa transação só: o padrão de 5 s do Prisma é curto
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/**
 * Varredura periódica (worker, fila de pedidos). Cada conta na sua transação:
 * a que falhar não segura as outras, mas a rodada termina com erro (com a
 * contagem) — falha nunca vira "nada a fazer".
 */
export async function anonimizarContasApagadas(agora: Date = new Date()): Promise<ResumoDaRodada> {
  const contas = await contasApagadasPendentes(CONTAS_POR_RODADA);
  const resumo: ResumoDaRodada = { contas: 0, ingressos: 0, participantes: 0, reservasVip: 0, convites: 0, concluidas: 0 };
  if (contas.length === 0) return resumo;
  if (contas.length === CONTAS_POR_RODADA) {
    log.warn({ limite: CONTAS_POR_RODADA }, "mais contas excluídas pendentes que o limite da rodada; o resto fica para as próximas");
  }

  let falhas = 0;
  for (const conta of contas) {
    try {
      const r = await anonimizarContaApagada(conta, agora);
      if (!r) continue;
      resumo.contas++;
      resumo.ingressos += r.ingressos;
      resumo.participantes += r.participantes;
      resumo.reservasVip += r.reservasVip;
      resumo.convites += r.convites;
      if (r.concluida) resumo.concluidas++;
    } catch (error) {
      falhas++;
      log.error(
        { userId: conta.userId, error: (error as Error).message },
        "anonimização depois do evento falhou; a conta tenta de novo na próxima rodada",
      );
    }
  }

  if (resumo.ingressos + resumo.participantes + resumo.reservasVip + resumo.convites + resumo.concluidas > 0) {
    log.info(resumo, "contas excluídas: dados de evento que terminou anonimizados");
  }
  if (falhas > 0) {
    throw new Error(
      `Anonimização depois do evento: ${falhas} de ${contas.length} conta(s) falharam — tentam de novo na próxima rodada`,
    );
  }
  return resumo;
}
