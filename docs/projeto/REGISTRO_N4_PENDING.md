# Registro complementar — N4 (2026-09-12)

> Registro complementar criado porque a integração usada nesta sessão não oferece edição parcial segura do `REGISTRO.md` legado, que é um arquivo muito grande. Este arquivo preserva o estado da sessão sem truncar o registro histórico.

## Estado atual

- Branch: `feat/n4-promoter-performance`
- Entrega: N4 — operação de promoters por evento
- Sem migration nesta primeira camada.
- Novo endpoint autenticado de performance por evento.
- Nova tela `/eventos/:eventId/promoters` no painel.
- Ranking por ingressos vendidos, faturamento como desempate.
- Separação de venda direta do promoter e venda por vendedor da equipe.
- Promoter removido mantém histórico atribuído; revogação só corta atribuições futuras.
- Visão permitida a gestão da equipe ou financeiro.
- Teste de regressão cobre ranking, totais, vendedor, convite, revogação e isolamento por organização.

## Onde paramos

O placar real de promoters está implementado e pronto para revisão/PR. Ele reutiliza `Order.promoterLinkId`, `Order.promoterSellerId` e `OrderItem.quantity`, sem criar uma segunda fonte de atribuição.

## Próximo passo

N4.1: persistir meta por `promoter × evento` e calcular progresso usando exclusivamente o placar do N4. Depois, seguir para CRM/segmentação de clientes da Casa.
