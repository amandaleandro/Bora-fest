import { PAGARME_PUBLIC_KEY } from "../config";

export interface CardInput {
  holderName: string;
  number: string;
  expMonth: string;
  expYear: string;
  cvv: string;
}

export class CardTokenizationError extends Error {}

/**
 * Tokeniza o cartão SEM passar o PAN pelo nosso backend — mesmo princípio do
 * `tokenizecard.js` que o checkout web usaria: o token é gerado direto pelo
 * gateway (Pagar.me tem um endpoint REST público de tokenização, não exige
 * SDK), e só o token vai pro nosso `POST /v1/orders/:id/payments/card`.
 *
 * Sem `EXPO_PUBLIC_PAGARME_PUBLIC_KEY` configurada (ainda não há chave real —
 * ver REGISTRO.md, decisão de gateway pendente de conta comercial), cai num
 * token MOCK que só o `MockGateway` do backend reconhece: números terminados
 * em `0002` simulam recusa (mesma convenção documentada em
 * `packages/payments/src/mock.ts`), qualquer outro aprova. NUNCA usar o modo
 * mock com um gateway/cartão de verdade.
 */
export async function tokenizeCard(card: CardInput): Promise<string> {
  const last4 = card.number.slice(-4);

  if (!PAGARME_PUBLIC_KEY) {
    const suffix = last4 === "0002" ? "_fail" : "";
    return `mock_card_${last4}${suffix}`;
  }

  const response = await fetch(`https://api.pagar.me/core/v5/tokens?appId=${PAGARME_PUBLIC_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "card",
      card: {
        number: card.number,
        holder_name: card.holderName,
        exp_month: Number(card.expMonth),
        exp_year: Number(card.expYear),
        cvv: card.cvv,
      },
    }),
  });

  const data: any = await response.json().catch(() => null);
  if (!response.ok || !data?.id) {
    throw new CardTokenizationError(data?.message ?? "Não foi possível validar o cartão");
  }
  return data.id as string;
}
