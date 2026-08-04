import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import {
  getRedisConnection,
  getWaitingRoomStatus,
  isWaitingRoomAdmitted,
  joinWaitingRoom,
  type WaitingRoomJoinResult,
  type WaitingRoomStatusResult,
} from "@borafest/queues";

@Injectable()
export class WaitingRoomService {
  private readonly redis = getRedisConnection();

  /**
   * Sem sala de espera ativa: admite direto (o gate simplesmente não existe
   * pra esse evento) — o comprador nem percebe a diferença.
   */
  async join(slug: string): Promise<WaitingRoomJoinResult> {
    const event = await this.loadEvent(slug);
    if (!event.waitingRoomEnabled) {
      return { status: "ADMITTED", ticketId: "" };
    }
    return joinWaitingRoom(this.redis, event.id, event.waitingRoomConcurrency);
  }

  async status(slug: string, ticketId: string): Promise<WaitingRoomStatusResult> {
    const event = await this.loadEvent(slug);
    if (!event.waitingRoomEnabled) {
      return { status: "ADMITTED" };
    }
    return getWaitingRoomStatus(this.redis, event.id, ticketId);
  }

  /**
   * Gate server-side na criação da reserva — só é chamado quando o
   * `ReservationsService` já confirmou que o evento tem sala de espera
   * ativa, então aqui é sempre exigência: sem ticket admitido, sem reserva.
   */
  async assertAdmitted(eventId: string, ticketId: string | undefined): Promise<void> {
    if (!ticketId || !(await isWaitingRoomAdmitted(this.redis, eventId, ticketId))) {
      throw new ForbiddenException(
        "Sua vez na sala de espera ainda não chegou ou expirou — volte e entre na fila novamente",
      );
    }
  }

  private async loadEvent(slug: string) {
    const event = await prisma.event.findFirst({
      where: { slug, status: "PUBLISHED" },
      select: { id: true, waitingRoomEnabled: true, waitingRoomConcurrency: true },
    });
    if (!event) throw new NotFoundException("Evento não encontrado");
    return event;
  }
}
