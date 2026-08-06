import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { createReviewSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { ReviewsService } from "./reviews.service";

@Controller("v1/events/:eventId/reviews")
@UseGuards(SessionGuard)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  create(
    @Param("eventId") eventId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(createReviewSchema)) body: unknown,
  ) {
    return this.reviewsService.create(eventId, userId, body as any);
  }

  @Get("mine")
  mine(@Param("eventId") eventId: string, @CurrentUserId() userId: string) {
    return this.reviewsService.getMine(eventId, userId);
  }
}

@Controller("v1/public/events/:slug/reviews")
export class PublicReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  summary(@Param("slug") slug: string) {
    return this.reviewsService.summaryForEventSlug(slug);
  }
}
