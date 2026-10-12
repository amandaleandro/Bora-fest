import { Module } from "@nestjs/common";
import { FinanceModule } from "../finance/finance.module";
import { CommonModule } from "../common/common.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { Seguranca2faModule } from "../seguranca-2fa/seguranca-2fa.module";
import { WebhooksEmailModule } from "../webhooks-email/webhooks-email.module";
import { AdminController } from "./admin.controller";
import { AdminConfigController } from "./admin-config.controller";
import { AdminConfigService } from "./admin-config.service";
import { AdminBannersController, PublicBannersController } from "./banners.controller";
import { BannersService } from "./banners.service";
import { AdminService } from "./admin.service";

@Module({
  // Seguranca2faModule (2026-10-12): Exige2faGuard nas rotas de dinheiro e as
  // rotas de ativação do app autenticador (v1/admin/2fa)
  // WebhooksEmailModule (2026-10-12): webhook do Resend (POST v1/webhooks/resend)
  // e a consulta de e-mails do suporte (GET v1/admin/emails)
  imports: [CommonModule, NotificationsModule, FinanceModule, Seguranca2faModule, WebhooksEmailModule],
  controllers: [AdminController, AdminBannersController, PublicBannersController, AdminConfigController],
  providers: [AdminService, BannersService, AdminConfigService],
})
export class AdminModule {}
