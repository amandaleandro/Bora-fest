/**
 * Conferência das chaves dos gateways no boot (2026-10-12).
 *
 * Antes a trava da API só olhava o PAYMENTS_PROVIDER. Com o roteamento por
 * método (Pix no Mercado Pago, cartão no Asaas), a API subia mesmo sem
 * MERCADOPAGO_ACCESS_TOKEN — todo Pix falhava na hora de cobrar — ou sem
 * MERCADOPAGO_WEBHOOK_SECRET — o Pix era pago e o webhook recusado, o pedido
 * nunca confirmava. Aqui entram TODOS os provedores em uso:
 *
 * - padrão, Pix e cartão (PAYMENTS_PROVIDER / _PIX / _CARD): faltou chave ou o
 *   nome não existe → ERRO (a API não deve subir vendendo o que não confirma);
 * - reserva (PAYMENTS_FALLBACK_PIX / _CARD): faltou chave → AVISO. A venda
 *   principal funciona; só o failover falharia, como se não houvesse reserva.
 *
 * Função pura sobre o env — testável e reaproveitável pelo worker.
 */

export interface PaymentSecretsReport {
  errors: string[];
  warnings: string[];
}

const PROVEDORES_CONHECIDOS = ["mock", "asaas", "mercadopago", "pagarme"] as const;

function faltando(provider: string, env: NodeJS.ProcessEnv): string[] {
  const falta: string[] = [];
  switch (provider) {
    case "asaas":
      if (!env.ASAAS_API_KEY) falta.push("ASAAS_API_KEY");
      if (!env.ASAAS_WEBHOOK_TOKEN) falta.push("ASAAS_WEBHOOK_TOKEN");
      break;
    case "mercadopago":
      if (!env.MERCADOPAGO_ACCESS_TOKEN) falta.push("MERCADOPAGO_ACCESS_TOKEN");
      if (!env.MERCADOPAGO_WEBHOOK_SECRET) falta.push("MERCADOPAGO_WEBHOOK_SECRET");
      break;
    case "pagarme": {
      if (!env.PAGARME_SECRET_KEY) falta.push("PAGARME_SECRET_KEY");
      const temAutenticacaoDoWebhook =
        (env.PAGARME_WEBHOOK_BASIC_USER && env.PAGARME_WEBHOOK_BASIC_PASSWORD) ||
        env.PAGARME_WEBHOOK_SECRET;
      if (!temAutenticacaoDoWebhook) falta.push("PAGARME_WEBHOOK_BASIC_USER/PASSWORD");
      break;
    }
    default:
      break; // mock não tem chave
  }
  return falta;
}

function conhecido(provider: string): boolean {
  return (PROVEDORES_CONHECIDOS as readonly string[]).includes(provider);
}

export function checkPaymentSecrets(env: NodeJS.ProcessEnv = process.env): PaymentSecretsReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  // mesma resolução do registry: vazio cai no PAYMENTS_PROVIDER, que cai no mock
  const padrao = env.PAYMENTS_PROVIDER || "mock";
  const rotas: Array<[string, string]> = [
    ["PAYMENTS_PROVIDER", padrao],
    ["PAYMENTS_PROVIDER_PIX", env.PAYMENTS_PROVIDER_PIX || padrao],
    ["PAYMENTS_PROVIDER_CARD", env.PAYMENTS_PROVIDER_CARD || padrao],
  ];

  // agrupa por provedor para dizer UMA vez quais variáveis apontam para ele
  const porProvedor = new Map<string, string[]>();
  for (const [variavel, provider] of rotas) {
    porProvedor.set(provider, [...(porProvedor.get(provider) ?? []), variavel]);
  }

  for (const [provider, variaveis] of porProvedor) {
    const onde = variaveis.map((v) => `${v}=${provider}`).join(", ");
    if (!conhecido(provider)) {
      errors.push(
        `${onde}: provedor desconhecido (use ${PROVEDORES_CONHECIDOS.join(", ")}) — toda cobrança desse meio falharia`,
      );
      continue;
    }
    const falta = faltando(provider, env);
    if (falta.length > 0) {
      errors.push(
        `${onde} exige: ${falta.join(", ")} — sem isso a cobrança falha ou o webhook é recusado e o pedido nunca confirma`,
      );
    }
  }

  for (const variavel of ["PAYMENTS_FALLBACK_PIX", "PAYMENTS_FALLBACK_CARD"]) {
    const provider = env[variavel];
    if (!provider) continue;
    if (!conhecido(provider)) {
      warnings.push(`${variavel}=${provider}: provedor desconhecido — o failover desse meio não vai funcionar`);
      continue;
    }
    const falta = faltando(provider, env);
    if (falta.length > 0) {
      warnings.push(
        `${variavel}=${provider} sem ${falta.join(", ")} — se o provedor principal cair, o failover também vai falhar`,
      );
    }
  }

  return { errors, warnings };
}
