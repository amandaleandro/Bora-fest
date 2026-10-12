import assert from "node:assert/strict";
import { after, test } from "node:test";
import { emReais } from "../common/minimo-cobranca";

// Configuração efetiva (2026-10-12): o backoffice mostra o que a API está
// usando — provedor por método, mínimo, taxa, repasse automático — e NUNCA o
// valor de um segredo. A taxa lê o ambiente quando o módulo carrega, então o
// ambiente é montado ANTES de importar o serviço (import dinâmico abaixo).

const SEGREDOS: Record<string, string> = {
  SESSION_JWT_SECRET: "valor-secreto-da-sessao-123",
  ASAAS_API_KEY: "valor-secreto-do-asaas-456",
  ASAAS_WEBHOOK_TOKEN: "valor-secreto-do-token-asaas",
  RESEND_API_KEY: "re_valor_secreto_789",
  RESEND_WEBHOOK_SECRET: "whsec_valorSecretoDoWebhook",
  TOTP_ENCRYPTION_KEY: "chave-mestra-do-totp-com-mais-de-32-caracteres",
  TICKET_KEY_ENCRYPTION_KEY: "Y2hhdmUtbWVzdHJhLWRvcy1xci1jb20tMzItYnl0ZXM=",
  METRICS_TOKEN: "valor-secreto-das-metricas",
};

Object.assign(process.env, SEGREDOS, {
  PAYMENTS_PROVIDER: "asaas",
  PAYMENTS_PROVIDER_PIX: "mercadopago",
  PAYMENTS_PROVIDER_CARD: "",
  PAYMENT_MIN_CHARGE_CENTS: "500",
  PLATFORM_PIX_FEE_BPS: "500",
  // o caso do incidente de 14/08: piso do Pix vindo do ambiente
  PLATFORM_PIX_FEE_FLOOR_CENTS: "250",
  EMAIL_PROVIDER: "resend",
  EMAIL_FROM: "BoraFest <ingressos@borafest.com.br>",
  WHATSAPP_PROVIDER: "off",
});
delete process.env.PAYMENTS_FALLBACK_PIX;
delete process.env.PAYMENTS_FALLBACK_CARD;
delete process.env.AUTO_TRANSFER_ENABLED;
delete process.env.MERCADOPAGO_ACCESS_TOKEN;
delete process.env.MERCADOPAGO_WEBHOOK_SECRET;

const carregar = () => import("../admin/admin-config.service");

after(async () => {
  const { prisma } = await import("@borafest/database");
  await prisma.$disconnect();
});

function acharItem(config: { grupos: { itens: { variavel: string }[] }[] }, variavel: string) {
  for (const grupo of config.grupos) {
    const item = grupo.itens.find((i) => i.variavel === variavel);
    if (item) return item as {
      variavel: string;
      valor: string;
      definida: boolean;
      padrao: string | null;
      alerta: string | null;
    };
  }
  throw new Error(`item ${variavel} não está na configuração`);
}

test("configuração: nenhum valor de segredo sai na resposta — só definida/ausente", async () => {
  const { montarConfiguracaoEfetiva } = await carregar();
  const config = montarConfiguracaoEfetiva();
  const json = JSON.stringify(config);
  for (const [nome, valor] of Object.entries(SEGREDOS)) {
    assert.ok(!json.includes(valor), `${nome} vazou na configuração`);
  }
  assert.equal(acharItem(config, "SESSION_JWT_SECRET").valor, "definida");
  assert.equal(acharItem(config, "TOTP_ENCRYPTION_KEY").valor, "definida");
  assert.equal(acharItem(config, "TICKET_KEY_ENCRYPTION_KEY").valor, "definida");
  assert.equal(acharItem(config, "RESEND_WEBHOOK_SECRET").valor, "configurado");

  const mp = acharItem(config, "MERCADOPAGO_ACCESS_TOKEN");
  assert.equal(mp.valor, "ausente");
  assert.ok(mp.alerta, "Pix no Mercado Pago sem chave pede atenção");
});

