import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { createReservationSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { OptionalUserId } from "../common/optional-user.decorator";
import { RateLimit } from "../common/rate-limit.decorator";
import { ReservationsService } from "./reservations.service";

@Controller("v1/reservations")
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "reservations-create" })
  create(
    @OptionalUserId() userId: string | undefined,
    @Body(ZodBody(createReservationSchema)) body: unknown,
  ) {
    return this.reservationsService.create(userId, body as any);
  }

  @Get(":id")
  findById(@Param("id") id: string) {
    return this.reservationsService.findById(id);
  }
}
