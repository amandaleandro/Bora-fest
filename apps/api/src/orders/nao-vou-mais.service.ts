import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { cancelarPedidoGratis } from "../common/cancelar-pedido-gratis";

/**
 * "NÃO VOU MAIS" (decidido em 10/10, tela aprovada em 12/10): quem pegou
 * ingresso GRÁTIS libera a vaga até o evento começar. O QR deixa de valer, a
 * vaga volta ao lote e a pessoa recebe o e-mail "cancelado, como você pediu".
 *
 * A operação é a mesma do "Cancelar ingresso" do produtor
 * (`cancelarPedidoGratis`, origem "comprador") — aqui mora só a porta de
 * entrada do comprador, com as travas que valem para ele:
 *  - sessão do DONO do pedido (order.userId = usuário logado): a posse do link
 *    do pedido não basta para uma ação irreversível — mesmo portão do
 *    reembolso protegido (auditoria 2026-08-30);
 *  - pedido de R$ 0 confirmado (PAID/FULFILLED): pedido pago tem reembolso;
 *  - evento ainda não começou.
 * A trava contra clique duplo é a da operação: só um pedido vira CANCELED.
 */

/** Pedido com o que as travas do "Não vou mais" leem. */
export interface PedidoParaNaoVouMais {
  userId: string | null;
  status: string;
  totalCents: number;
  event: { startsAt: Date };
  items: Array<{ quantity: number }>;
  tickets: Array<{ status: string; ownerUserId: string | null }>;
}

export interface RecusaDoNaoVouMais {
  /** 403 = não é o dono; 400 = o pedido não permite */
  http: 403 | 400;
  mensagem: string;
}

/** Ingresso que ainda vale na porta (os demais já foram usados, cancelados ou estornados). */
const VALENDO_NA_PORTA = ["ISSUED", "ACTIVE"];

/**
 * Quantas vagas o "Não vou mais" liberaria agora: ingressos que ainda valem +
 * os que ainda não foram emitidos (a mesma conta do `cancelarPedidoGratis`).
 */
export function vagasQueVoltariam(order: Pick<PedidoParaNaoVouMais, "items" | "tickets">): number {
  const pedidos = order.items.reduce((soma, item) => soma + item.quantity, 0);
  const valendo = order.tickets.filter((t) => VALENDO_NA_PORTA.includes(t.status)).length;
  const naoEmitidos = Math.max(pedidos - order.tickets.length, 0);
  return valendo + naoEmitidos;
}

/**
 * Por que este usuário NÃO pode liberar a vaga deste pedido agora — null quando
 * pode. Função pura: a mesma regra decide o botão (GET) e a ação (POST).
 */
export function recusaDoNaoVouMais(
  order: PedidoParaNaoVouMais,
  userId: string,
  agora: number = Date.now(),
): RecusaDoNaoVouMais | null {
  if (!order.userId || order.userId !== userId) {
    return {
      http: 403,
      mensagem: "Só quem pegou este ingresso pode liberar a vaga. Entre com a conta usada no pedido.",
    };
  }
  if (order.totalCents !== 0) {
    return {
      http: 400,
      mensagem: "Este ingresso foi pago. \"Não vou mais\" vale só para ingresso grátis — para pedir o dinheiro de volta, use Reembolso.",
    };
  }
  if (["CANCELED", "EXPIRED", "REFUNDED"].includes(order.status)) {
    return { http: 400, mensagem: "Este ingresso já está cancelado." };
  }
  if (!["PAID", "FULFILLED"].includes(order.status)) {
    return { http: 400, mensagem: "Este pedido não está confirmado — não há ingresso para liberar." };
  }
  if (order.event.startsAt.getTime() <= agora) {
    return { http: 400, mensagem: "O evento já começou. A vaga só pode ser liberada até o início do evento." };
  }
  // ingresso grátis é intransferível desde 2026-08-31, mas um ingresso antigo
  // pode estar na conta de outra pessoa: cancelar o pedido tiraria o dela
  if (order.tickets.some((t) => VALENDO_NA_PORTA.includes(t.status) && t.ownerUserId && t.ownerUserId !== userId)) {
    return {
      http: 400,
      mensagem: "Um ingresso deste pedido está na conta de outra pessoa. Para liberar a vaga, fale com o produtor do evento.",
    };
  }
  if (vagasQueVoltariam(order) === 0) {
    return {
      http: 400,
      mensagem: "Os ingressos deste pedido já foram usados na entrada — não há vaga para liberar.",
    };
  }
  return null;
}

export interface SituacaoNaoVouMais {
  /** o botão "Não vou mais" aparece */
  podeLiberar: boolean;
  /** quantas vagas voltariam (singular/plural da confirmação) */
  vagas: number;
}

export interface ResultadoNaoVouMais {
  /** situação do pedido depois: CANCELED, ou a mesma se alguém do pedido já entrou */
  status: string;
  /** vagas que voltaram ao lote */
  vagasLiberadas: number;
  /** ingressos já usados na entrada — ficam registrados e não voltam */
  ingressosUsados: number;
}

@Injectable()
export class NaoVouMaisService {
  private carregar(publicToken: string) {
    return prisma.order.findUnique({
      where: { publicToken },
      select: {
        id: true,
        userId: true,
        status: true,
        totalCents: true,
        event: { select: { startsAt: true } },
        items: { select: { quantity: true } },
        tickets: { select: { status: true, ownerUserId: true } },
      },
    });
  }

  /** Mostra o botão? Só para o dono, e só quando a ação daria certo agora. */
  async situacao(publicToken: string, userId: string): Promise<SituacaoNaoVouMais> {
    const order = await this.carregar(publicToken);
    if (!order) throw new NotFoundException("Pedido não encontrado");
    // quem não é o dono recebe só "não" — nada sobre o pedido de outra pessoa
    if (recusaDoNaoVouMais(order, userId) !== null) return { podeLiberar: false, vagas: 0 };
    return { podeLiberar: true, vagas: vagasQueVoltariam(order) };
  }

  async liberar(publicToken: string, userId: string): Promise<ResultadoNaoVouMais> {
    const order = await this.carregar(publicToken);
    if (!order) throw new NotFoundException("Pedido não encontrado");
    const recusa = recusaDoNaoVouMais(order, userId);
    if (recusa) {
      throw recusa.http === 403 ? new ForbiddenException(recusa.mensagem) : new BadRequestException(recusa.mensagem);
    }

    // a operação refaz as travas de dinheiro/estado dentro da transação; a do
    // relógio fica aqui (a porta do comprador é a única com prazo)
    const feito = await cancelarPedidoGratis(order.id, userId, "Não vou mais — liberado pelo comprador", {
      origem: "comprador",
      aviso: { tipo: "ingresso" },
    });

    const depois = await prisma.order.findUnique({ where: { id: order.id }, select: { status: true } });
    // só o necessário para a tela: nada de CPF, e-mail ou pagamento
    return {
      status: depois?.status ?? "CANCELED",
      vagasLiberadas: feito.vagasDevolvidas,
      ingressosUsados: feito.ingressosUsados,
    };
  }
}
