import { Controller, Get, Param } from "@nestjs/common";
import { RateLimit } from "../common/rate-limit.decorator";
import { PublicVipStatusService } from "./public-vip-status.service";

@Controller("v1/public/vip/reservations")
export class PublicVipReservationController {
  constructor(private readonly statusService: PublicVipStatusService) {}

  @Get(":publicToken")
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "vip-reservation-status" })
  status(@Param("publicToken") publicToken: string) {
    return this.statusService.get(publicToken);
  }
}
