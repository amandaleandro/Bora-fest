import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { Seguranca2faController } from "./seguranca-2fa.controller";
import { Seguranca2faService } from "./seguranca-2fa.service";
import { Exige2faGuard } from "./exige-2fa.guard";

/**
 * Segundo fator do backoffice (2026-10-12). Importado pelo AdminModule: as
 * rotas de dinheiro de lá usam o Exige2faGuard, e o controller de ativação
 * entra junto (sem mexer no app.module).
 */
@Module({
  imports: [CommonModule],
  controllers: [Seguranca2faController],
  providers: [Seguranca2faService, Exige2faGuard],
  exports: [Seguranca2faService, Exige2faGuard],
})
export class Seguranca2faModule {}
