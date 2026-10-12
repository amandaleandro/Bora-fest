import { Injectable } from "@nestjs/common";
import {
  computePlatformFeeCents,
  getDefaultGateway,
  getFallbackGatewayForMethod,
  getGatewayForMethod,
  type PaymentMethodRoute,
} from "@borafest/payments";
import { PlatformAccessService } from "../common/platform-access.service";
import { emReais, minimoDaCobrancaCents } from "../common/minimo-cobranca";

/**
 * CONFIGURAÇÃO EFETIVA (2026-10-12). Uma variável do EasyPanel passa por cima
 * do código e isso já causou incidente (taxa Pix saindo R$ 2,50 por um piso no
 * ambiente, 14/08) — e pelo repositório não dá para saber o que está valendo.
 * Esta tela mostra o que a API está USANDO agora, lido pelas mesmas funções
 * que cobram (gateway por método, mínimo da cobrança, taxa).
 *
 * NUNCA devolve valor de segredo: chaves e senhas aparecem só como
 * "definida"/"ausente".
 */

export interface ItemDeConfiguracao {
  /** nome da variável de ambiente */
  variavel: string;
  rotulo: string;
  /** valor já formatado para exibir */
  valor: string;
  /** a variável existe no ambiente da API (false = vale o padrão do código) */
  definida: boolean;
  /** o que o código usaria sem a variável; null = não se aplica */
  padrao: string | null;
  alerta: string | null;
}

export interface GrupoDeConfiguracao {
  titulo: string;
  nota: string | null;
  itens: ItemDeConfiguracao[];
}

export interface ExemploDeTaxa {
  metodo: "Pix" | "Cartão";
  valor: string;
  taxa: string;
}

export interface ConfiguracaoEfetiva {
  geradaEm: string;
  ambiente: string;
  grupos: GrupoDeConfiguracao[];
  exemplosDeTaxa: ExemploDeTaxa[];
  /** todos os alertas dos itens, para o topo da tela */
  avisos: string[];
}

const env = (nome: string): string | undefined => process.env[nome];
const definida = (nome: string): boolean => env(nome) !== undefined;
const presente = (nome: string): boolean => Boolean(env(nome)?.trim());

