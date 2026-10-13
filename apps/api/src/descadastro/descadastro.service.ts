import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { withContext } from "@borafest/observability";
import { chaveDoEmail, ehUuid, lerTokenDeDescadastro, mascararEmail } from "./descadastro-token";
import { registrarDescadastroDeCampanha, TEMPLATES_DE_CAMPANHA } from "./supressao";

const log = withContext({ module: "descadastro" });

export const LINK_DE_DESCADASTRO_INVALIDO =
  "Este link não é válido — ele pode ter sido copiado pela metade. Abra de novo o link que está no rodapé do e-mail.";

export type TipoDeDescadastro = "seguidor" | "campanha";

/** O que a página mostra antes do botão. */
export interface SituacaoDoDescadastro {
  tipo: TipoDeDescadastro;
  /** nome público da Casa; null = a Casa não está mais na BoraFest */
  casa: string | null;
  /** e-mail mascarado ("fu***@gmail.com"); null quando a conta não existe mais */
  email: string | null;
  /** a pessoa já saiu (não segue mais / já está fora das campanhas) */
  jaSaiu: boolean;
}

export interface ResultadoDoDescadastro {
  ok: true;
  tipo: TipoDeDescadastro;
  casa: string | null;
  /** true = já tinha saído antes (clique repetido ou um clique do Gmail antes) */
  jaTinhaSaido: boolean;
}

type Alvo =
  | { tipo: "seguidor"; organizationId: string; userId: string }
  | { tipo: "campanha"; organizationId: string; email: string };

/**
 * Descadastro público (LGPD, 2026-10-12). O link do e-mail é a credencial:
 * não pede login. Ver (GET) nunca muda nada — antivírus e pré-visualização de
 * e-mail abrem links sozinhos; só o POST (botão da página ou o um-clique do
 * Gmail/Apple Mail) descadastra.
 *  - seguidor: deixa de seguir AQUELA Casa (para o aviso de evento novo);
 *  - campanha: entra em marketing_opt_outs e os disparos daquela Casa pulam
 *    este e-mail. Ingresso e avisos de compra continuam chegando.
 */
@Injectable()
export class DescadastroService {
  async ver(token: string): Promise<SituacaoDoDescadastro> {
    const alvo = await this.alvoDoLink(token);
    const casa = await this.nomeDaCasa(alvo.organizationId);

    if (alvo.tipo === "seguidor") {
      const [usuario, seguindo] = await Promise.all([
        prisma.user.findUnique({ where: { id: alvo.userId }, select: { email: true } }),
        prisma.organizationFollow.findUnique({
          where: { organizationId_userId: { organizationId: alvo.organizationId, userId: alvo.userId } },
          select: { id: true },
        }),
      ]);
      return {
        tipo: "seguidor",
        casa,
        email: usuario?.email ? mascararEmail(chaveDoEmail(usuario.email)) : null,
        jaSaiu: !seguindo,
      };
    }

    const emailKey = chaveDoEmail(alvo.email);
    const saiu = await prisma.marketingOptOut.findUnique({
      where: { organizationId_emailKey: { organizationId: alvo.organizationId, emailKey } },
      select: { id: true },
    });
    return { tipo: "campanha", casa, email: mascararEmail(emailKey), jaSaiu: !!saiu };
  }

  async confirmar(token: string): Promise<ResultadoDoDescadastro> {
    const alvo = await this.alvoDoLink(token);
    const casa = await this.nomeDaCasa(alvo.organizationId);

    if (alvo.tipo === "seguidor") {
      // deleteMany: repetir não dá erro, e a resposta diz se já tinha saído
      const removido = await prisma.organizationFollow.deleteMany({
        where: { organizationId: alvo.organizationId, userId: alvo.userId },
      });
      log.info({ tipo: "seguidor", organizationId: alvo.organizationId, removido: removido.count }, "descadastro confirmado");
      return { ok: true, tipo: "seguidor", casa, jaTinhaSaido: removido.count === 0 };
    }

    const { jaTinhaSaido, tiradosDaFila } = await registrarDescadastroDeCampanha(alvo.organizationId, alvo.email);
    // sem e-mail no log: só a Casa e as contagens
    log.info({ tipo: "campanha", organizationId: alvo.organizationId, jaTinhaSaido, tiradosDaFila }, "descadastro confirmado");
    return { ok: true, tipo: "campanha", casa, jaTinhaSaido };
  }

  /** Lê e confere o link; recusa com mensagem clara se não vale. */
  private async alvoDoLink(token: string): Promise<Alvo> {
    const pedido = lerTokenDeDescadastro(token);
    if (!pedido) throw new BadRequestException(LINK_DE_DESCADASTRO_INVALIDO);

    if (pedido.tipo === "seguidor") return pedido;

    // campanha: o e-mail e a Casa saem da própria linha da fila que mandou o e-mail
    const notificacao = await prisma.notification.findUnique({
      where: { id: pedido.notificationId },
      select: { channel: true, template: true, recipient: true, payload: true },
    });
    const organizationId =
      notificacao?.payload && typeof notificacao.payload === "object" && !Array.isArray(notificacao.payload)
        ? (notificacao.payload as Record<string, unknown>).organizationId
        : null;
    if (
      !notificacao ||
      notificacao.channel !== "EMAIL" ||
      !TEMPLATES_DE_CAMPANHA.has(notificacao.template) ||
      !ehUuid(organizationId) ||
      !chaveDoEmail(notificacao.recipient)
    ) {
      throw new BadRequestException(LINK_DE_DESCADASTRO_INVALIDO);
    }
    return { tipo: "campanha", organizationId, email: notificacao.recipient };
  }

  private async nomeDaCasa(organizationId: string): Promise<string | null> {
    const casa = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, displayName: true },
    });
    return casa ? casa.displayName?.trim() || casa.name : null;
  }
}
