import { Module } from "@nestjs/common";
import { DescadastroController } from "./descadastro.controller";
import { DescadastroService } from "./descadastro.service";

/** "Não quero mais receber" dos e-mails de campanha e do aviso aos seguidores (LGPD, 2026-10-12). */
@Module({
  controllers: [DescadastroController],
  providers: [DescadastroService],
})
export class DescadastroModule {}
