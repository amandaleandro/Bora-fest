# BoraFest — Registro de melhorias de produção e vitrine pública

**Data:** 17/09/2026  
**Branch:** `feat/producao-vitrine-publica`  
**PR:** #21  
**Objetivo:** corrigir inconsistências de produção, aumentar a confiança do comprador e fazer a vitrine pública representar melhor a maturidade real do BoraFest.

> **Para quem chegou agora no projeto:** leia primeiro `docs/projeto/GUIA-CONTINUIDADE.md`. Ele explica arquitetura, fluxos críticos, regras de negócio, segurança, testes, deploy e como alterar o sistema sem reintroduzir bugs antigos.
>
> Este arquivo é o **registro desta rodada específica**. O `GUIA-CONTINUIDADE.md` é a documentação permanente.

---

## 1. Escopo desta evolução

Esta evolução foi dividida em quatro frentes:

1. **Segurança operacional de vendas** — impedir vendas/reservas fora da janela válida do evento.
2. **Qualidade de cadastro** — reduzir dados públicos inconsistentes.
3. **Confiança e conversão do comprador** — melhorar home e páginas públicas.
4. **Aquisição de produtores** — apresentar o BoraFest como plataforma de operação do evento, e não apenas checkout de ingressos.

---

## 2. Alterações implementadas

### 2.1 Proteção de vendas após o encerramento

**Problema encontrado:** um evento poderia continuar com `status=PUBLISHED` depois de `endsAt`, permitindo que a interface e a API divergissem sobre a venda estar aberta.

**Alterações:**
- A reserva pública é recusada no backend quando `endsAt <= agora`, mesmo se o evento continuar `PUBLISHED` por dado legado ou erro operacional.
- O checkout deixa de apresentar o fluxo de compra para eventos encerrados.
- O comprador recebe uma mensagem explícita de “Vendas encerradas”.

**Arquivos afetados:**
- `apps/api/src/reservations/reservations.service.ts`
- `apps/checkout/app/[slug]/EventPurchaseForm.tsx`

**Critério de aceite:** nenhuma nova reserva pode ser criada após o término do evento.

**Atenção para manutenção futura:** não remova a validação do backend só porque a UI já esconde o botão. A UI é experiência; a API é a barreira real.

---

### 2.2 Qualidade de cadastro de eventos e locais

**Problemas encontrados:**
- combinações de cidade/UF inconsistentes poderiam chegar à vitrine;
- datas de término inválidas poderiam ser cadastradas.

**Alterações:**
- UF agora aceita apenas as 27 siglas brasileiras válidas;
- campos de nome, cidade e endereço passam por `trim`;
- criação de evento exige `endsAt > startsAt`;
- edição valida a mesma relação quando início e fim forem alterados juntos.

**Arquivo afetado:**
- `packages/contracts/src/events.ts`

**Critério de aceite:** cadastros com UF inválida ou término anterior/igual ao início devem ser recusados pela API.

**Atenção para manutenção futura:** contratos compartilhados devem continuar em `packages/contracts` quando forem consumidos por mais de uma aplicação.

---

### 2.3 Nova vitrine para produtores

**Problema encontrado:** o site público não explicava a profundidade real do produto e levava “Produza seu evento” praticamente direto ao cadastro.

**Alterações:**
- nova rota pública `/para-produtores`;
- comunicação das capacidades de ingressos e lotes;
- promoters e listas;
- portaria offline;
- PDV de porta;
- VIP e reservas;
- financeiro;
- segmentos atendidos;
- CTAs para criação de conta e painel;
- header e footer conectados à nova landing.

**Arquivos afetados:**
- `apps/checkout/app/para-produtores/page.tsx`
- `apps/checkout/components/SiteChrome.tsx`

**Critério de aceite:** um produtor novo deve conseguir entender o que o BoraFest oferece antes de criar a conta.

---

### 2.4 Confiança do comprador

**Problema encontrado:** a aplicação possuía controles reais de pagamento, ingresso e portaria, mas isso era pouco perceptível na vitrine.

**Alterações:**
- home ganhou o bloco **“Do ingresso à entrada”**;
- página do evento ganhou sinais de confiança sobre pagamento;
- reforço de QR individual;
- reforço de acesso sem app obrigatório.

**Objetivo de UX:** transmitir confiança sem transformar a tela em publicidade excessiva.

**Regra editorial:** nunca prometer algo que o fluxo técnico não garanta.

