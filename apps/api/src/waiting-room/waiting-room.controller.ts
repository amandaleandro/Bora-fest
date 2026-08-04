import { BadRequestException, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { RateLimit } from "../common/rate-limit.decorator";
import { WaitingRoomService } from "./waiting-room.service";

@Controller("v1/public/events/:slug/waiting-room")
export class WaitingRoomController {
  constructor(private readonly waitingRoomService: WaitingRoomService) {}

  @Post("join")
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "waiting-room-join" })
  join(@Param("slug") slug: string) {
    return this.waitingRoomService.join(slug);
  }

  @Get("status")
  status(@Param("slug") slug: string, @Query("ticketId") ticketId: string | undefined) {
    if (!ticketId) throw new BadRequestException("ticketId é obrigatório");
    return this.waitingRoomService.status(slug, ticketId);
  }
}
