# N4 — Operação de promoters por evento

Data: 2026-09-12

## Objetivo

Transformar o vínculo de promoter já existente em uma visão operacional por evento, sem criar um segundo sistema de atribuição.

## Fonte de verdade

O placar usa os dados já gravados na venda:

- `Order.promoterLinkId`: promoter atribuído;
- `Order.promoterSellerId`: vendedor abaixo do promoter, quando houver;
- `OrderItem.quantity`: quantidade real de ingressos do pedido;
- `Order.totalCents`: faturamento atribuído;
- `Order.promoterCommissionCents`: comissão calculada no pedido.

Só entram pedidos `PAID` ou `FULFILLED`, seguindo a mesma semântica usada pela visão de promoters existente.

## Regras do placar

- Ranking principal: ingressos vendidos; faturamento desempata.
- Venda direta = pedido atribuído ao promoter sem `promoterSellerId`.
- Venda da equipe = pedido atribuído ao mesmo promoter com `promoterSellerId`.
- Vínculo global da Casa e vínculo específico do evento são considerados.
- Convite `INVITED` aparece para gestão, mas não recebe posição no ranking.
- Promoter `REMOVED` preserva as vendas históricas. Revogar bloqueia atribuições futuras, mas não reescreve o passado.
- `activePromoters` conta apenas vínculos `ACTIVE`; totais históricos continuam incluindo vínculos removidos que efetivamente venderam.

## Autorização

A rota de desempenho aceita quem administra a equipe (`ORG_MANAGE_MEMBERS`) ou quem tem visão financeira (`FINANCE_VIEW`). Nunca recebe `userId` por query/body; o ator vem da sessão autenticada.

## API

`GET /v1/organizations/:organizationId/events/:eventId/promoters/performance`

A consulta valida que o evento pertence à organização antes de retornar qualquer dado.

## Painel

Nova tela: `/eventos/:eventId/promoters`.

Exibe:

- ingressos atribuídos aos promoters;
- faturamento atribuído;
- promoters ativos;
- comissão acumulada;
- ranking individual;
- quebra de venda direta x equipe;
- pedidos, faturamento e comissão por promoter;
- histórico preservado de promoter removido.

A rota foi incluída na sidebar desktop e nas tabs mobile do evento.

## Regressão

`apps/api/src/__tests__/promoter-performance.test.ts` cobre:

- ranking por ingressos;
- soma de pedidos/faturamento/comissão;
- separação direta x vendedor;
- convite pendente sem ranking;
- preservação do histórico depois de revogar promoter;
- isolamento do evento dentro da organização.

## Próximo incremento do domínio

Meta por promoter deve ser persistida por `promoter × evento`, e não como meta vitalícia do vínculo da Casa. Ela deve consumir este mesmo placar como fonte de progresso, sem recalcular vendas em outra implementação.
