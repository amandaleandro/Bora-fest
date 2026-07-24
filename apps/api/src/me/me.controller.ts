import { Controller, Delete, Get, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { MeService } from "./me.service";

@Controller("v1/me")
@UseGuards(SessionGuard)
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get()
  profile(@CurrentUserId() userId: string) {
    return this.meService.profile(userId);
  }

  @Get("orders")
  orders(@CurrentUserId() userId: string) {
    return this.meService.orders(userId);
  }

  @Get("data-export")
  dataExport(@CurrentUserId() userId: string) {
    return this.meService.dataExport(userId);
  }

  @Delete()
  deleteAccount(@CurrentUserId() userId: string) {
    return this.meService.deleteAccount(userId);
  }
}
