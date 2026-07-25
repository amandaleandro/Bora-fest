# Fluxo financeiro da BoraFest — como o dinheiro anda

> Escrito em 2026-07-25 para alinhar os fundadores. Reflete o que está
> IMPLEMENTADO no código hoje + as decisões de negócio ainda em aberto.
> Fonte técnica: `packages/payments/src/apply-status.ts` (ledger/estorno),
> `apps/api/src/finance/finance.service.ts` (saque),
> `apps/api/src/admin/admin.service.ts` (repasses e estorno pelo backoffice).

## 1. A venda

1. Comprador paga (Pix ou cartão) → o dinheiro cai na **Pagar.me**
   (instituição de pagamento, custódia regulada). Não cai na conta da
   BoraFest nem na do produtor.
2. No webhook de pagamento aprovado, o **ledger** (livro-caixa append-only,
   `ledger_entries`) registra na mesma transação:
   - `SALE_CREDIT` → saldo do produtor (preço dos ingressos)
   - `PLATFORM_FEE` → receita da BoraFest (4,99% Pix piso R$ 2,49 / 6,99%
     cartão; override por produtora no backoffice; quem paga a taxa depende
     do `feeMode` do lote — comprador ou produtor)
3. Ingressos são emitidos com garantia exactly-once.

## 2. Quando cada um recebe

| Quem | Quando o "saldo" existe | Quando vira dinheiro no banco |
|---|---|---|
| Produtor | na hora (ledger) | só via **saque**: KYC aprovado + solicitação (D+2) + aprovação no backoffice |
| BoraFest | na hora (ledger) | conforme liquidação da Pagar.me (Pix D+0/D+1; cartão padrão D+30, antecipação contratável) |

O produtor **não recebe na hora por desenho**: a custódia é a defesa contra
evento-fantasma e é a verba que garante estornos.

## 3. Saque do produtor (repasse)

Fluxo hoje: produtor solicita no painel → checagens automáticas (KYC ACTIVE,
saldo disponível menos saques pendentes, conta bancária padrão cadastrada) →
aparece em **Backoffice → Repasses** → um fundador faz a transferência (painel
da Pagar.me / banco) → **"Marcar como pago"** → `PAYOUT_DEBIT` no ledger +
trilha de auditoria.

- A transferência bancária em si é MANUAL por enquanto (decisão consciente:
  sem conta Pagar.me não há API de transferência; e no início cada repasse
  merece olho humano).
- **Evolução planejada**: com as chaves da Pagar.me, "Marcar como pago"
  passa a chamar a API de transferência — vira um clique.

## 4. Estorno (reembolso)

Fluxo implementado: **Backoffice → Pedidos → Estornar** (total ou parcial) →
ordem vai ao gateway (idempotente) → comprador recebe no mesmo meio → webhook
confirma → ledger:

- Parcial: `REFUND_DEBIT` no saldo do produtor; ingressos continuam válidos.
- Total: reverte `SALE_CREDIT` + `PLATFORM_FEE` (líquido zero — hoje a taxa
  da BoraFest também é devolvida), cancela ingressos e devolve estoque.

O dinheiro do estorno **sai do saldo do produtor**. A responsabilidade legal
pelo reembolso (CDC) é do organizador; a BoraFest é o trilho que executa.

## 5. Decisões de negócio EM ABERTO (donos precisam cravar)

| # | Decisão | Recomendação | Muda código? |
|---|---|---|---|
| 1 | Devolver a taxa BoraFest em estorno total? | Sim (hoje já é assim) | Não (já é o comportamento) |
| 2 | Trava de saque pré-evento (ex.: 30% só libera após o evento) | SIM — proteção contra cancelamento em massa | **Sim** (pequena, no `requestPayout`) |
| 3 | Estorno em massa de evento cancelado | Só BoraFest executa, produtor solicita | Não (já é assim) |
| 4 | Prazo prometido ao comprador | "Pix até 1 dia útil; cartão em até 2 faturas" | Não (texto dos Termos) |
| 5 | Antecipação de recebíveis de cartão (D+30 → D+2, custa %) | Avaliar com a conta Pagar.me aberta | Não (config no PSP) |

## 6. O que destrava com a conta Pagar.me

1. Chaves `sk_`/`pk_` no `.env.production` → pagamento real (Pix imediato).
2. Tokenização real de cartão no checkout (meio dia de trabalho, precisa da `pk_`).
3. Webhook apontado para `api.<dominio>/v1/webhooks/payments/pagarme` (Basic Auth já suportada).
4. Automação da transferência no "Marcar como pago".
5. Compra de homologação de R$ 1 ponta a ponta.
