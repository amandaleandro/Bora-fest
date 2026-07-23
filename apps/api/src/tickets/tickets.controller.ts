import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { TicketsService } from "./tickets.service";

@Controller("v1")
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get("orders/:publicToken/tickets")
  byOrder(@Param("publicToken") publicToken: string) {
    return this.ticketsService.findByOrderPublicToken(publicToken);
  }

  @Get("me/tickets")
  @UseGuards(SessionGuard)
  myTickets(@CurrentUserId() userId: string) {
    return this.ticketsService.findByUser(userId);
  }
}
