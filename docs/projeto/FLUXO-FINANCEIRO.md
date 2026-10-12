# Fluxo financeiro da BoraFest — como o dinheiro anda

> Reescrito em 2026-10-12, conferido no código. A versão de 25/07 descrevia a
> Pagar.me, que nunca entrou em produção. Fontes:
> `packages/payments/src/registry.ts` (provedor por meio de pagamento),
> `packages/payments/src/fees.ts` (taxa), `packages/payments/src/apply-status.ts`
> (livro-caixa da venda, do estorno e da comissão),
> `packages/payments/src/apply-vip-status.ts` (sinal VIP),
> `apps/api/src/common/ledger.ts` (saldo), `apps/api/src/finance/finance.service.ts`
> (saque e antecipação), `apps/worker/src/auto-payouts.ts` (Pix de saída),
> `apps/api/src/admin/admin.service.ts` (backoffice).

## 1. Onde o dinheiro entra

1. O comprador paga Pix ou cartão no site. O provedor é escolhido **por meio de
   pagamento**, por variável de ambiente:
   - Pix → `PAYMENTS_PROVIDER_PIX` (vazio = `PAYMENTS_PROVIDER`). Pelo registro
     de agosto, o Pix de produção está no **Mercado Pago** (conta da Amanda).
   - Cartão → `PAYMENTS_PROVIDER_CARD` (vazio = `PAYMENTS_PROVIDER`, que no
     compose é **Asaas**). O site oferece até 3x "sem juros": o custo do
     parcelado no Asaas não é repassado ao comprador nem ao produtor no código
     (a decisão de 23/07 era "parcelamento no comprador"; ver §6).
   - Reserva automática se o principal cair no pico:
     `PAYMENTS_FALLBACK_PIX` e `PAYMENTS_FALLBACK_CARD`.
   - O valor em uso aparece no backoffice → Configuração (rodada de 12/10).
     Pelo repositório não dá para saber o que está no EasyPanel.
2. O dinheiro cai na **conta da plataforma** no provedor (Mercado Pago ou
   Asaas). Não há divisão automática no gateway: nada vai direto para o
   produtor. O que é de cada um fica no livro-caixa (§2).
3. Outros caminhos:
   - **Pix na porta**: mesmo caminho do Pix online (o pedido nasce pendente e
     o webhook confirma).
   - **Dinheiro vivo na porta**: não passa pela plataforma. O pedido fica pago,
     mas sem crédito no saldo do produtor; o dinheiro fica com quem vendeu e o
     acerto com a produção é feito por fora (a portaria mostra quanto cada
     vendedor tem a acertar).
   - **Pedido de R$ 0** (lote grátis, cupom de 100%, cortesia, lista): nasce
     pago, sem gateway e sem lançamento. Não se reembolsa: se cancela.
   - **Sinal Pix da reserva VIP**: mesmo provedor do Pix e mesmo livro-caixa,
     com referência `vip_payment`.
4. Cobrança online mínima: `PAYMENT_MIN_CHARGE_CENTS` (padrão R$ 5,00). Lote
   ou pedido abaixo disso é recusado antes de criar a cobrança.

## 2. O livro-caixa (ledger)

Livro-caixa só de inclusão (`ledger_entries`): o saldo é sempre a soma dos
lançamentos, nunca um campo que se edita. Cada organização tem uma conta; o
promoter tem a carteira dele (a da organização dele, ou uma pessoal enquanto
ele não for produtor).

Quando o pagamento é aprovado (webhook ou reconciliação), na mesma transação:

| Lançamento | Valor | Libera em |
|---|---|---|
| `SALE_CREDIT` | o que o comprador pagou (ingresso, taxa e itens extras), menos a proteção | D+2 úteis do **fim** do evento |
| `PLATFORM_FEE` | menos a taxa da BoraFest | a mesma data do crédito |
| `PROTECTION_CREDIT` | o prêmio da proteção de reembolso (R$ 1,50), separado e nunca devolvido | a mesma data |
| `COMMISSION_DEBIT` / `COMMISSION_CREDIT` | comissão do promoter: sai da Casa e entra na carteira dele | a mesma data |

Depois: `REFUND_DEBIT` (estorno parcial), `ANTICIPATION_FEE` (taxa de
antecipação) e `PAYOUT_DEBIT` (repasse pago) contam na hora.

