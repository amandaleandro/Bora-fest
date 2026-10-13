import { Controller, Get, Headers, Param, Post, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { RateLimit } from "../common/rate-limit.decorator";
import { linksDeDescadastro } from "./descadastro-token";
import { DescadastroService } from "./descadastro.service";

/** Navegador abrindo o endereço (cliente de e-mail sem o um-clique), não o fetch da página. */
export function querPagina(accept: string | undefined): boolean {
  return typeof accept === "string" && accept.toLowerCase().includes("text/html");
}

/**
 * Descadastro público (LGPD, 2026-10-12) — sem login: o link assinado do
 * e-mail é a credencial. Limite por IP + link: o um-clique do Gmail sai dos
 * mesmos servidores do Google para todo mundo, então contar só por IP
 * travaria o descadastro de pessoas diferentes.
 */
@Controller("v1/public/descadastro")
export class DescadastroController {
  constructor(private readonly descadastro: DescadastroService) {}

  /**
   * O que a página mostra antes do botão. Nunca descadastra: antivírus e
   * pré-visualização abrem links sozinhos. O cabeçalho List-Unsubscribe aponta
   * para cá; o cliente de e-mail que só sabe abrir o endereço no navegador é
   * levado à página do site, que confirma com um botão.
   */
  @Get(":token")
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "descadastro-ver", by: "params:token" })
  async ver(
    @Param("token") token: string,
    @Headers("accept") accept: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    if (querPagina(accept)) {
      // destino fixo (site + /descadastro/ + código escapado): não vira redirecionamento aberto
      reply
        .code(303)
        .header("location", linksDeDescadastro(token ?? "").pagina)
        .header("cache-control", "no-store")
        .header("referrer-policy", "no-referrer")
        .send();
      return;
    }
    const situacao = await this.descadastro.ver(token ?? "");
    // resposta pessoal (e-mail mascarado): nunca em cache compartilhado
    reply.header("cache-control", "private, no-store").send(situacao);
  }

  /**
   * Descadastra. Serve ao botão da página e ao um-clique (RFC 8058: o Gmail e
   * o Apple Mail mandam POST com "List-Unsubscribe=One-Click" no corpo, que é
   * ignorado). Repetir é seguro: a segunda vez responde jaTinhaSaido.
   */
  @Post(":token")
  @RateLimit({ limit: 10, windowSeconds: 60, keyPrefix: "descadastro", by: "params:token" })
  async confirmar(@Param("token") token: string, @Res() reply: FastifyReply) {
    const resultado = await this.descadastro.confirmar(token ?? "");
    reply.code(200).header("cache-control", "no-store").send(resultado);
  }
}
