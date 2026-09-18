# BoraFest — Homologação, catálogo público e busca

> Documento operacional para impedir que dados de teste apareçam na vitrine e para explicar como funciona a busca pública.
>
> Criado em 18/09/2026.

## 1. Problema que este documento resolve

O BoraFest pode ter organizações usadas para:
- homologação;
- demonstração;
- testes internos;
- validação de integrações;
- treinamento da operação.

Essas organizações podem precisar de eventos publicados para testar checkout, portaria, PDV e outros fluxos, mas esses eventos **não devem aparecer para o público real**.

Não usamos heurística por título como “teste”, “demo” ou “homologação”, porque isso é frágil e pode esconder um evento legítimo.

## 2. Estratégia adotada

O isolamento é feito por **slug da organização**.

Variável:

`PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS`

Formato:

```env
PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS=homologacao-interna,demo-borafest
```

Use os slugs exatos das organizações internas, separados por vírgula.

## 3. Onde o filtro é aplicado

Arquivo central:

`apps/api/src/catalog/catalog.service.ts`

A função `publicCatalogOrganizationFilter()` transforma a configuração em um filtro Prisma.

O filtro é aplicado em:
- lista pública de eventos;
- seletor público de cidades;
- seções da home;
- detalhe público do evento;
- disponibilidade pública, indiretamente via detalhe público.

Consequência: um evento de organização excluída não deve aparecer nem ser acessível por URL pública normal.

## 4. O que NÃO é afetado

A configuração é específica do catálogo público.

Ela não deve impedir:
- produtor de abrir o evento no painel;
- equipe de operar check-in;
- PDV autenticado;
- relatórios internos;
- testes de pagamento em ambiente controlado;
- operações administrativas.

Se uma organização precisa desaparecer também do painel/admin, isso é outro requisito e não deve ser resolvido por este filtro.

## 5. Como criar uma organização de homologação

Recomendação:

1. crie organização claramente identificada internamente;
2. use slug estável, por exemplo `homologacao-borafest`;
3. adicione esse slug à variável `PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS`;
4. reinicie/republique a API;
5. valide:
   - não aparece na home;
   - não aparece em explorar/lista;
   - cidade exclusiva dela não aparece no seletor;
   - URL direta pública retorna evento não encontrado;
   - painel autenticado continua funcionando.

## 6. Produção

Em `.env.production`:

```env
PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS=homologacao-borafest,demo-interno
```

O arquivo `.env.production.example` documenta a chave, mas não deve conter os slugs reais se eles forem considerados informação operacional sensível.

Depois da alteração:
- recrie/reinicie o serviço da API;
- faça smoke test da home;
- teste a URL de um evento excluído;
- teste um evento público real.

## 7. Falha segura e limitações

Se a variável estiver vazia, nenhuma organização é excluída automaticamente.

Isso é intencional: o sistema **não adivinha** que uma organização é de teste.

Portanto, criar uma organização de homologação exige também atualizar a configuração de produção.

Melhoria futura possível: adicionar um campo explícito no banco, como `catalogVisibility` ou `environment`, administrado pelo backoffice. Isso exigiria migration e fluxo administrativo. A solução por variável foi escolhida nesta etapa para corrigir o risco sem alterar schema e sem criar heurísticas pelo nome.

## 8. Busca pública

Endpoint:

`GET /v1/public/events?q=<texto>`

Filtros podem ser combinados:
- `q`;
- `city`;
- `category`;
- paginação.

A busca atual consulta:
- título do evento;
- line-up/atrações;
- nome do local;
- cidade;
- nome jurídico da organização;
- nome comercial/display name;
- slug da organização.

## 9. Frontend

Arquivo:

`apps/checkout/app/HomeClient.tsx`

Comportamento:
- texto digitado entra em debounce de 250 ms;
- frontend chama o endpoint público com `q`;
- resultados continuam respeitando cidade e categoria;
- o card recebe também nome da organização e line-up para refinamento local;
- normalização client-side ignora diferenças simples de acento/capitalização quando filtra o conjunto retornado.

## 10. Limitações atuais da busca

- Não existe ranking textual avançado.
- Não existe fuzzy search para erro de digitação.
- PostgreSQL `contains` não é um mecanismo de relevância completo.
- Não existe autocomplete dedicado.
- A primeira página é limitada pela paginação pública.
- Busca por tags que não existem no modelo não é suportada.

Evolução futura recomendada:
1. endpoint dedicado de search/autocomplete;
2. `pg_trgm` ou full-text search;
3. ranking por relevância + proximidade de data + procura real;
4. sugestões de Casa, evento e atração em tipos separados;
5. métricas de termos sem resultado.

## 11. Segurança e privacidade

A busca só usa campos já considerados públicos para descoberta.

Não adicionar ao índice público:
- e-mail;
- telefone;
- CPF;
- dados bancários;
- tokens;
- nomes internos de equipe;
- informações de compradores.

## 12. Teste de regressão

Arquivo:

`apps/api/src/__tests__/public-catalog-hygiene.test.ts`

O teste cobre:
- busca por nome comercial da Casa/produtor;
- busca por atração/line-up;
- organização excluída fora da lista pública;
- organização excluída fora da home;
- URL direta escondida;
- cidade de evento público continua disponível.

## 13. Checklist ao mexer no catálogo público

- [ ] organização de homologação continua invisível;
- [ ] evento público real continua visível;
- [ ] home respeita exclusão;
- [ ] lista respeita exclusão;
- [ ] cidades respeitam exclusão;
- [ ] detalhe respeita exclusão;
- [ ] disponibilidade respeita exclusão;
- [ ] busca não expõe campo privado;
- [ ] cache inclui parâmetros que mudam resultado;
- [ ] documentação foi atualizada.