test("configuração: provedor por método, mínimo e taxa são os que a cobrança usa", async () => {
  const { montarConfiguracaoEfetiva } = await carregar();
  const config = montarConfiguracaoEfetiva();

  assert.equal(acharItem(config, "PAYMENTS_PROVIDER_PIX").valor, "mercadopago");
  assert.equal(acharItem(config, "PAYMENTS_PROVIDER_CARD").valor, "asaas", "vazio cai no provedor padrão");
  assert.equal(acharItem(config, "PAYMENT_MIN_CHARGE_CENTS").valor, emReais(500));

  const piso = acharItem(config, "PLATFORM_PIX_FEE_FLOOR_CENTS");
  assert.equal(piso.valor, emReais(250));
  assert.equal(piso.padrao, emReais(100));
  assert.equal(piso.definida, true, "a tela mostra que veio do ambiente e é diferente do padrão");

  // exemplo calculado pela função que cobra: Pix de R$ 10 paga o piso do ambiente
  const pix10 = config.exemplosDeTaxa.find((e) => e.metodo === "Pix" && e.valor === emReais(1000));
  assert.equal(pix10?.taxa, emReais(250));
});

test("configuração: repasse automático — a API não recebe a variável e diz isso; só 'true' liga", async () => {
  const { montarConfiguracaoEfetiva } = await carregar();

  delete process.env.AUTO_TRANSFER_ENABLED;
  let config = montarConfiguracaoEfetiva();
  const naoInformado = acharItem(config, "AUTO_TRANSFER_ENABLED");
  assert.equal(naoInformado.valor, "não informado à API");
  assert.ok(naoInformado.alerta);
  assert.ok(config.avisos.some((a) => a.includes("Pix de saída automático")));

  process.env.AUTO_TRANSFER_ENABLED = "true";
  config = montarConfiguracaoEfetiva();
  assert.equal(acharItem(config, "AUTO_TRANSFER_ENABLED").valor, "ligado");

  process.env.AUTO_TRANSFER_ENABLED = "1";
  config = montarConfiguracaoEfetiva();
  assert.match(acharItem(config, "AUTO_TRANSFER_ENABLED").valor, /^desligado/, "igual ao worker: só 'true' liga");
  delete process.env.AUTO_TRANSFER_ENABLED;
});

test("configuração: e-mail no log em produção e webhook ausente viram aviso", async () => {
  const { montarConfiguracaoEfetiva } = await carregar();
  const nodeEnvAntes = process.env.NODE_ENV;
  const webhookAntes = process.env.RESEND_WEBHOOK_SECRET;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.RESEND_WEBHOOK_SECRET;
    let config = montarConfiguracaoEfetiva();
    assert.ok(acharItem(config, "RESEND_WEBHOOK_SECRET").alerta, "Resend sem webhook pede atenção");

    process.env.EMAIL_PROVIDER = "devlog";
    config = montarConfiguracaoEfetiva();
    assert.ok(acharItem(config, "EMAIL_PROVIDER").alerta, "devlog: ninguém recebe e-mail");
  } finally {
    process.env.EMAIL_PROVIDER = "resend";
    if (nodeEnvAntes === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnvAntes;
    if (webhookAntes !== undefined) process.env.RESEND_WEBHOOK_SECRET = webhookAntes;
  }
});

test("configuração: só a equipe BoraFest vê", async () => {
  const { AdminConfigService } = await carregar();
  const { PlatformAccessService } = await import("../common/platform-access.service");
  const { prisma } = await import("@borafest/database");
  const sufixo = Math.random().toString(36).slice(2, 8);
  const comum = await prisma.user.create({ data: { email: `config-comum-${sufixo}@borafest.dev` } });
  const suporte = await prisma.user.create({
    data: { email: `config-suporte-${sufixo}@borafest.dev`, platformRole: "SUPPORT" },
  });
  try {
    const service = new AdminConfigService(new PlatformAccessService());
    await assert.rejects(() => service.configuracaoEfetiva(comum.id), /equipe BoraFest/);
    const config = await service.configuracaoEfetiva(suporte.id);
    assert.ok(config.grupos.length > 0);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [comum.id, suporte.id] } } });
  }
});
