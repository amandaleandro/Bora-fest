import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module";
import { WaitingRoomModule } from "../waiting-room/waiting-room.module";
import { ReservationsController } from "./reservations.controller";
import { ReservationsService } from "./reservations.service";

@Module({
  imports: [InventoryModule, WaitingRoomModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
