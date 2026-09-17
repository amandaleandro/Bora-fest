# BoraFest — Registro de melhorias de produção e vitrine pública

**Data:** 17/09/2026  
**Branch:** `feat/producao-vitrine-publica`  
**PR:** #21  
**Objetivo:** corrigir inconsistências de produção, aumentar a confiança do comprador e fazer a vitrine pública representar melhor a maturidade real do BoraFest.

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

---

## 3. Próximo bloco em implementação

### 3.1 Hero institucional de fallback

**Regra desejada:** um evento qualquer não deve virar automaticamente o grande destaque da home.

Quando houver evidência real de destaque, a home pode usar um evento. Quando não houver, deve exibir um hero institucional com:

- “Seu próximo rolê começa aqui”;
- busca;
- cidade;
- categorias;
- CTA “Explorar eventos”;
- CTA secundário para produtores.

**Princípio:** destaque comercial não deve ser inventado.

---

### 3.2 Busca pública melhorada

A busca deve evoluir de correspondência somente por título para uma experiência que possa encontrar por:

- título;
- cidade;
- local;
- Casa/produtor;
- categoria;
- atração, quando disponível.

A primeira etapa pode permanecer client-side usando os dados já carregados; a etapa seguinte deve evoluir a API de catálogo para pesquisa dedicada.

---

### 3.3 Publicação/republicação de evento vencido

**Regra obrigatória:** o painel não deve permitir publicar ou republicar um evento cujo `endsAt` já esteja no passado.

A proteção deve existir no backend e não apenas no botão do painel.

**Mensagem esperada:** “Atualize a data do evento antes de abrir as vendas.”

---

### 3.4 FAQ e políticas no evento

A página pública deve apresentar, de forma clara:

- como o ingresso é entregue;
- como funciona o QR Code;
- exigência de documento quando aplicável;
- meia-entrada quando habilitada;
- regras e classificação do evento;
- cancelamento/reembolso com link para política oficial;
- responsabilidade do organizador por informações específicas do evento.

Não devem ser inventadas políticas que ainda não existam no modelo/contrato do produto.

---

## 4. Pendências de produção que não são resolvidas apenas por código

Estas tarefas exigem revisão dos dados/ambiente:

- despublicar/remover eventos de teste existentes;
- corrigir registros antigos com cidade/UF incorretos;
- revisar eventos publicados cujo `endsAt` esteja errado;
- separar eventos de homologação/teste do catálogo público;
- validar banners, títulos e descrições atualmente publicados;
- executar smoke test após deploy.

---

## 5. Regras de produto adotadas

- “Em alta” só deve existir com evidência real de procura/vendas.
- Não usar urgência falsa.
- Evento encerrado nunca aceita nova reserva.
- A UI não é a autoridade de regra de negócio; o backend deve proteger a operação.
- Taxas devem continuar transparentes.
- Conteúdo de teste não deve aparecer na experiência pública.
- O BoraFest deve se posicionar como operação completa do evento: venda, promoters, listas, VIP, portaria, PDV e financeiro.

---

## 6. Checklist de validação antes do merge

- [x] Reserva bloqueada após `endsAt`.
- [x] Checkout trata evento encerrado.
- [x] UF validada.
- [x] Relação início/fim validada no cadastro.
- [x] Landing `/para-produtores` criada.
- [x] Header/footer atualizados.
- [x] Blocos de confiança adicionados.
- [ ] Bloqueio de publicar evento vencido.
- [ ] Bloqueio de republicar evento vencido.
- [ ] Hero institucional de fallback.
- [ ] Busca pública ampliada.
- [ ] FAQ/políticas na página do evento.
- [ ] Testes automatizados do novo comportamento.
- [ ] CI executado com sucesso.
- [ ] Smoke test após deploy.

---

## 7. Definição de pronto deste ciclo

Este ciclo será considerado concluído quando:

1. eventos vencidos não puderem vender nem ser reabertos sem correção de data;
2. a home não promover automaticamente conteúdo fraco como destaque principal;
3. comprador conseguir entender busca, evento, pagamento e entrada com clareza;
4. produtor conseguir entender o valor do BoraFest antes de criar conta;
5. mudanças estiverem documentadas e com critérios de aceite;
6. build/testes disponíveis forem executados;
7. produção passar por smoke test depois do merge/deploy.

---

## 8. Próximas fases após este ciclo

1. Dashboard operacional do produtor.
2. Promoters e listas como diferencial central.
3. Financeiro e repasses com maior transparência.
4. Favoritos sincronizados e seguir Casas.
5. CRM e campanhas.
6. Observabilidade e alertas operacionais.
7. Consumação/cashless como fase separada.
