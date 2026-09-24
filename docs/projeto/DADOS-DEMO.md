# Dados fictícios de homologação

O comando abaixo cria ou atualiza a Casa `borafest-demo`, dois eventos futuros
marcados `[DEMO]`, lotes de ingressos e uma camiseta fictícia na Loja.
Não cria compras, pagamentos, usuários ou ingressos falsos: esses fluxos devem
ser exercitados pelos testes de integração ou manualmente com o gateway `mock`.

Use somente um banco isolado de desenvolvimento/homologação, após aplicar as
migrations e criar os papéis base:

```bash
pnpm --filter @borafest/database exec prisma migrate deploy
pnpm --filter @borafest/database seed
NODE_ENV=development BORAFEST_SEED_DEMO=1 pnpm --filter @borafest/database seed:dev
```

O script recusa `NODE_ENV=production` e exige `BORAFEST_SEED_DEMO=1`. Pode ser
executado novamente para atualizar as datas do festival. Como muda datas de
eventos demo, não reutilize essa organização para transações reais.

Em ambientes que compartilham o mesmo catálogo público, inclua
`borafest-demo` em `PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS` da API. Nunca rode este
seed no banco de produção nem use os eventos de demonstração como destaque real.
