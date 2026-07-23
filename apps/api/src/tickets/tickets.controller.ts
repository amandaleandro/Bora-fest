import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { transferTicketSchema } from "@borafest/contracts";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { ZodBody } from "../common/zod-body.decorator";
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

  @Post("tickets/:id/transfer")
  transfer(@Param("id") id: string, @Body(ZodBody(transferTicketSchema)) body: unknown) {
    return this.ticketsService.transferTicket(id, body as any);
  }
}
