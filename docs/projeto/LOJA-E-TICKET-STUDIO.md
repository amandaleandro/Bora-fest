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
- nome e SKU duplicados viram erro de negócio legível, nunca erro Prisma/500;
- produto DRAFT/ARCHIVED não aparece publicamente;
- variação inativa não aparece na vitrine;
- Casa excluída por homologação não expõe loja;
- filtro de homologação deve preservar o slug exato solicitado;
- produto ativo pode manter a página pública da Casa mesmo quando não existe evento publicado.

### Segurança de imagem

Imagem externa de produto:
- exige HTTPS em produção (HTTP apenas em localhost);
- na vitrine pública usa `<img>` direto no navegador;
- não passa pelo proxy `/_next/image`;
- preserva a allowlist anti-SSRF do Next.

### Venda direta implementada — 23/09/2026

A Loja possui domínio comercial próprio. Não usa evento escondido nem `Order` de ingresso.

Modelos:
- `StoreOrder`;
- `StoreOrderItem`;
- `StorePayment`;
- `StorePaymentEvent`;
- `StoreOrderStatus`;
- `StoreFulfillmentMethod`.

Migration:
`20260923160000_store_orders`.

Fluxo atual:
1. comprador seleciona variações na página da Casa;
2. backend valida produto/variação ativos e recalcula o preço;
3. estoque é reservado atomicamente por 15 minutos;
4. é criado um `StoreOrder` com snapshot de nome, variação, preço e quantidade;
5. comprador gera Pix;
6. gateway/webhook confirma o pagamento;
7. reserva vira estoque vendido;
8. ledger recebe `SALE_CREDIT` e `PLATFORM_FEE`;
9. comprador recebe código de retirada;
10. e-mail de confirmação contém itens, total, código e link do pedido;
11. Casa confere o código no painel e marca `FULFILLED`.

Rotas públicas:
- `POST /v1/public/casas/:slug/store/orders`;
- `GET /v1/public/store/orders/:publicToken`;
- `POST /v1/public/store/orders/:publicToken/payments/pix`;
- `POST /v1/public/store/orders/:publicToken/payments/sync`.

Rotas do painel:
- `GET /v1/organizations/:organizationId/store/orders`;
- `POST /v1/store/orders/:orderId/fulfill`.

Frontend:
- carrinho em `/casa/[slug]`;
- checkout em `/loja/pedido/[publicToken]`;
- operação/retirada em `/organizacoes/[orgId]/loja`.

#### Regra de estoque

Disponível continua sendo:

```
stockTotal - reservedCount - soldCount
```

Criação do pedido usa UPDATE condicional no banco. Duas compras concorrentes não podem reservar a mesma última unidade.

No `PAID`:
- `reservedCount -= quantity`;
- `soldCount += quantity`.

Na expiração sem pagamento:
- `reservedCount -= quantity`;
- pedido vira `CANCELED`.

A liberação falha fechada se não existir reserva suficiente; não usar `GREATEST(..., 0)` para esconder inconsistência.

#### Regra financeira

O pagamento da Loja reutiliza o gateway Pix/failover da plataforma, mas possui `StorePayment` próprio.

O worker de webhook procura o pagamento no domínio:
1. ticketing;
2. VIP;
3. Loja.

`StorePaymentEvent` garante deduplicação do webhook.

Pagamento confirmado:
- credita o bruto no ledger;
- lança a taxa da plataforma;
- referência contábil: `store_payment`;
- liberação financeira segue `refundHoldDays` da Casa.

Pagamento que chega depois de a reserva já ter sido cancelada é tratado como órfão e entra no estorno automático pelo outbox.

#### Estorno/chargeback

Se o produto ainda NÃO foi retirado:
- ledger é revertido;
- estoque vendido retorna.

Se o pedido já está `FULFILLED`:
- o estoque não aumenta automaticamente;
- uma devolução física futura precisa ser tratada como operação de inventário separada.

Nunca assumir que estorno financeiro significa que a mercadoria voltou fisicamente à Casa.

#### Retirada

O código de retirada:
- nasce junto com o pedido;
- não é exposto publicamente antes de pagamento;
- aparece após `PAID`;
- é enviado por e-mail;
- é exigido pelo painel para marcar `FULFILLED`.

#### Escopo atual

Implementado:
- Pix;
- retirada na Casa;
- reserva/expiração;
- webhook/reconciliação;
- ledger/taxa;
- e-mail de confirmação;
- painel de pedidos/retirada;
- estorno/chargeback vindo do gateway;
- testes de integração.

Ainda não implementado:
- cartão na Loja;
- frete/entrega/endereço;
- devolução física/reposição formal;
- reembolso self-service específico da Loja;
- pedido da Loja dentro de “Minhas compras” da conta;
- CRM/relatórios específicos de commerce;
- notificação push ao produtor para venda da Loja.

Essas evoluções devem usar `StoreOrder`; não voltar a simular comércio com evento fictício.

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

Logo e background:
- exigem HTTPS em produção;
- HTTP só é aceito em localhost;
- além do formato da URL, o backend exige host gerenciado pelo BoraFest;
- subdomínios `*.borafest.com.br` e os hosts configurados de API/site são aceitos.

