import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import {
  configureVipDepositSchema,
  manageVipReservationSchema,
  updateVipInventorySchema,
} from "@borafest/contracts";
import { CurrentUserId } from "../common/current-user.decorator";
import { SessionGuard } from "../common/session.guard";
import { ZodBody } from "../common/zod-body.decorator";
import { VipPaymentsService } from "./vip-payments.service";
import { VipService } from "./vip.service";

@Controller("v1/vip")
@UseGuards(SessionGuard)
export class VipManagementController {
  constructor(
    private readonly vip: VipService,
    private readonly payments: VipPaymentsService,
  ) {}

  @Patch("inventory/:id")
  updateInventory(
    @Param("id") id: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(updateVipInventorySchema)) body: unknown,
  ) {
    return this.vip.updateInventory(id, userId, body as any);
  }

  @Patch("reservations/:id")
  manageReservation(
    @Param("id") id: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(manageVipReservationSchema)) body: any,
  ) {
    const input = { note: body.note };
    if (body.action === "CONFIRM") return this.vip.confirmReservation(id, userId, input);
    if (body.action === "REJECT") return this.vip.rejectReservation(id, userId, input);
    return this.vip.cancelReservation(id, userId, input);
  }

  @Get("reservations/:id/payment")
  paymentSummary(@Param("id") id: string, @CurrentUserId() userId: string) {
    return this.payments.paymentSummaryForProducer(id, userId);
  }

  @Patch("reservations/:id/deposit")
  configureDeposit(
    @Param("id") id: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(configureVipDepositSchema)) body: unknown,
  ) {
    return this.payments.configureDeposit(id, userId, body as any);
  }
}