**Taxa da BoraFest** (`fees.ts`, decisão de 13/08): 5% no Pix com mínimo de
R$ 1,00 e 5% no cartão com mínimo de R$ 1,50. Variáveis `PLATFORM_*`; cada
organização pode ter taxa própria no backoffice. A taxa de cada lote é
calculada quando o lote é criado e é ela que entra no lançamento. Quem paga
depende do lote: comprador (taxa somada ao preço, padrão) ou produtor (taxa
dentro do preço). Venda de R$ 0 não paga taxa.

## 3. Quando cada um recebe

| Quem | Quando o saldo existe | Quando vira dinheiro na conta |
|---|---|---|
| Produtor | na hora, no livro-caixa | pelo **saque** (§4): o saldo libera D+2 úteis depois do fim do evento (`RELEASE_BUSINESS_DAYS_AFTER_EVENT`, padrão 2); antes disso, só com antecipação |
| Promoter | na hora, na carteira | na mesma data da venda que gerou a comissão. Com organização própria, saca pelas regras gerais; sem organização, precisa completar o cadastro de produtor para sacar |
| BoraFest | na hora, no livro-caixa | conforme a liquidação de cada provedor (o código anota ~D+32 para cartão no Asaas) |

O produtor não recebe na hora **de propósito**: o maior risco de uma
ticketeria é o evento não acontecer, e aí todo mundo tem direito a reembolso. O
dinheiro retido é o que paga esses reembolsos.

Atenção ao caixa: o cartão leva cerca de um mês para cair, e o produtor pode
sacar 2 dias úteis depois do evento. Num evento próximo da data da venda, a
plataforma pode pagar o repasse antes de receber o cartão.

## 4. Saque do produtor (repasse)

O produtor pede o saque no painel (Financeiro). Regras (`finance.service.ts`):

- Só com o cadastro aprovado (organização `ACTIVE`) e uma conta bancária
  padrão cadastrada. Hoje aprovar uma organização é um clique no backoffice,
  sem conferência de documentos (§6).
- Mínimo por saque: `AUTO_PAYOUT_MIN_CENTS` (padrão R$ 50,00) ou o mínimo da
  Casa; 1 saque por dia; 1 em andamento por vez; 48 h de quarentena depois de
  trocar a chave Pix.
- **Modo padrão** (`STANDARD`): saca o saldo já liberado (D+2 úteis do fim do
  evento). **Antecipação**: libera até 80% do que ainda está retido
  (`ANTICIPATION_MAX_BPS`), cobrando `ANTICIPATION_FEE_BPS_MONTHLY` (padrão
  1,25% ao mês, proporcional aos dias que faltam), e sempre vai para análise
  do backoffice.
- **Modo instantâneo** (`INSTANT`, Casas de confiança, ligado no backoffice):
  saca tudo na hora, pagando a antecipação sobre o que ainda não liberou, até
  o teto por saque da Casa; acima do teto vai para análise.
- O **primeiro saque** de toda Casa vai para análise. Os demais, dentro das
  regras, viram repasse direto (`Payout` pendente) sem esperar ninguém.
- Na aprovação, o saldo é conferido de novo: se um estorno derrubou o
  disponível desde o pedido, a aprovação é recusada.

**Como o dinheiro sai, hoje: à mão.**

1. O repasse aparece em backoffice → Repasses.
2. Um fundador faz o Pix por fora, da conta do provedor ou do banco.
3. Clica em **"Marcar como pago"**: lança `PAYOUT_DEBIT` e grava a auditoria.
   A partir da rodada de 12/10, aprovar e marcar como pago pedem o código do
   app autenticador de um admin (segundo fator).

**Repasse automático** (`apps/worker/src/auto-payouts.ts`): existe, mas está
**desligado por padrão** (`AUTO_TRANSFER_ENABLED=false` no compose). Quando
ligado, o worker manda o Pix pelo **provedor padrão** (`PAYMENTS_PROVIDER`) e
só o **Asaas** sabe transferir (o adaptador do Mercado Pago não transfere). Ou
seja: com o Pix das vendas entrando no Mercado Pago, o repasse automático
sairia do saldo do Asaas, que precisa cobrir. Proteções: um repasse nunca gera
segunda transferência e, se a chamada falhar sem resposta, o repasse vai para
`FAILED` pedindo conferência manual em vez de arriscar pagar duas vezes.

