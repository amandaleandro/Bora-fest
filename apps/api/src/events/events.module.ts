import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { EventDuplicationService } from "./event-duplication.service";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";

@Module({
  imports: [CommonModule],
  controllers: [EventsController],
  providers: [EventsService, EventDuplicationService],
  exports: [EventsService, EventDuplicationService],
})
export class EventsModule {}
