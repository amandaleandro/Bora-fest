# BoraFest — Pré-publicação e limites da página pública

> Documento operacional para quem mantiver o painel do produtor e o hotsite público.
>
> Criado em 18/09/2026.

## 1. Objetivo

Evitar dois tipos de erro:

1. abrir vendas de um evento que já terminou;
2. publicar/divulgar uma página pública incompleta sem perceber.

O checklist do painel diferencia **regra obrigatória** de **recomendação de qualidade**.

## 2. Regra obrigatória

### Data do evento

Um evento não pode ser publicado ou republicado quando `endsAt <= agora`.

Essa regra existe em duas camadas:

- UI do produtor: botão de publicar/reabrir fica desabilitado;
- backend: `EventsService.publish()` e `EventsService.republish()` recusam a operação.

A UI não substitui a API.

Mensagem de backend:

`Atualize a data do evento antes de abrir as vendas`

## 3. Recomendações de qualidade

Os itens abaixo aparecem no checklist, mas **não bloqueiam** a publicação nesta etapa:

- categoria;
- local;
- banner;
- pelo menos um lote online ativo.

Motivo: hoje o modelo de negócio/contrato ainda permite alguns desses campos como opcionais ou existem fluxos que podem operar sem eles. Transformá-los em regra obrigatória sem decisão de produto poderia quebrar eventos legítimos.

## 4. Checklist atual

Arquivo:

`apps/producer/app/eventos/[eventId]/page.tsx`

Itens:

### Data válida — obrigatório
- lê `dashboard.event.endsAt`;
- compara com o relógio atual;
- bloqueia publicar/reabrir se vencido.

### Categoria — recomendado
Ajuda o evento a entrar em prateleiras de descoberta.

### Local — recomendado
Evita divulgar uma página que não informa onde o evento acontece.

### Banner — recomendado
Melhora confiança e conversão da vitrine.

### Ingresso online ativo — recomendado
Considera lote:
- `status === ACTIVE`;
- `pdvOnly !== true`.

Um lote exclusivo de porta não deve fazer o checklist afirmar que o site está pronto para venda online.

## 5. Dados do dashboard

Para suportar o checklist, o dashboard agora devolve no objeto `event`:

- `startsAt`;
- `endsAt`;
- `description` (para futuras validações de conteúdo);
- campos já existentes como `category`, `bannerUrl` e `venue`.

Cada lote também devolve:

- `pdvOnly`.

Arquivos:
- `apps/api/src/dashboard/dashboard.service.ts`;
- `apps/producer/lib/api.ts`.

## 6. Regra para futuras validações

Antes de transformar uma recomendação em bloqueio obrigatório:

1. confirme se o contrato também torna o campo obrigatório;
2. confirme fluxos especiais (PDV, VIP, evento gratuito, convite, evento sem venda pública);
3. adicione regra no backend;
4. adicione mensagem clara no painel;
5. adicione teste de regressão;
6. atualize este documento.

Não criar bloqueio crítico apenas na UI.

## 7. Faixa de confiança da página pública

A faixa:
- Pagamento acompanhado;
- QR Code individual;
- Sem aplicativo obrigatório;

deve aparecer no **hotsite principal do evento**, não automaticamente em toda rota abaixo de `/[slug]`.

### Problema corrigido

Um `apps/checkout/app/[slug]/layout.tsx` fazia a faixa aparecer também em:
- `/[slug]/ingressos`;
- `/[slug]/vip`;
- rotas filhas futuras.

Isso misturava conteúdo institucional com jornadas transacionais.

### Solução

- removido o layout genérico;
- criado `apps/checkout/components/EventTrustStrip.tsx`;
- o componente é renderizado explicitamente em `EventPageClient.tsx`.

## 8. Regra de arquitetura para layouts Next.js

Antes de colocar conteúdo em um `layout.tsx` dinâmico, liste todas as rotas filhas.

Use layout para elementos que **devem** existir em todas as filhas.

Use componente explícito na página quando o conteúdo pertence apenas a uma jornada.

## 9. Testes relacionados

- `apps/api/src/__tests__/event-sales-window.test.ts` — janela de publicação/republicação;
- `apps/api/src/__tests__/local-evento.test.ts` — dashboard entrega datas e `pdvOnly`.

## 10. Checklist para manutenção

- [ ] evento vencido continua sem publicar;
- [ ] evento vencido continua sem reabrir;
- [ ] evento futuro válido continua publicando;
- [ ] checklist distingue obrigatório de recomendado;
- [ ] lote somente-PDV não conta como venda online;
- [ ] faixa de confiança não aparece em VIP/checkout por herança de layout;
- [ ] backend continua como autoridade da regra crítica.