---

## 3. Bloco complementar implementado

### 3.1 Hero institucional de fallback — implementado

**Regra desejada:** um evento qualquer não deve virar automaticamente o grande destaque da home.

Quando houver evidência real de destaque, a home pode usar um evento. Quando não houver, deve exibir um hero institucional com:

- “Seu próximo rolê começa aqui”;
- busca;
- cidade;
- categorias;
- CTA “Explorar eventos”;
- CTA secundário para produtores.

**Princípio:** destaque comercial não deve ser inventado.

**Arquivo central:** `apps/checkout/app/HomeClient.tsx`.

**Cenários obrigatórios de teste:**
- nenhum evento;
- um evento sem vendas;
- múltiplos eventos sem vendas;
- múltiplos eventos com procura real;
- filtro por cidade;
- filtro por categoria;
- mobile;
- desktop.

---

### 3.2 Busca pública melhorada — primeira etapa implementada

A busca deve evoluir de correspondência somente por título para uma experiência que possa encontrar por:

- título;
- cidade;
- local;
- Casa/produtor;
- categoria;
- atração, quando disponível.

A primeira etapa pode permanecer client-side usando os dados já carregados; a etapa seguinte deve evoluir a API de catálogo para pesquisa dedicada.

**Evitar:** criar busca client-side que pareça global, mas só pesquise parte dos eventos carregados.

---

### 3.3 Publicação/republicação de evento vencido — implementado

**Regra obrigatória:** o painel não deve permitir publicar ou republicar um evento cujo `endsAt` já esteja no passado.

A proteção deve existir no backend e não apenas no botão do painel.

**Mensagem esperada:** “Atualize a data do evento antes de abrir as vendas.”

**Arquivo central:** `apps/api/src/events/events.service.ts`.

**Critérios de aceite:**
- DRAFT vencido não publica;
- SALES_PAUSED vencido não republica;
- evento futuro continua publicando normalmente;
- alteração da data para uma janela válida permite publicação novamente.

---

### 3.4 FAQ e políticas no evento — implementado

A página pública deve apresentar, de forma clara:

- como o ingresso é entregue;
- como funciona o QR Code;
- exigência de documento quando aplicável;
- meia-entrada quando habilitada;
- regras e classificação do evento;
- cancelamento/reembolso com link para política oficial;
- responsabilidade do organizador por informações específicas do evento.

Não devem ser inventadas políticas que ainda não existam no modelo/contrato do produto.

**Arquivo central:** `apps/checkout/app/[slug]/EventPageClient.tsx`.

---

## 4. Pendências de produção que não são resolvidas apenas por código

Estas tarefas exigem revisão dos dados/ambiente:

- despublicar/remover eventos de teste existentes;
- corrigir registros antigos com cidade/UF incorretos;
- revisar eventos publicados cujo `endsAt` esteja errado;
- separar eventos de homologação/teste do catálogo público;
- validar banners, títulos e descrições atualmente publicados;
- executar smoke test após deploy.

**Importante:** não confundir “o código impede novos erros” com “os dados antigos já estão corrigidos”. São duas tarefas diferentes.

---

## 5. Regras de produto adotadas

- “Em alta” só deve existir com evidência real de procura/vendas.
- Não usar urgência falsa.
- Evento encerrado nunca aceita nova reserva.
- A UI não é a autoridade de regra de negócio; o backend deve proteger a operação.
- Taxas devem continuar transparentes.
- Conteúdo de teste não deve aparecer na experiência pública.
- O BoraFest deve se posicionar como operação completa do evento: venda, promoters, listas, VIP, portaria, PDV e financeiro.
- Métricas de promoter devem separar cadastrado, vendido e entrou.
- Falha de internet na portaria não deve virar “ingresso inválido”.
- Dinheiro, estoque, acesso e permissões exigem proteção server-side.

---

## 6. Mapa rápido para manutenção

| Se você vai mexer em… | Comece por… | Também revise… |
|---|---|---|
| Home pública | `apps/checkout/app/HomeClient.tsx` | catálogo público/API, cards e filtros |
| Página do evento | `apps/checkout/app/[slug]/EventPageClient.tsx` | TicketSelector, contratos e catálogo |
| Reserva | `apps/api/src/reservations/` | inventory, waiting-room e checkout |
| Evento/publicação | `apps/api/src/events/` | contracts e painel producer |
| Pagamento | módulos de payment/order | ledger, worker, webhook e emissão |
| Portaria | check-in/gate | offline sync, manifests e auditoria |
| PDV | orders/PDV | estoque, ledger, idempotência |
| Promoter/listas | módulos promoter/list | relatórios, check-in e métricas |
| VIP | `apps/api/src/vip/` | payments e inventário |
| Financeiro | ledger/orders/payments | reembolso e repasse |
| Validação compartilhada | `packages/contracts` | clientes que consomem o contrato |
| Banco/migration | `packages/database` | worker/API e estratégia de deploy |

