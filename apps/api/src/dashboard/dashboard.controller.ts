import { Controller, Get, Header, Param, Query, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { DashboardService } from "./dashboard.service";

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

  @Get("participants")
  listParticipants(@Param("eventId") eventId: string, @CurrentUserId() userId: string) {
    return this.dashboardService.listParticipants(eventId, userId);
  }

  @Get("participants/export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", "attachment; filename=participantes.csv")
  exportParticipants(@Param("eventId") eventId: string, @CurrentUserId() userId: string) {
    return this.dashboardService.exportParticipantsCsv(eventId, userId);
  }
}
