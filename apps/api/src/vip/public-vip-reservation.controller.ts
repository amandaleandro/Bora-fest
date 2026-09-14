import { Controller, Get, Param } from "@nestjs/common";
import { RateLimit } from "../common/rate-limit.decorator";
import { VipService } from "./vip.service";

@Controller("v1/public/vip/reservations")
export class PublicVipReservationController {
  constructor(private readonly vip: VipService) {}

  @Get(":publicToken")
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "vip-reservation-status" })
  status(@Param("publicToken") publicToken: string) {
    return this.vip.publicReservation(publicToken);
  }
}