function porcentagem(bps: number): string {
  if (!Number.isFinite(bps)) return "inválido";
  return `${(bps / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function reais(cents: number): string {
  return Number.isFinite(cents) ? emReais(cents) : "inválido";
}

/** Mesma leitura do código (`Number(env ?? padrão)`): "" vira 0, texto vira inválido. */
function numeroComoNoCodigo(nome: string, padrao: number): number {
  return Number(env(nome) ?? padrao);
}

function item(
  variavel: string,
  rotulo: string,
  valor: string,
  padrao: string | null,
  alerta: string | null = null,
): ItemDeConfiguracao {
  return { variavel, rotulo, valor, definida: definida(variavel), padrao, alerta };
}

/** Provedor padrão como o registry resolve (`PAYMENTS_PROVIDER ?? "mock"`) — é o que faz o repasse. */
function provedorPadraoEfetivo(): { nome: string; alerta: string | null } {
  try {
    return { nome: getDefaultGateway().provider, alerta: null };
  } catch {
    return {
      nome: `desconhecido (${env("PAYMENTS_PROVIDER") || "vazio"})`,
      alerta: "Provedor padrão desconhecido: o repasse e o que depende dele falham",
    };
  }
}

function provedorDoMetodo(metodo: PaymentMethodRoute): { nome: string; alerta: string | null } {
  try {
    return { nome: getGatewayForMethod(metodo).provider, alerta: null };
  } catch {
    const pedido = env(metodo === "PIX" ? "PAYMENTS_PROVIDER_PIX" : "PAYMENTS_PROVIDER_CARD") || env("PAYMENTS_PROVIDER");
    return {
      nome: `desconhecido (${pedido ?? "—"})`,
      alerta: `Provedor de ${metodo === "PIX" ? "Pix" : "cartão"} desconhecido: toda cobrança por ele falha`,
    };
  }
}

function reservaDoMetodo(metodo: PaymentMethodRoute): string {
  try {
    return getFallbackGatewayForMethod(metodo)?.provider ?? "nenhuma";
  } catch {
    return "nenhuma";
  }
}

/** Monta a configuração a partir do ambiente desta API (exportada para os testes). */
export function montarConfiguracaoEfetiva(agora: Date = new Date()): ConfiguracaoEfetiva {
  const producao = env("NODE_ENV") === "production";

  // --- pagamentos ---
  const padrao = provedorPadraoEfetivo();
  const provedorPadrao = padrao.nome;
  const pix = provedorDoMetodo("PIX");
  const cartao = provedorDoMetodo("CARD");
  const usados = new Set([provedorPadrao, pix.nome, cartao.nome, reservaDoMetodo("PIX"), reservaDoMetodo("CARD")]);
  const minimo = minimoDaCobrancaCents();

  const pagamentos: GrupoDeConfiguracao = {
    titulo: "Pagamentos",
    nota: "Pix e cartão podem estar em provedores diferentes. Sem variável própria, o método usa o provedor padrão.",
    itens: [
      item(
        "PAYMENTS_PROVIDER",
        "Provedor padrão (e do repasse)",
        provedorPadrao,
        "mock",
        padrao.alerta ??
          (provedorPadrao === "mock" && producao ? "Provedor de mentira em produção: aprova qualquer pagamento" : null),
      ),
      // sem variável própria o método usa o provedor padrão
      item("PAYMENTS_PROVIDER_PIX", "Provedor do Pix", pix.nome, provedorPadrao, pix.alerta),
      item("PAYMENTS_PROVIDER_CARD", "Provedor do cartão", cartao.nome, provedorPadrao, cartao.alerta),
      item("PAYMENTS_FALLBACK_PIX", "Reserva do Pix (se o principal cair)", reservaDoMetodo("PIX"), "nenhuma"),
      item("PAYMENTS_FALLBACK_CARD", "Reserva do cartão (se o principal cair)", reservaDoMetodo("CARD"), "nenhuma"),
      item(
        "PAYMENT_MIN_CHARGE_CENTS",
        "Mínimo de uma cobrança online",
        reais(minimo),
        reais(500),
        !Number.isFinite(minimo) || minimo <= 0
          ? "Mínimo de cobrança inválido ou zero: o gateway pode recusar cobranças pequenas na hora de pagar"
          : null,
      ),
    ],
  };

  // --- taxa da plataforma (padrão; casas com taxa própria usam a delas) ---
  const pixBps = numeroComoNoCodigo("PLATFORM_PIX_FEE_BPS", 500);
  const pixPiso = numeroComoNoCodigo("PLATFORM_PIX_FEE_FLOOR_CENTS", 100);
  const cartaoBps = numeroComoNoCodigo("PLATFORM_CARD_FEE_BPS", 500);
  const cartaoPiso = numeroComoNoCodigo("PLATFORM_CARD_FEE_FLOOR_CENTS", 150);
  const invalida = (n: number) => (Number.isFinite(n) && n >= 0 ? null : "Valor inválido: a taxa sai errada");

  const taxas: GrupoDeConfiguracao = {
    titulo: "Taxa da plataforma (padrão)",
    nota: "Organizações com taxa própria (tela Organizações) usam a delas. A taxa de cada lote é calculada quando o lote é criado.",
    itens: [
      item("PLATFORM_PIX_FEE_BPS", "Porcentagem no Pix", porcentagem(pixBps), porcentagem(500), invalida(pixBps)),
      item("PLATFORM_PIX_FEE_FLOOR_CENTS", "Taxa mínima no Pix", reais(pixPiso), reais(100), invalida(pixPiso)),
      item("PLATFORM_CARD_FEE_BPS", "Porcentagem no cartão", porcentagem(cartaoBps), porcentagem(500), invalida(cartaoBps)),
      item(
        "PLATFORM_CARD_FEE_FLOOR_CENTS",
        "Taxa mínima no cartão",
        reais(cartaoPiso),
        reais(150),
        invalida(cartaoPiso),
      ),
    ],
  };

  // calculado pela MESMA função que cobra — prova do que está valendo
  const semOverride = { pixFeeBps: null, pixFeeFloorCents: null, cardFeeBps: null };
  const exemplosDeTaxa: ExemploDeTaxa[] = [];
  for (const [metodo, rotulo] of [["PIX", "Pix"], ["CARD", "Cartão"]] as const) {
    for (const valorCents of [1000, 5000, 10000]) {
      exemplosDeTaxa.push({
        metodo: rotulo,
        valor: reais(valorCents),
        taxa: reais(computePlatformFeeCents(metodo, valorCents, semOverride)),
      });
    }
  }

  // --- repasses ---
  // mesma regra do worker (auto-payouts.ts): só "true" liga
  const autoTransfer = env("AUTO_TRANSFER_ENABLED");
  const desligado = "desligado (repasse manual pelo backoffice)";
  const repasses: GrupoDeConfiguracao = {
    titulo: "Repasses",
    nota: "O repasse automático roda no worker, que lê o próprio ambiente.",
    itens: [
      item(
        "AUTO_TRANSFER_ENABLED",
        "Pix de saída automático",
        autoTransfer === undefined ? "não informado à API" : autoTransfer === "true" ? "ligado" : desligado,
        desligado,
        autoTransfer === undefined
          ? "A API não recebe esta variável (só o worker), então esta tela não confirma se o repasse automático está ligado. Confira no EasyPanel."
          : null,
      ),
      item(
        "AUTO_PAYOUT_MIN_CENTS",
        "Saldo mínimo para o repasse automático",
        reais(numeroComoNoCodigo("AUTO_PAYOUT_MIN_CENTS", 5000)),
        reais(5000),
      ),
      item(
        "ANTICIPATION_FEE_BPS_MONTHLY",
        "Taxa de antecipação (ao mês)",
        porcentagem(numeroComoNoCodigo("ANTICIPATION_FEE_BPS_MONTHLY", 125)),
        porcentagem(125),
      ),
      item(
        "RELEASE_BUSINESS_DAYS_AFTER_EVENT",
        "Liberação do saldo após o evento",
        `${numeroComoNoCodigo("RELEASE_BUSINESS_DAYS_AFTER_EVENT", 2)} dias úteis`,
        "2 dias úteis",
      ),
    ],
  };

  // --- mensagens ---
  const provedorEmail = env("EMAIL_PROVIDER") ?? "devlog";
  const whatsapp = env("WHATSAPP_PROVIDER") ?? "devlog";
  const mensagens: GrupoDeConfiguracao = {
    titulo: "E-mail, WhatsApp e push",
    nota: null,
    itens: [
      item(
        "EMAIL_PROVIDER",
        "Provedor de e-mail",
        provedorEmail,
        "devlog",
        provedorEmail === "devlog" ? "E-mail só vai para o log: ninguém recebe nada" : null,
      ),
      item(
        "EMAIL_FROM",
        "Remetente",
        env("EMAIL_FROM")?.trim() || "não definido",
        null,
        provedorEmail === "resend" && !presente("EMAIL_FROM") ? "Sem remetente o Resend recusa o envio" : null,
      ),
      {
        // segredo: vazio conta como ausente, e o valor nunca sai
        ...item(
          "RESEND_WEBHOOK_SECRET",
          "Retorno de entrega do Resend (webhook)",
          presente("RESEND_WEBHOOK_SECRET") ? "configurado" : "não configurado",
          null,
          provedorEmail === "resend" && !presente("RESEND_WEBHOOK_SECRET")
            ? "Sem o webhook o sistema não sabe se o e-mail chegou, voltou ou caiu no spam"
            : null,
        ),
        definida: presente("RESEND_WEBHOOK_SECRET"),
      },
      item(
        "WHATSAPP_PROVIDER",
        "WhatsApp",
        whatsapp === "off" ? "desligado" : whatsapp === "meta" ? "ligado (Meta)" : whatsapp,
        "devlog",
        whatsapp === "devlog" && producao ? "WhatsApp em modo de teste em produção" : null,
      ),
      item("PUSH_PROVIDER", "Push do app", env("PUSH_PROVIDER") ?? "expo", "expo"),
    ],
  };

  // --- endereços ---
  const enderecos: GrupoDeConfiguracao = {
    titulo: "Endereços",
    nota: null,
    itens: [
      item(
        "WEB_BASE_URL",
        "Site do comprador (links dos e-mails)",
        env("WEB_BASE_URL")?.trim() || "não definido",
        producao ? "https://borafest.com.br" : "http://localhost:3000",
      ),
      item("PRODUCER_BASE_URL", "Painel do produtor", env("PRODUCER_BASE_URL")?.trim() || "não definido", null),
      item(
        "API_PUBLIC_URL",
        "Endereço público da API",
        env("API_PUBLIC_URL")?.trim() || "não definido",
        null,
        producao && !presente("API_PUBLIC_URL") ? "Sem ela os links de imagens apontam para localhost" : null,
      ),
    ],
  };

  // --- segredos: só presença, nunca o valor ---
  const usa = (provedor: string) => usados.has(provedor);
  const segredo = (variavel: string, rotulo: string, alertaSeAusente: string | null): ItemDeConfiguracao => ({
    variavel,
    rotulo,
    valor: presente(variavel) ? "definida" : "ausente",
    definida: presente(variavel),
    padrao: null,
    alerta: presente(variavel) ? null : alertaSeAusente,
  });
  const segredos: GrupoDeConfiguracao = {
    titulo: "Chaves e segredos",
    nota: "Só mostra se a chave existe no ambiente da API. O valor nunca sai do servidor.",
    itens: [
      segredo("SESSION_JWT_SECRET", "Assinatura das sessões", "Sem ela ninguém consegue entrar"),
      segredo(
        "TOTP_ENCRYPTION_KEY",
        "Chave mestra do 2FA (app autenticador)",
        "Sem ela ninguém ativa o app autenticador e as ações de dinheiro do backoffice ficam bloqueadas",
      ),
      segredo(
        "TICKET_KEY_ENCRYPTION_KEY",
        "Chave mestra dos QR dos ingressos",
        "Sem ela a chave que assina os QR fica em texto puro no banco (e no backup)",
      ),
      segredo("ASAAS_API_KEY", "Asaas: chave da API", usa("asaas") ? "O Asaas está em uso e está sem chave" : null),
      segredo(
        "ASAAS_WEBHOOK_TOKEN",
        "Asaas: token do webhook",
        usa("asaas") ? "Sem ele os pagamentos do Asaas não confirmam pelo webhook" : null,
      ),
      segredo(
        "MERCADOPAGO_ACCESS_TOKEN",
        "Mercado Pago: chave de acesso",
        usa("mercadopago") ? "O Mercado Pago está em uso e está sem chave" : null,
      ),
      segredo(
        "MERCADOPAGO_WEBHOOK_SECRET",
        "Mercado Pago: segredo do webhook",
        usa("mercadopago") ? "Sem ele os pagamentos do Mercado Pago não confirmam pelo webhook" : null,
      ),
      segredo("PAGARME_SECRET_KEY", "Pagar.me: chave", usa("pagarme") ? "O Pagar.me está em uso e está sem chave" : null),
      segredo(
        "RESEND_API_KEY",
        "Resend: chave de envio",
        provedorEmail === "resend" ? "Sem ela nenhum e-mail sai" : null,
      ),
      segredo("WHATSAPP_CLOUD_TOKEN", "WhatsApp (Meta): token", whatsapp === "meta" ? "WhatsApp ligado e sem token" : null),
      segredo("VAPID_PRIVATE_KEY", "Web Push: chave privada", null),
      segredo("METRICS_TOKEN", "Token das métricas (Grafana)", "Sem ele o /metrics responde 404 e o Grafana fica sem dados"),
    ],
  };

  const grupos = [pagamentos, taxas, repasses, mensagens, enderecos, segredos];
  const avisos = grupos.flatMap((g) => g.itens.filter((i) => i.alerta).map((i) => `${i.rotulo}: ${i.alerta}`));

  return {
    geradaEm: agora.toISOString(),
    ambiente: env("NODE_ENV") ?? "development",
    grupos,
    exemplosDeTaxa,
    avisos,
  };
}

@Injectable()
export class AdminConfigService {
  constructor(private readonly platformAccess: PlatformAccessService) {}

  /** Só leitura, equipe BoraFest (mesmo nível da tela de filas). */
  async configuracaoEfetiva(userId: string): Promise<ConfiguracaoEfetiva> {
    await this.platformAccess.assertStaff(userId);
    return montarConfiguracaoEfetiva();
  }
}
