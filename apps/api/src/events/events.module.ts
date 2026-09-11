import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { EventsController } from "./events.controller";
import { EventRecurrenceService } from "./event-recurrence.service";
import { EventsService } from "./events.service";

@Module({
  imports: [CommonModule],
  controllers: [EventsController],
  providers: [EventsService, EventRecurrenceService],
  exports: [EventsService, EventRecurrenceService],
})
export class EventsModule {}
