# N6 — Inteligência de retenção da Casa

Data: 2026-09-12

## Objetivo

Transformar o CRM derivado do N5 em leitura de negócio: a Casa precisa saber se está construindo público recorrente, quanto da receita vem de quem volta e quais eventos realmente geram retenção.

## Fonte de verdade

Não existe uma segunda base de clientes. O N6 deriva tudo das mesmas fontes do CRM:

- pedidos `PAID`/`FULFILLED`;
- e-mail de contato normalizado para identificar o cliente;
- evento do pedido;
- `Ticket.checkedInAt` para presença;
- `Order.promoterLinkId` para receita atribuída a promoter.

PostgreSQL continua sendo a fonte de verdade; não há migration neste incremento.

## Endpoint

`GET /v1/organizations/:organizationId/customers/retention`

Autorização: `FINANCE_VIEW`.

## Métricas gerais

- clientes únicos;
- clientes recorrentes: compraram em 2+ eventos;
- taxa de retorno;
- clientes frequentes: compraram em 3+ eventos;
- clientes em risco: sem próxima compra e último evento há mais de 30 dias;
- clientes no-show: compraram evento passado e nunca tiveram check-in registrado;
- receita total;
- receita de clientes recorrentes;
- participação da receita recorrente;
- receita atribuída a promoter;
- participação da receita atribuída a promoter;
- receita média por cliente.

## Tendência

Os últimos 6 meses são preenchidos mesmo quando não há venda em algum mês. Para cada mês mostramos:

- clientes únicos;
- clientes novos;
- clientes que já haviam comprado antes;
- receita paga.

A classificação mensal usa a primeira compra paga conhecida da pessoa na Casa.

## Desempenho por evento

Para os 8 eventos passados mais recentes:

- compradores únicos;
- clientes novos;
- clientes recorrentes;
- taxa de retorno;
- receita;
- ingressos emitidos;
- ingressos com check-in;
- taxa de presença.

A classificação novo/recorrente por evento usa a primeira data de evento comprada por aquele e-mail dentro da Casa.

## Painel

Rota: `/organizacoes/:orgId/clientes/retencao`.

A tela fica dentro da área de Clientes para não criar mais um item de primeiro nível na sidebar. O CRM possui CTA `Ver retenção`, e a tela de retenção volta para a base de clientes.

## Testes

`apps/api/src/__tests__/retention-intelligence.test.ts` cobre:

- normalização do mesmo cliente entre eventos;
- taxa de retorno;
- receita de recorrentes;
- isolamento entre Casas;
- novos x recorrentes por evento;
- presença baseada em check-in real.

## Fora do escopo

Campanhas automáticas ou disparo de marketing não entram no N6. Segmentos com opt-in existem no N5, mas ação de comunicação só deve ser ativada quando consentimento, opt-out, template e entrega estiverem validados ponta a ponta.
