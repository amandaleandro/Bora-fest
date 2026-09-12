# Registro complementar — N5 (2026-09-12)

> Registro complementar criado porque a integração usada nesta sessão não oferece edição parcial segura do `REGISTRO.md` legado, que é um arquivo muito grande. Este arquivo preserva o estado da sessão sem truncar o registro histórico.

## Estado da entrega

- Branch: `feat/n5-casa-crm`
- Entrega: N5 — Clientes / CRM da Casa
- Base: N4 já mergeado na `main` (`c9cc4b3b91f03f6cb78f2d0f580d119f2c79e3e7`)
- Migration: nenhuma

## O que entrou

- endpoint autenticado `GET /v1/organizations/:organizationId/customers`;
- acesso restrito a `FINANCE_VIEW` por conter PII de compradores;
- CRM derivado de `Order`, `Event`, `Ticket`, `User`, `OrganizationFollow` e `PromoterLink`;
- identidade consolidada pelo e-mail normalizado usado na compra, incluindo checkout convidado;
- métricas de pedidos pagos, eventos distintos, gasto, primeira/última compra, último evento passado, próximo evento futuro, tickets/check-ins e último promoter;
- segmentos `FIRST_TIME`, `RECURRING`, `FREQUENT`, `LAPSED_30`, `NO_SHOW`, `FOLLOWER`, `EMAIL_OPT_IN`;
- busca server-side por nome, e-mail e telefone e paginação;
- resumo de segmentos calculado sobre a base pesquisada, sem mudar de significado ao selecionar um segmento;
- painel `/organizacoes/:orgId/clientes` com busca, chips, cards de resumo, cards de cliente e carregar mais;
- item `Clientes` no menu da Casa;
- testes de consolidação case-insensitive, recorrência, follow/opt-in, busca, isolamento multi-tenant e segmento inválido.

## Decisões de privacidade

- N5 é leitura/segmentação; não dispara campanha.
- `EMAIL_OPT_IN` só aparece quando `User.notifyEmailOffers=true`; consentimento não é inferido de compra, follow ou telefone.
- Não existe autorização presumida para WhatsApp.
- Não foi criada uma tabela `Customer`, evitando duplicação de PII e mantendo os registros operacionais como fonte de verdade.

## Onde paramos

O CRM base da Casa está pronto para revisão/merge. A próxima evolução planejada é N6 — campanhas/reengajamento, começando por e-mail e exigindo opt-in explícito, com auditoria de envio e atribuição de receita.

## Observação de CI

O GitHub Actions continua com o problema preexistente de infraestrutura: o job `build-test` encerra antes de qualquer step, com `runner_id=0` e `steps=[]`. Não considerar essa falha como execução de testes do N5.
