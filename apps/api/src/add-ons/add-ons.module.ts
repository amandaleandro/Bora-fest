import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { AddOnsController, AddOnController } from "./add-ons.controller";
import { AddOnsService } from "./add-ons.service";

@Module({
  imports: [CommonModule],
  controllers: [AddOnsController, AddOnController],
  providers: [AddOnsService],
  exports: [AddOnsService],
})
export class AddOnsModule {}
