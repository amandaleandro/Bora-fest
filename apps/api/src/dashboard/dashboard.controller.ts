import { Controller, Get, Header, Param, Query, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { subscribeRankingUpdates } from "@borafest/queues";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { DashboardService } from "./dashboard.service";
import { buscaDeParticipantes, paginaDeParticipantes } from "./participantes-pagina";

@Controller("v1/events/:eventId")
@UseGuards(SessionGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get("dashboard")
  getDashboard(@Param("eventId") eventId: string, @CurrentUserId() userId: string) {
    return this.dashboardService.getDashboard(eventId, userId);
  }

  @Get("orders")
  listOrders(
    @Param("eventId") eventId: string,
    @CurrentUserId() userId: string,
    @Query("status") status: string | undefined,
    @Query("page") page: string | undefined,
    @Query("pageSize") pageSize: string | undefined,
  ) {
    return this.dashboardService.listOrders(eventId, userId, {
      status,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Math.min(Number(pageSize), 100) : 20,
    });
  }

  @Get("sales-by-seller")
  listSalesBySeller(@Param("eventId") eventId: string, @CurrentUserId() userId: string) {
    return this.dashboardService.listSalesBySeller(eventId, userId);
  }

  @Get("sales-by-partner")
  listSalesByPartner(@Param("eventId") eventId: string, @CurrentUserId() userId: string) {
    return this.dashboardService.listSalesByPartner(eventId, userId);
  }

  /**
   * SSE da competição por atlética/parceiro: não manda os dados em si (o
   * front já sabe buscar via GET sales-by-partner), só avisa "algo mudou"
   * pra disparar o refetch — mantém a stream leve e a lógica de permissão/
   * serialização num único lugar.
   */
  @Get("sales-by-partner/stream")
  async streamSalesByPartner(
    @Param("eventId") eventId: string,
    @CurrentUserId() userId: string,
    @Res() reply: FastifyReply,
  ) {
    await this.dashboardService.assertRankingAccess(eventId, userId);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    reply.raw.write(":ok\n\n");

    const unsubscribe = subscribeRankingUpdates((updatedEventId: string) => {
      if (updatedEventId === eventId) {
        reply.raw.write("event: update\ndata: {}\n\n");
      }
    });

    const heartbeat = setInterval(() => reply.raw.write(":hb\n\n"), 25_000);

    reply.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }

  /** por página (2026-10-12): ?page=&pageSize=&q= — devolve { total, page, pageSize, participants } */
  @Get("participants")
  listParticipants(
    @Param("eventId") eventId: string,
    @CurrentUserId() userId: string,
    @Query("page") page: string | undefined,
    @Query("pageSize") pageSize: string | undefined,
    @Query("q") q: string | undefined,
  ) {
    return this.dashboardService.listParticipants(eventId, userId, {
      ...paginaDeParticipantes(page, pageSize),
      q: buscaDeParticipantes(q),
    });
  }

  @Get("participants/export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", "attachment; filename=participantes.csv")
  exportParticipants(@Param("eventId") eventId: string, @CurrentUserId() userId: string) {
    return this.dashboardService.exportParticipantsCsv(eventId, userId);
  }

  @Get("orders/export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", "attachment; filename=pedidos.csv")
  exportOrders(@Param("eventId") eventId: string, @CurrentUserId() userId: string) {
    return this.dashboardService.exportOrdersCsv(eventId, userId);
  }

  /** meia-entrada (2026-10-12, Decreto 8.537/2015): um ingresso de meia por linha */
  @Get("half-price/export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", "attachment; filename=meia-entrada.csv")
  exportMeiaEntrada(@Param("eventId") eventId: string, @CurrentUserId() userId: string) {
    return this.dashboardService.exportMeiaEntradaCsv(eventId, userId);
  }
}
