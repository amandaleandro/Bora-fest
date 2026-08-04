import { Module } from "@nestjs/common";
import { WaitingRoomController } from "./waiting-room.controller";
import { WaitingRoomService } from "./waiting-room.service";

@Module({
  controllers: [WaitingRoomController],
  providers: [WaitingRoomService],
  exports: [WaitingRoomService],
})
export class WaitingRoomModule {}