Motivo: a carteira contém um token público de pedido na URL e não deve carregar assets arbitrários de servidores controlados por terceiros.

A UI oferece reaproveitar:
- arte do evento;
- logo da Casa, quando disponível.

Para novos assets, a evolução recomendada é upload gerenciado pelo BoraFest.

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

Além das migrations anteriores, aplicar:
- `20260923160000_store_orders`.

Smoke tests da Loja:
- comprar última unidade em duas sessões concorrentes;
- expirar Pix e confirmar devolução de reserva;
- pagar Pix e confirmar reservado → vendido;
- repetir webhook e confirmar ledger/estoque sem duplicação;
- validar e-mail com código de retirada;
- confirmar retirada com código correto;
- recusar código incorreto;
- estornar pedido não retirado e confirmar retorno ao estoque;
- não devolver estoque automaticamente se já foi retirado.



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


---

## 9. Correções de robustez — 21/09/2026

### 9.1 Estoque protegido em duas camadas

A API já recusava reduzir `stockTotal` abaixo de `soldCount + reservedCount`.

Agora existe também constraint no banco:

`20260921174500_store_stock_capacity`

Regra:

`stock_total >= reserved_count + sold_count`

Isso impede corrupção mesmo se alguma rotina futura contornar `StoreService`.

Teste:
`store-and-ticket-theme.test.ts` tenta violar a regra diretamente pelo Prisma e espera falha.

### 9.2 Regra de migrations

Não reescrever migration já criada/aplicada para acrescentar regra nova.

Mesmo durante desenvolvimento, se uma migration já entrou no histórico compartilhado, prefira uma migration incremental.

Comportamento que não pode retornar:
- editar uma migration antiga para “corrigir” produção;
- depender de checksum diferente entre ambientes;
- assumir que ninguém aplicou uma migration só porque CI ainda não rodou.

### 9.3 Ticket Studio consistente nas duas carteiras

O tema visual agora é aplicado em:
- `/pedido/[publicToken]`;
- `/perfil` (carteira logada).

Antes, o mesmo ingresso podia aparecer personalizado por link e genérico na conta.

A carteira logada também respeita:
- logo;
- background/gradiente;
- patrocinador;
- `showVenue`;
- `showLot`;
- `showAttendee`.

### 9.4 Transferência e segredo do pedido

Para ingresso recebido por transferência, `orderPublicToken` é `null`.

O tipo do client foi corrigido para refletir isso.

Motivo: quem recebe um ingresso não pode receber o segredo do pedido original e enxergar os demais ingressos do comprador.


---

## 10. Testes da venda da Loja — 23/09/2026

Arquivo:
`apps/api/src/__tests__/store-orders.test.ts`.

Cenários:
- pedido reserva estoque e congela preço;
- nova compra acima do disponível é recusada;
- `PAID` converte reserva em venda;
- webhook/status `PAID` repetido é idempotente;
- `SALE_CREDIT` e `PLATFORM_FEE` não duplicam;
- estorno antes da retirada devolve estoque;
- expiração devolve reserva.

Esses testes foram adicionados ao repositório, mas a execução completa continua pendente até retomarmos o CI conforme combinado.


---

## 11. Conta, preparo e pós-venda da Loja — 23/09/2026

### 11.1 Minhas compras

A conta do comprador agora possui:
`GET /v1/me/store-orders`.

Regra de segurança:
- compra como convidado pode ficar com `userId = null`;
- o pedido só é reivindicado automaticamente pela conta quando a posse do e-mail foi comprovada;
- OTP e magic link atualizam também `StoreOrder.userId`;
- `/v1/me/store-orders` só faz claim por e-mail quando `emailVerifiedAt` existe;
- não associar pedido a conta apenas porque alguém digitou o e-mail no checkout.

O frontend `/minhas-compras` mostra ingressos e, em seção própria, produtos da Loja.

Compra como convidado também é lembrada localmente em:
`bf.storeOrders`.

Esse histórico local é conveniência, não prova de propriedade para ação financeira.

### 11.2 Estados operacionais

Fluxo obrigatório:
```
PAID -> READY -> FULFILLED
```

Semântica:
- `PAID`: pagamento confirmado / pedido em preparo;
- `READY`: Casa terminou o preparo e o cliente pode retirar;
- `FULFILLED`: produto efetivamente entregue.

A retirada não pode pular READY.

Endpoint:
- `POST /v1/store/orders/:orderId/ready`;
- `POST /v1/store/orders/:orderId/fulfill`.

Ao marcar READY:
- cliente recebe e-mail;
- código de retirada é lembrado no e-mail;
- página do pedido passa a dizer “Pronto para retirada”.

### 11.3 Reembolso e devolução

Modelo:
`StoreRefundRequest`.

Status:
- `PENDING`;
- `AWAITING_RETURN`;
- `APPROVED`;
- `REJECTED`.

Migration:
`20260923190000_store_refund_requests`.

