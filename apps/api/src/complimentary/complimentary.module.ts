import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { ComplimentaryController } from "./complimentary.controller";
import { ComplimentaryService } from "./complimentary.service";

@Module({
  imports: [CommonModule],
  controllers: [ComplimentaryController],
  providers: [ComplimentaryService],
})
export class ComplimentaryModule {}