O produtor ainda não recebe comprovante nem aviso quando o repasse é pago
(§6).

## 5. Estorno (reembolso)

Quem pode estornar:

- **Produtor**, no painel (Vendas → pedido → Reembolsar), com a permissão de
  reembolso.
- **BoraFest**, no backoffice (Pedidos → Estornar, total ou parcial).
- **Comprador**, pedindo reembolso pela tela do pedido: no modo padrão quem
  decide é o backoffice; no modo instantâneo, a própria Casa.
- **Comprador com proteção de reembolso**: pede sozinho até o início do
  evento, sem aprovação.
- **Cancelamento do evento** pelo painel: reembolsa todos os pedidos pagos
  online pelo mesmo caminho, em lotes, e cancela os ingressos grátis.

O pedido vai ao provedor que recebeu o pagamento (uma vez só, com trava contra
clique duplo), o comprador recebe no mesmo meio e o livro-caixa registra:

- **Total**: desfaz `SALE_CREDIT` e `PLATFORM_FEE` (a taxa da BoraFest também
  volta), cancela os ingressos, devolve o estoque e devolve a comissão do
  promoter.
- **Parcial**: `REFUND_DEBIT` no saldo do produtor, comissão do promoter
  devolvida na proporção; os ingressos continuam valendo. Quando os parciais
  somam 100% do ingresso, a taxa também volta.
- **Proteção**: o prêmio (`PROTECTION_CREDIT`) nunca é devolvido.
- **Contestação de cartão (chargeback)**: tratada como estorno. A partir da
  rodada de 12/10, se a disputa for ganha e o pagamento voltar a pago, o
  estorno é desfeito.
- **Pedido grátis**: não se reembolsa, se cancela (vaga volta, QR deixa de
  valer). **Venda em dinheiro na porta**: sem estorno pela plataforma.

O dinheiro do estorno **sai do saldo do produtor**; como o saldo só libera
depois do evento, normalmente ainda está retido. No modo instantâneo, ou se o
produtor já sacou, o saldo pode ficar negativo e o próximo saque trava sozinho.
A responsabilidade legal pelo reembolso (CDC) é do organizador; a BoraFest
executa.

## 6. Decisões em aberto (dependem do Arthur)

| # | Decisão | Situação no código |
|---|---|---|
| 1 | O dinheiro das vendas passa pela conta da plataforma (Mercado Pago e Asaas). Em julho o Mercado Pago tinha sido descartado justamente por isso: risco regulatório de guardar dinheiro de terceiros e imposto sobre o total vendido. Fechar com contador e advogado sobre o que incide o imposto e o enquadramento da operação | Sem divisão automática no gateway; o livro-caixa separa o que é de cada um |
| 2 | Em qual conta (e de qual CNPJ) fica o dinheiro dos produtores, como conciliar Mercado Pago × Asaas e se o repasse automático será ligado | Nenhuma tela mostra "quanto devemos × quanto temos"; repasse automático só no Asaas, desligado |
| 3 | Conferência de documentos (KYC) antes do primeiro repasse | Aprovar Casa é um clique; a tabela de verificação existe e não é usada |
| 4 | Comprovante e aviso de repasse pago | O registro do repasse não tem comprovante e não há e-mail de repasse |
| 5 | Proteção de reembolso: Casa no modo instantâneo pode sacar antes e ficar negativa quando o comprador usa a proteção; em evento cancelado o prêmio (R$ 1,50) não volta ao comprador | Comportamento atual, nunca decidido (30/08) |
| 6 | Acerto do dinheiro da porta com o vendedor (marcar "acertado", com quem, quando e quanto) | A tela mostra o "a acertar", sem como dar baixa |
| 7 | Comissão de atlética/parceiro (link `?p=`): fica só anotada no pedido e o acerto é manual; a notificação de venda desconta a comissão e o saldo não | Promoter recebe na carteira; atlética não |
| 8 | Parcelamento "sem juros" até 3x no cartão: quem paga o custo do parcelado | Custo não repassado no código |

Prazo prometido ao comprador no estorno e o texto dos Termos e da Política de
Privacidade também dependem de revisão jurídica.
