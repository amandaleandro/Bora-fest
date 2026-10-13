import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { ConvitesEmailController, PublicConvitesController } from "./convites-email.controller";
import { ConvitesEmailService } from "./convites-email.service";

/** Convite por e-mail (2026-10-12): 3ª forma do ingresso restrito, formato Sympla. */
@Module({
  imports: [CommonModule],
  controllers: [ConvitesEmailController, PublicConvitesController],
  providers: [ConvitesEmailService],
})
export class ConvitesEmailModule {}
