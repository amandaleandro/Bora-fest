import { Body, Controller, Get, Param, Post, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
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

  @Get("orders/:publicToken/tickets/:ticketId/qr.png")
  async ticketQrPng(
    @Param("publicToken") publicToken: string,
    @Param("ticketId") ticketId: string,
    @Res() reply: FastifyReply,
  ) {
    const png = await this.ticketsService.renderTicketQrPng(publicToken, ticketId);
    reply.header("content-type", "image/png").header("cache-control", "private, no-store").send(png);
  }

  @Get("me/tickets")
  @UseGuards(SessionGuard)
  myTickets(@CurrentUserId() userId: string) {
    return this.ticketsService.findByUser(userId);
  }

  @Post("tickets/:id/transfer")
  @UseGuards(SessionGuard)
  transfer(
    @Param("id") id: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(transferTicketSchema)) body: unknown,
  ) {
    return this.ticketsService.transferTicket(id, userId, body as any);
  }
}