Pedido ainda não retirado:
- solicitação entra PENDING;
- aprovação chama o gateway;
- estorno financeiro reverte ledger;
- estoque vendido retorna automaticamente.

Pedido já FULFILLED:
- solicitação entra AWAITING_RETURN;
- Casa precisa confirmar recebimento físico;
- ao confirmar devolução, soldCount diminui;
- solicitação vira PENDING;
- só depois o estorno pode ser aprovado;
- o estorno financeiro NÃO reduz o estoque novamente.

Depois de `returnedAt` preenchido, rejeição é bloqueada.
Motivo: a Casa já declarou que recebeu fisicamente a mercadoria.

Endpoints:
- `POST /v1/public/store/orders/:publicToken/refund-requests` — exige sessão do dono;
- `GET /v1/organizations/:organizationId/store/refund-requests`;
- `POST .../:requestId/returned`;
- `POST .../:requestId/approve`;
- `POST .../:requestId/reject`.

### 11.4 Estorno pendente

Se o PSP responder PENDING ao refund:
- `StorePayment.status = REFUND_PENDING`;
- solicitação fica APPROVED;
- webhook posterior REFUNDED conclui a máquina de estados.

`applyStoreGatewayStatus` aceita reversão tanto de PAID quanto de REFUND_PENDING.

### 11.5 Testes adicionais

`store-orders.test.ts` agora cobre também:
- PAID -> READY;
- devolução física repõe estoque uma única vez;
- REFUNDED depois de REFUND_PENDING;
- impossibilidade de dupla reposição após devolução física.

O helper de integração limpa explicitamente:
- StorePaymentEvent;
- StorePayment;
- StoreRefundRequest;
- StoreOrderItem;
- StoreOrder;
- StoreProductVariant;
- StoreProduct.


---

## 12. Loja comercial — cartão, entrega, frete e CRM — 23/09/2026

### 12.1 Formas de recebimento

A Casa configura a Loja por:
`GET/PATCH /v1/organizations/:organizationId/store/settings`.

Campos:
- `pickupEnabled`;
- `deliveryEnabled`;
- `flatShippingCents`;
- `deliveryInstructions`.

Regra:
- pelo menos retirada ou entrega precisa permanecer habilitada;
- entrega começa desligada por padrão;
- retirada começa ligada por padrão.

A vitrine pública recebe a configuração no objeto `fulfillment`.

### 12.2 Entrega local e frete

O MVP de entrega suporta:
- retirada na Casa; ou
- entrega local com frete fixo definido pela Casa.

Para DELIVERY, o pedido guarda snapshot do endereço e separa:
- `subtotalCents`;
- `shippingCents`;
- `totalCents`;
- `shippingAddress`;
- `fulfillmentMethod`.

O navegador nunca define o valor do frete. O backend lê `storeFlatShippingCents` e calcula:

```
totalCents = subtotalCents + shippingCents
```

Não aceitar:
- frete vindo do cliente;
- DELIVERY desabilitado;
- DELIVERY sem endereço.

Ainda não existem raio/geocoding, cotação de transportadora ou rastreio.

### 12.3 Cartão

A Loja reutiliza `PaymentGateway.createCardPayment`, a mesma abstração do checkout de ingressos.

Rota:
`POST /v1/public/store/orders/:publicToken/payments/card`.

`StorePayment` persiste status, provider, valor, externalId e parcelas. PAN/CVV/raw card não são persistidos.

Migration:
`20260923210000_store_card_installments`.

### 12.4 Idempotência

Cartão exige suporte a `Idempotency-Key`.

Escopo:
`store-payments:create-card`.

O registro idempotente contém apenas:
- publicToken;
- token do PSP ou últimos 4;
- parcelas.

Nunca PAN/CVV.

No browser a chave fica em `sessionStorage`, sobrevive a timeout/retry e é removida após sucesso ou recusa explícita.

### 12.5 Operação por modalidade

PICKUP:
- PAID = preparando;
- READY = pronto para retirada;
- FULFILLED exige código de retirada.

DELIVERY:
- PAID = preparando;
- READY = pronto para entrega;
- FULFILLED = entregue;
- não usa nem expõe pickupCode.

### 12.6 Comunicação

Após PAID real:
- comprador recebe `store_order_paid`;
- owner/admin recebem `store_sale_received`.

Ao marcar READY:
- comprador recebe `store_order_ready`.

Os templates distinguem retirada e entrega.

### 12.7 Analytics e CRM

`GET /v1/organizations/:organizationId/store/orders/analytics` exige `FINANCE_VIEW`.

Retorna:
- receita;
- pedidos pagos;
- ticket médio;
- clientes únicos;
- preparo/prontos;
- retirada x entrega;
- top produtos;
- principais clientes.

CRM aqui é histórico operacional. Não transforma contatos em autorização de marketing.

### 12.8 Testes

A suíte da Loja também cobre:
- entrega desabilitada;
- frete calculado no servidor;
- endereço congelado;
- cartão incluindo frete;
- parcelas;
- analytics;
- retry idempotente do cartão.

A execução automatizada continua pendente até a etapa final de CI.