Para contexto completo, consulte `docs/projeto/GUIA-CONTINUIDADE.md`.

---

## 7. Checklist de validação antes do merge

- [x] Reserva bloqueada após `endsAt`.
- [x] Checkout trata evento encerrado.
- [x] UF validada.
- [x] Relação início/fim validada no cadastro.
- [x] Landing `/para-produtores` criada.
- [x] Header/footer atualizados.
- [x] Blocos de confiança adicionados.
- [x] Guia permanente de continuidade criado.
- [x] Bloqueio de publicar evento vencido.
- [x] Bloqueio de republicar evento vencido.
- [x] Hero institucional de fallback.
- [x] Busca pública ampliada na primeira etapa client-side (título, local, cidade, UF e categoria).
- [x] FAQ/políticas na página do evento.
- [x] Teste automatizado adicionado para publicação/republicação vencida e PATCH parcial de datas (`event-sales-window.test.ts`).
- [ ] CI executado com sucesso — nenhum workflow foi disparado automaticamente para o head atual.
- [ ] Smoke test após deploy.

---

## 8. Definição de pronto deste ciclo

Este ciclo será considerado concluído quando:

1. eventos vencidos não puderem vender nem ser reabertos sem correção de data;
2. a home não promover automaticamente conteúdo fraco como destaque principal;
3. comprador conseguir entender busca, evento, pagamento e entrada com clareza;
4. produtor conseguir entender o valor do BoraFest antes de criar conta;
5. mudanças estiverem documentadas e com critérios de aceite;
6. build/testes disponíveis forem executados;
7. produção passar por smoke test depois do merge/deploy.

---

## 9. Próximas fases após este ciclo

1. Dashboard operacional do produtor.
2. Promoters e listas como diferencial central.
3. Financeiro e repasses com maior transparência.
4. Favoritos sincronizados e seguir Casas.
5. CRM e campanhas.
6. Observabilidade e alertas operacionais.
7. Consumação/cashless como fase separada.

---

## 10. Política de documentação deste projeto

Toda alteração relevante deve registrar:

- **o que mudou**;
- **por que mudou**;
- **arquivos/módulos afetados**;
- **regra de negócio envolvida**;
- **como validar**;
- **risco de regressão**;
- **o que ficou pendente**.

Quando a mudança corrigir um bug estrutural, documentar também **o comportamento que não pode voltar**, para evitar que alguém no futuro “simplifique” uma proteção importante.

O guia permanente fica em `docs/projeto/GUIA-CONTINUIDADE.md`.


---

## 11. Implementação complementar de 18/09/2026

### 11.1 Backend — publicação segura

**Arquivo:** `apps/api/src/events/events.service.ts`

Alterações:
- `publish()` recusa `DRAFT` cujo `endsAt <= agora`;
- `republish()` recusa `SALES_PAUSED` cujo `endsAt <= agora`;
- mensagem orienta o produtor a atualizar a data antes de abrir as vendas;
- `update()` agora valida o intervalo temporal mesmo quando apenas uma das duas datas é alterada, usando a outra data já persistida no evento.

**Bug que não pode voltar:** validar `startsAt/endsAt` somente quando ambos vierem no mesmo PATCH deixa uma atualização parcial criar intervalo inválido.

### 11.2 Home — destaque honesto

**Arquivo:** `apps/checkout/app/HomeClient.tsx`

Alterações:
- próximo evento deixou de virar hero automaticamente;
- hero de evento só é usado quando existe item em `sections.highlights`, que representa destaque derivado de procura real;
- sem destaque real, entra hero institucional “Seu próximo rolê começa aqui”;
- fallback existe em desktop e mobile;
- CTA secundário leva à página `/para-produtores`;
- busca passa a normalizar acentos e pesquisar título, nome do local, cidade, UF e categoria;
- resultado vazio explica alternativas e oferece “Limpar filtros”.

