# BoraFest — Runbook de incidentes operacionais

> Guia de primeira resposta. O objetivo é reduzir tempo de diagnóstico sem criar ações destrutivas automáticas.
>
> Criado em 21/09/2026.

## 1. Princípios

- Não pedir ao comprador para pagar novamente sem confirmar o estado do pedido.
- Não cancelar/reemitir ingresso manualmente antes de entender se o outbox/worker ainda vai concluir.
- Pagamento confirmado, estoque e emissão são estados relacionados, mas não idênticos.
- O banco e o ledger são fontes autoritativas para dinheiro; a UI não é.
- Em incidentes financeiros, preservar evidência antes de alterar registros.

---

## 2. Alerta: BoraFestPaidOrderWithoutTicket

### Significado

`borafest_paid_orders_without_tickets > 0`

Existe pedido em `PAID` há mais de 2 minutos sem ingresso associado.

### Possíveis causas

- worker parado;
- outbox `order.paid` atrasado;
- erro na geração da chave/QR;
- erro de banco durante emissão;
- evento de outbox em retry/FAILED.

### Primeira resposta

1. confirmar saúde do worker;
2. verificar alerta `BoraFestOutboxFailed`;
3. verificar `BoraFestOutboxStale`;
4. localizar o pedido PAID sem tickets;
5. localizar o evento `order.paid` correspondente no outbox;
6. verificar `status`, `attempts`, `availableAt`;
7. revisar log do módulo `ticket-issuance` e `outbox`.

### Não fazer

- não criar outro pedido para o comprador;
- não marcar pedido como FULFILLED manualmente sem ingressos;
- não alterar ledger para “corrigir” a UI;
- não gerar QR fora do mecanismo oficial.

---

## 3. Alerta: BoraFestOutboxFailed

### Significado

Há pelo menos um `OutboxEvent` em estado `FAILED`.

### Impacto possível

Depende do `eventType`.

Exemplos:
- `order.paid`: emissão/notificações/loyalty/Meta CAPI podem estar incompletos;
- `payment.orphaned`: estorno automático pode não ter sido concluído;
- `order.payment_reversed`: revogação/loyalty reverso pode estar incompleto.

### Primeira resposta

1. identificar `eventType`;
2. identificar `aggregateId`;
3. conferir estado atual do pedido/pagamento;
4. confirmar se a operação já ocorreu parcialmente;
5. revisar logs da última tentativa;
6. somente depois decidir por reprocessamento controlado.

### Atenção

O handler pode executar mais de uma ação. Antes de reprocessar, confirme quais delas são idempotentes no fluxo específico.

---

## 4. Alerta: BoraFestOutboxStale

### Significado

Evento em `PENDING`, disponível há mais de 5 minutos, ainda sem processamento.

### Suspeitas principais

- worker fora do ar;
- fila `outbox-dispatch` parada;
- Redis indisponível;
- scheduler não disparando;
- banco lento;
- lote de eventos demorando demais.

### Primeira resposta

1. verificar `BoraFestWorkerDown`;
2. verificar Redis;
3. verificar jobs da fila `outbox`;
4. verificar latência do banco/API;
5. observar se o contador continua crescendo.

---

## 5. Alerta: BoraFestQueueFailures

### Significado

Alguma fila BullMQ registrou falha recente.

### Diagnóstico

Use o label `queue`.

Filas relevantes:
- reservas;
- outbox;
- pagamentos;
- pedidos;
- notificações;
- repasses;
- webhooks de pagamento;
- sala de espera;
- carrinho abandonado.

Uma falha isolada pode ser retry recuperável. Falhas repetidas ou acompanhadas de métricas de integridade exigem intervenção.

---

## 6. Alerta: BoraFestHighHttp5xxRate

### Significado

Mais de 5% das requisições observadas estão retornando 5xx por pelo menos 5 minutos.

### Primeira resposta

1. identificar rotas mais afetadas nos logs;
2. verificar Postgres e Redis;
3. verificar gateway de pagamento;
4. verificar erro de deploy/migration;
5. correlacionar com latência p95.

---

## 7. Alerta: BoraFestSlowApiP95

### Significado

p95 acima de 2 segundos por 5 minutos.

### Primeira resposta

- verificar banco;
- verificar endpoints mais acessados;
- verificar pool/conexões;
- verificar integrações externas;
- comparar com volume de tráfego;
- verificar se waiting room deveria estar ativo para abertura de venda.

---

## 8. Alerta: BoraFestApiDown / BoraFestWorkerDown

### API down

Impacta descoberta, checkout, painel e integrações.

### Worker down

Pode deixar:
- pagamento reconciliado com atraso;
- ingresso sem emissão;
- notificação pendente;
- carrinho abandonado sem envio;
- repasse sem execução;
- waiting room sem promoção.

Worker down pode ser invisível para quem só olha a home.

---

## 9. Smoke check financeiro

Em incidente de venda:

1. pedido existe?;
2. reserva converteu?;
3. pagamento está PAID?;
4. pedido está PAID ou FULFILLED?;
5. tickets existem?;
6. estoque vendido foi confirmado?;
7. ledger possui SALE_CREDIT?;
8. PLATFORM_FEE está consistente?;
9. comissão do promoter existe, se aplicável?;
10. notificação foi criada?

Nunca corrigir somente um desses estados sem entender os demais.

---

## 10. Escalonamento

### Crítico
- dinheiro confirmado sem ingresso;
- pagamento órfão sem estorno;
- ledger inconsistente;
- API/worker fora;
- outbox FAILED em operação financeira.

### Alto
- checkout com 5xx;
- outbox acumulando;
- fila de pagamentos falhando;
- check-in indisponível durante evento.

### Médio
- notificação atrasada com ingresso disponível na carteira;
- analytics/pixel falhando;
- campanha/CRM atrasado.

---

## 11. Notificação externa

Hoje as regras estão no Prometheus.

Para receber alerta fora do Grafana/Prometheus ainda falta configurar Alertmanager ou integração equivalente.

Até isso existir, não declarar que “o time será avisado automaticamente” por e-mail/Slack/WhatsApp.
