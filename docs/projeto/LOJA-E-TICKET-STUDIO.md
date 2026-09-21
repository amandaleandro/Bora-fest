# BoraFest — Loja da Casa e Ticket Studio

> Estado: implementação estrutural iniciada em 21/09/2026.
>
> Este documento define o que existe, as regras de negócio e o que NÃO deve ser improvisado.

## 1. Decisão de arquitetura

Existem dois conceitos diferentes e eles não devem ser misturados:

### EventAddOn
Adicional ligado a um evento:
- estacionamento;
- consumação;
- open bar extra;
- kit do evento;
- outro upsell contextual.

Continua usando:
- `EventAddOn`;
- `OrderAddOnItem`;
- checkout do evento.

### StoreProduct
Produto permanente da Casa:
- camiseta;
- copo;
- jersey;
- boné;
- kit;
- merchandise em geral.

Usa:
- `StoreProduct`;
- `StoreProductVariant`.

Um produto da Casa não deve precisar de um evento fictício para existir.

---

## 2. BF-021 — Loja da Casa

### Implementado

Banco:
- `StoreProduct`;
- `StoreProductVariant`;
- `StoreProductStatus`.

Produto:
- nome;
- slug por Casa;
- descrição;
- imagem;
- status DRAFT / ACTIVE / ARCHIVED.

Variação:
- nome;
- SKU opcional;
- preço;
- estoque total;
- reservado;
- vendido;
- ativo/inativo.

Disponível:
`stockTotal - reservedCount - soldCount`

Gestão:
`/organizacoes/[orgId]/loja`

Vitrine:
`/casa/[slug]`

API:
- `GET /v1/organizations/:organizationId/store/products`;
- `POST /v1/organizations/:organizationId/store/products`;
- `PATCH /v1/store/products/:productId`;
- `POST /v1/store/products/:productId/variants`;
- `PATCH /v1/store/variants/:variantId`;
- `GET /v1/public/casas/:slug/store`.

### Regras críticas

- produto nasce DRAFT;
- produto não pode virar ACTIVE sem ao menos uma variação ativa;
- estoque total não pode ser reduzido abaixo de vendido + reservado;
- produto DRAFT/ARCHIVED não aparece publicamente;
- variação inativa não aparece na vitrine;
- Casa excluída por homologação não expõe loja;
- filtro de homologação deve preservar o slug exato solicitado;
- produto ativo pode manter a página pública da Casa mesmo quando não existe evento publicado.

### Segurança de imagem

Imagem externa de produto:
- aceita somente HTTP/HTTPS;
- na vitrine pública usa `<img>` direto no navegador;
- não passa pelo proxy `/_next/image`;
- preserva a allowlist anti-SSRF do Next.

### Ainda NÃO implementado

Venda direta sem ingresso.

Não criar:
- evento oculto;
- lote falso;
- Order de ingresso vazio;
- Payment apontando para pedido inventado.

O modelo atual de `Payment` exige `orderId` de um `Order` de evento. A venda direta precisa de uma decisão estrutural:
1. criar `StoreOrder / StoreOrderItem / StorePayment`; ou
2. generalizar o modelo de pedido para commerce order de forma compatível com ingressos.

Antes disso, a página pública informa que compra direta está em preparação e não mostra CTA falso.

### Próxima etapa da venda

Quando implementada, precisa cobrir:
- reserva atômica de estoque;
- expiração da reserva;
- Pix/cartão;
- idempotência;
- confirmação de venda;
- devolução de estoque em falha/expiração/reembolso;
- ledger;
- taxa da plataforma;
- retirada/entrega;
- status do pedido;
- recibo;
- reembolso;
- CRM;
- relatórios.

---

## 3. BF-020 — Ticket Studio

### Implementado

Evento possui `ticketTheme JSON`.

Templates:
- CLASSIC;
- DARK;
- FESTA;
- PREMIUM.

Campos:
- cor principal;
- cor secundária;
- imagem de fundo;
- logo;
- texto de patrocinador;
- mostrar local;
- mostrar lote;
- mostrar participante.

Editor:
`/eventos/[eventId]/ticket-studio`

A carteira real do comprador aplica o tema.

### Regra de segurança

O tema visual NUNCA controla:
- `qrToken`;
- código do ingresso;
- status;
- assinatura Ed25519;
- evento do ingresso;
- validade;
- check-in;
- posse/transferência.

QR e código permanecem sempre visíveis.

A customização só modifica apresentação.

### Convidados e cortesias

Identificação operacional de convidado/cortesia tem prioridade sobre o tema quando necessário.

O tema não pode esconder a natureza de uma cortesia nem tornar um ingresso gratuito transferível.

### URLs visuais

Logo e background digitados no Ticket Studio aceitam apenas HTTP/HTTPS.

Para produção em escala, a evolução recomendada é upload gerenciado pelo BoraFest em vez de depender de URL externa.

### Ainda NÃO implementado

- PNG completo personalizado;
- PDF personalizado;
- Apple Wallet;
- Google Wallet;
- editor drag-and-drop;
- posição livre do QR;
- tema padrão herdado automaticamente da Casa;
- biblioteca de patrocinadores.

E-mail/WhatsApp continuam entregando o fluxo atual de ingresso/QR/link. Não declarar que enviam uma arte completa personalizada.

---

## 4. Perfil permanente da Casa

A Casa pública pode existir quando houver:
- ao menos um evento publicado; OU
- ao menos um produto ACTIVE.

Isso permite:
- Casa entre temporadas;
- loja permanente;
- perfil compartilhável sem evento atual.

A listagem de descoberta de eventos continua priorizando Casas com agenda futura. Não misturar ranking de eventos com ranking de comércio sem decisão de produto.

---

## 5. Homologação

As duas superfícies respeitam:
`PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS`

Bug que não pode retornar:

Nunca fazer:
```ts
{
  slug,
  ...{ slug: { notIn: excluded } }
}
```

O segundo `slug` sobrescreve o primeiro e pode retornar outra organização.

Para lookup exato:
```ts
slug: excluded.length
  ? { equals: slug, notIn: excluded }
  : slug
```

Há regressão automatizada com duas Casas públicas simultâneas.

---

## 6. Estoque

`stockTotal` significa a quantidade total cadastrada para a variação.

Não usar o nome `stockOnHand` para esse modelo porque disponível é calculado:

```
disponível = stockTotal - reservedCount - soldCount
```

Reposição futura deve aumentar `stockTotal` ou, se evoluirmos para movimentos de estoque, alimentar um ledger de inventário.

---

## 7. Testes adicionados

`store-and-ticket-theme.test.ts`:
- produto sem variação não publica;
- produto com variação aparece;
- disponibilidade correta;
- estoque não fica menor que vendido + reservado;
- homologação não vaza loja;
- tema é persistido;
- cor inválida é recusada.

`houses.test.ts`:
- exclusão de homologação não troca Casa por outro slug;
- produto ativo mantém perfil da Casa mesmo sem evento publicado.

---

## 8. Pendências antes de deploy

- gerar Prisma Client com a nova migration;
- aplicar migration em ambiente de teste;
- executar typecheck/build/test;
- smoke test do painel da Loja;
- smoke test do Ticket Studio;
- validar reset de tema;
- validar produto ativo/inativo;
- validar Casa store-only;
- validar homologação;
- revisar CSP/domínios de imagens se política de mídia mudar.

CI continua deliberadamente para o fechamento final da rodada, conforme decisão atual do projeto.
