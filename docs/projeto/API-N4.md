# API N4 — Promoter performance

`GET /v1/organizations/:organizationId/events/:eventId/promoters/performance`

- Guard: `SessionGuard`
- Autorização: `ORG_MANAGE_MEMBERS` ou `FINANCE_VIEW`
- Escopo: o evento precisa pertencer à organização da URL
- Retorno: resumo do evento + ranking dos promoters aplicáveis (Casa inteira ou evento específico)
- Métricas: pedidos pagos, ingressos, venda direta, venda por vendedores, faturamento atribuído e comissão
- Histórico: vínculo `REMOVED` continua aparecendo quando já possui vendas atribuídas
