import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { issueComplimentarySchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { ComplimentaryService } from "./complimentary.service";

@Controller("v1/events/:eventId/complimentary-tickets")
@UseGuards(SessionGuard)
export class ComplimentaryController {
  constructor(private readonly complimentaryService: ComplimentaryService) {}

  @Post()
  issue(
    @CurrentUserId() userId: string,
    @Param("eventId") eventId: string,
    @Body(ZodBody(issueComplimentarySchema)) body: unknown,
  ) {
    return this.complimentaryService.issue(userId, eventId, body as any);
  }

  @Get()
  list(@CurrentUserId() userId: string, @Param("eventId") eventId: string) {
    return this.complimentaryService.list(userId, eventId);
  }
}
