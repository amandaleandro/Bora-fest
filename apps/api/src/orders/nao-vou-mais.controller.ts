import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { RateLimit } from "../common/rate-limit.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { NaoVouMaisService } from "./nao-vou-mais.service";

/**
 * "Não vou mais" do comprador (ingresso grátis, até o início do evento).
 * Exige SESSÃO — o link do pedido anda por e-mail e WhatsApp e não pode, sozinho,
 * cancelar o ingresso de ninguém. O serviço confere que a sessão é a do dono.
 */
@Controller("v1/orders")
@UseGuards(SessionGuard)
export class NaoVouMaisController {
  constructor(private readonly naoVouMais: NaoVouMaisService) {}

  /** O botão aparece? (minhas compras e página do pedido) */
  @Get(":publicToken/nao-vou-mais")
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "nao-vou-mais-ver", by: "params:publicToken" })
  situacao(@Param("publicToken") publicToken: string, @CurrentUserId() userId: string) {
    return this.naoVouMais.situacao(publicToken, userId);
  }

  /** Libera a vaga: mesmo limite por pedido das outras ações do comprador (claim, reembolso protegido). */
  @Post(":publicToken/nao-vou-mais")
  @RateLimit({ limit: 5, windowSeconds: 3600, keyPrefix: "nao-vou-mais", by: "params:publicToken" })
  liberar(@Param("publicToken") publicToken: string, @CurrentUserId() userId: string) {
    return this.naoVouMais.liberar(publicToken, userId);
  }
}