**Limitação conhecida:** a busca desta etapa continua client-side e só conhece os campos presentes em `EventListItem`. Busca global por produtor/Casa/line-up exige evolução do endpoint público e do contrato.

### 11.3 Evento — FAQ e políticas

**Arquivo:** `apps/checkout/app/[slug]/EventPageClient.tsx`

Alterações:
- nova seção “Ingresso, entrada e políticas”;
- explica entrega do ingresso sem prometer canal específico não garantido;
- informa que app não é obrigatório;
- explica QR individual;
- orienta sobre documento/classificação quando aplicável;
- links diretos para `/legal?aba=termos` e `/legal?aba=privacidade`;
- conteúdo específico do evento continua atribuído ao organizador.

**Regra editorial:** não copiar para a página do evento uma política jurídica mais específica do que o produto realmente garante.


### 11.4 Teste de regressão

**Arquivo:** `apps/api/src/__tests__/event-sales-window.test.ts`

Cobre:
- tentativa de publicar DRAFT vencido;
- tentativa de republicar SALES_PAUSED vencido;
- PATCH apenas de `startsAt` criando intervalo inválido;
- controle positivo: evento futuro válido continua publicando.

**Estado da execução:** teste foi adicionado à suíte, mas o GitHub não disparou workflow/CI para o commit atual. Não considerar “verde” até executar `pnpm test`, `pnpm typecheck` e build em ambiente com dependências/infra disponíveis.


---

## 12. Homologação e busca pública — 18/09/2026

### 12.1 Isolamento de organizações de teste

**Configuração:** `PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS`

**Arquivos:**
- `apps/api/src/catalog/catalog.service.ts`
- `.env.example`
- `.env.production.example`
- `docs/projeto/HOMOLOGACAO-CATALOGO-E-BUSCA.md`

**Comportamento:**
- organizações listadas pela variável ficam fora da lista pública;
- ficam fora da home;
- não geram cidades públicas;
- URL direta do evento fica indisponível publicamente;
- disponibilidade pública também fica indisponível porque depende do detalhe público.

**Decisão:** não esconder conteúdo com heurística de título. A exclusão é explícita por organização.

**Risco operacional:** se uma nova organização de homologação for criada e seu slug não for configurado em produção, ela poderá aparecer publicamente caso publique eventos.

### 12.2 Busca pública no backend

**Endpoint:** `GET /v1/public/events?q=...`

A busca passa a considerar:
- título;
- line-up/atrações;
- nome do local;
- cidade;
- organização/Casa;
- nome comercial;
- slug da organização.

O frontend envia a consulta após debounce de 250 ms, combinando com cidade e categoria.

### 12.3 Teste de regressão

**Arquivo:** `apps/api/src/__tests__/public-catalog-hygiene.test.ts`

Cobre busca por Casa/produtor e atração, além da invisibilidade de uma organização excluída na lista, home e detalhe público.

**Estado da execução:** adicionado à suíte. A execução automatizada ainda depende do CI, que não estava disparando nos commits anteriores.


### 12.4 Estado do CI no commit atual

O GitHub Actions disparou o workflow `CI`, porém o job `build-test` terminou como `failure` antes de iniciar qualquer step.

Evidências do run:
- `runner_id: 0`;
- `steps: []`;
- duração de poucos segundos;
- nenhuma etapa de checkout, install, build ou teste chegou a executar.

**Interpretação:** falha de infraestrutura/provisionamento do GitHub Actions. Não classificar este estado como “testes falharam”, porque os testes não chegaram a rodar. Também não classificar como “validado”.

Antes do merge/deploy, executar com sucesso:
- `pnpm install --frozen-lockfile`;
- geração do Prisma Client;
- `pnpm build`;
- `pnpm test`;
- typecheck do app de check-in;
- verificação cruzada do QR conforme `.github/workflows/ci.yml`.


---

## 13. Pré-publicação e limite de layout — 18/09/2026

### 13.1 Checklist do produtor

**Arquivos:**
- `apps/api/src/dashboard/dashboard.service.ts`
- `apps/producer/lib/api.ts`
- `apps/producer/app/eventos/[eventId]/page.tsx`

O painel agora diferencia:
- **obrigatório:** data do evento ainda válida;
- **recomendado:** categoria, local, banner e pelo menos um lote online ativo.

A data vencida bloqueia os botões de publicar/reabrir no frontend, mas a proteção definitiva continua no backend.

