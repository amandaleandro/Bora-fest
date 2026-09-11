import { Module } from "@nestjs/common";
import { HousesController, MyHousesController } from "./houses.controller";
import { HousesService } from "./houses.service";

@Module({
  controllers: [HousesController, MyHousesController],
  providers: [HousesService],
})
export class HousesModule {}