O lote recomendado como “online ativo” precisa estar `ACTIVE` e não pode ser `pdvOnly`.

### 13.2 Correção de escopo da faixa de confiança

**Problema:** `apps/checkout/app/[slug]/layout.tsx` envolvia também `/[slug]/ingressos` e `/[slug]/vip`, fazendo o conteúdo institucional aparecer em jornadas filhas.

**Correção:**
- removido o layout genérico;
- criado `apps/checkout/components/EventTrustStrip.tsx`;
- faixa renderizada explicitamente apenas em `EventPageClient.tsx`.

### 13.3 Testes/documentação

- `local-evento.test.ts` passou a exigir datas e `pdvOnly` no dashboard;
- documentação operacional: `docs/projeto/PRE-PUBLICACAO-E-PAGINA-PUBLICA.md`.

**Regra que não pode voltar:** conteúdo específico do hotsite não deve ser colocado em layout que também envolve checkout/VIP sem revisar todas as rotas filhas.


---

## 14. Inventário oficial, alertas de integridade e auditoria de produção — 21/09/2026

### 14.1 Inventário

Criado `docs/projeto/INVENTARIO-FEATURES-E-LACUNAS.md`.

O inventário evita reconstruir módulos que já existem e separa:
- pronto;
- parcial;
- novo;
- futuro.

### 14.2 Observabilidade de negócio

Adicionados alertas Prometheus:
- `BoraFestPaidOrderWithoutTicket`;
- `BoraFestOutboxFailed`;
- `BoraFestOutboxStale`.

Runbook:
`docs/projeto/RUNBOOK-INCIDENTES.md`.

### 14.3 Auditoria de catálogo

Script:
`packages/database/src/auditoria-catalogo-producao.ts`

Comando:
`pnpm --filter @borafest/database auditoria-catalogo`

O script é SOMENTE LEITURA e reporta:
- eventos vencidos ainda PUBLISHED;
- eventos ativos com problemas de dados;
- publicação sem banner/categoria/lote online;
- UF/local inválido;
- organizações com aparência de teste/homologação ainda não configuradas na exclusão pública.

A heurística de nome é usada apenas para RELATÓRIO HUMANO. Ela nunca esconde dados automaticamente.


---

## 15. BF-020 Ticket Studio + BF-021 Loja da Casa — 21/09/2026

### 15.1 Ticket Studio

**Banco**
- `Event.ticketTheme` em JSON;
- migration `20260921163000_ticket_theme_store_catalog`.

**Contrato**
- templates CLASSIC, DARK, FESTA e PREMIUM;
- cores hex;
- background/logo HTTP(S);
- texto de patrocinador;
- toggles de local/lote/participante.

**Painel**
- rota `/eventos/[eventId]/ticket-studio`;
- editor com presets e preview;
- reset usa `Prisma.DbNull`, limpando o JSON do banco.

**Comprador**
- carteira real aplica tema;
- QR e código nunca podem ser escondidos pelo tema;
- cortesia/convidado mantém identificação operacional.

### 15.2 Loja da Casa

**Decisão:** não transformar `EventAddOn` em produto permanente.

Criados:
- `StoreProduct`;
- `StoreProductVariant`;
- status DRAFT / ACTIVE / ARCHIVED;
- SKU;
- `stockTotal`, reservado e vendido.

Regras:
- produto não publica sem variação ativa;
- estoque total não pode ficar abaixo de vendido + reservado;
- disponibilidade = estoque total − reservado − vendido;
- apenas produto ACTIVE e variação ativa aparecem;
- homologação é aplicada;
- Casa pode manter perfil público por produto ACTIVE mesmo sem evento PUBLISHED.

Painel:
`/organizacoes/[orgId]/loja`

Vitrine:
`/casa/[slug]`

### 15.3 Bugs encontrados e corrigidos

1. **Filtro de homologação sobrescrevendo slug exato**
   - Store e Casa tinham risco de `{ slug, ...{ slug: { notIn } } }`;
   - o segundo campo sobrescrevia o primeiro;
   - agora lookup exato combina `equals` + `notIn`;
   - teste usa duas Casas públicas para provar que a excluída não vira outra Casa.

2. **Nome de estoque enganoso**
   - `stockOnHand` foi renomeado antes do deploy para `stockTotal`;
   - disponível é calculado descontando vendido/reservado.

3. **Tema resetado como JSON null**
   - corrigido para `Prisma.DbNull`.

4. **Métricas de integridade**
   - worker passou a alimentar de fato gauges usados pelos alertas de PAID sem ingresso e outbox problemático.

5. **Imagem externa e Next Image**
   - produto externo não passa pelo proxy de imagem do Next;
   - mantém a allowlist anti-SSRF do servidor;
   - URLs de imagem agora são HTTP/HTTPS.

### 15.4 Venda direta

Ainda não implementada deliberadamente.

O `Payment` atual pertence a `Order` de evento. Não será criado evento escondido ou pedido falso para vender merchandise.

A próxima evolução precisa decidir entre:
- `StoreOrder/StorePayment`; ou
- generalização segura do pedido comercial.

Documento completo:
`docs/projeto/LOJA-E-TICKET-STUDIO.md`.


### 15.5 Correções adicionais da revisão estática

- auditoria de catálogo importava `./client`, arquivo inexistente; corrigido para `./index`;
- `EventsService` usava `Prisma.DbNull/InputJsonValue` sem importar `Prisma`;
- mídia do Ticket Studio agora exige host controlado pelo BoraFest, além de HTTPS;
- imagens de produto exigem HTTPS em produção;
- imagem externa de produto não passa pelo proxy do Next, preservando a allowlist anti-SSRF;
- Organization do painel passou a carregar `logoUrl` para o Ticket Studio reaproveitar a identidade da Casa;
- duplicidade de nome/SKU de variante agora responde erro de negócio em vez de P2002/500;
- testes ampliados para duplicidade e asset externo de ingresso.


---

## 15. Correções de robustez da Loja e Ticket Studio — 21/09/2026

- estoque agora é protegido no service e no banco;
- a constraint adicional entrou em migration incremental, sem reescrever migration compartilhada;
- teste tenta quebrar o estoque diretamente pelo Prisma;
- carteira logada passou a aplicar o mesmo Ticket Studio da carteira por link;
- `orderPublicToken` foi tipado como nullable para ingresso transferido;
- documentação e inventário atualizados para refletir o estado real da implementação.


---

## 16. Correções adversariais de estoque, lotes e promoter — 21/09/2026

### 16.1 Reembolso acumulado restaurando estoque

Corrigido caso em que dois ou mais estornos parciais somavam 100% do ingresso:
- pedido/pagamento fechavam como `REFUNDED`;
- ticket era revogado;
- mas `soldCount` permanecia alto.

Agora, ao atingir 100%, os itens do pedido passam por `returnSaleInventory`.

Teste: `refund-async-accounting.test.ts`.

### 16.2 Estado real do lote

`confirmSaleInventory` e `InventoryService.confirmSale` marcam `SOLD_OUT` quando a venda completa a capacidade.

`returnSaleInventory`:
- `SOLD_OUT` + unidade devolvida -> `ACTIVE`;
- `CLOSED` manual permanece `CLOSED`.

O catálogo continua retornando lote `SOLD_OUT` para a UI mostrar “Esgotado”, mas a reserva exige `ACTIVE`.

### 16.3 Janela real do lote

`TicketLot.startsAt/endsAt` agora valem no servidor:
- futuro: não aparece para venda e reserva recusa;
- encerrado: não aparece para venda e reserva recusa;
- ativação de lote já vencido é recusada;
- contrato rejeita `endsAt <= startsAt`.

Teste: `lot-access-window.test.ts`.

### 16.4 Lote exclusivo de promoter

Corrigido fluxo ponta a ponta:
- `GET /v1/public/events/:slug?pr=&vd=`;
- resposta exclusiva usa `private, no-store`;
- SSR do hotsite respeita `pr/vd`;
- revalidação client-side respeita atribuição;
- clique de reserva recaptura a URL;
- reserva prova promoter/vendedor;
- pedido repete a validação para impedir remoção da atribuição após reservar.

Teste cobre público geral, promoter válido, vendedor válido, reserva sem prova e pedido sem atribuição.

### 16.5 Estado público

A página pública agora diferencia:
- Vendas abertas;
- Evento em andamento;
- Esgotado;
- Ingressos indisponíveis;
- Vendas encerradas.

“Sem lote visível” não é mais apresentado como “Vendas abertas”.

### 16.6 Segurança de e-mail

Título do evento e link são escapados no HTML enviado aos seguidores.

### 16.7 Loja

- produto publicado não pode perder a última variação ativa;
- criação/rename concorrente trata colisão de slug sem 500;
- teste concorrente verifica slugs distintos.
