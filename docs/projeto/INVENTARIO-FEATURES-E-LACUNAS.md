# BoraFest — Inventário oficial de features e lacunas

> Estado revisado em 21/09/2026 na branch `feat/producao-vitrine-publica`.
>
> Objetivo: evitar retrabalho, deixar claro o que já existe de verdade e orientar a ordem de evolução do produto.

## 1. Regra de leitura

Estados usados:

- **PRONTO** — feature existe com fluxo principal implementado.
- **PARCIAL** — estrutura existe, mas ainda há lacunas relevantes de produto/operação.
- **NOVO** — implementado nesta rodada de melhorias.
- **FUTURO** — ainda não existe como módulo completo.

CI automatizado fica deliberadamente para o fechamento final desta rodada, conforme decisão do projeto.

---

## 2. Descoberta e vitrine

### PRONTO
- catálogo público de eventos;
- categorias;
- cidades;
- home com seções;
- Casa/produtor público;
- seguir Casa;
- avaliações pós-evento;
- favoritos;
- SEO por evento;
- sitemap/robots;
- histórico recente da Casa.

### NOVO nesta rodada
- busca no backend;
- autocomplete separado por Eventos / Casas / Atrações;
- isolamento explícito de homologação;
- hero institucional honesto;
- estados públicos de venda;
- compartilhamento com fallback de copiar link;
- Casa clicável a partir do evento.

### PARCIAL
- relevância textual ainda usa `contains`; sem fuzzy/full-text;
- não há autocomplete com ranking por popularidade/relevância avançada;
- busca não registra termos sem resultado.

---

## 3. Venda de ingressos

### PRONTO
- tipos de ingresso;
- lotes;
- capacidade;
- janela real de venda por lote (`startsAt/endsAt`);
- `SOLD_OUT` automático e reabertura segura por estorno;
- lotes exclusivos de promoter/vendedor com validação ponta a ponta;
- reserva temporária;
- controle de vendido/reservado;
- limite por pedido;
- Pix;
- cartão;
- taxas BUYER/PRODUCER;
- meia-entrada;
- ingresso nominal;
- CPF obrigatório por lote;
- lote somente PDV;
- lote de promoter;
- cupom;
- proteção de reembolso;
- carrinho abandonado;
- waiting room;
- pagamento/reconciliação;
- emissão por outbox;
- QR assinado;
- transferência de ingresso.

### NOVO nesta rodada
- bloqueio de reserva para evento encerrado;
- bloqueio de publicação/republicação vencida;
- checklist pré-publicação;
- preview privado do evento;
- estado público: aberto / esgotado / em andamento / encerrado.

---

## 4. Upsell / itens adicionais

### PRONTO para o escopo de evento

Já existem:
- `EventAddOn`;
- `OrderAddOnItem`;
- cadastro pelo produtor;
- nome;
- descrição;
- preço;
- ativo/inativo;
- quantidade no checkout;
- soma ao pedido;
- validação de pertencimento ao evento;
- adicional fora da base de comissão do promoter/parceiro.

### NOVO — Loja da Casa

Implementado nesta rodada:
- catálogo permanente independente de evento;
- `StoreProduct` e `StoreProductVariant`;
- SKU;
- preço por variação;
- estoque total / reservado / vendido;
- imagem;
- rascunho/publicado/arquivado;
- painel de gestão;
- vitrine pública na Casa;
- Casa pública pode existir via produto ativo mesmo sem evento publicado;
- homologação respeitada.

Ainda falta:
- venda direta sem ingresso;
- reserva transacional do estoque;
- retirada/entrega;
- cobrança e reembolso específicos da loja;
- ledger/relatórios de comércio.

Detalhes: `docs/projeto/LOJA-E-TICKET-STUDIO.md`.

---

## 5. Ingresso personalizado

### NOVO / PARCIAL

A segurança do ingresso já existe:
- Ticket;
- QR assinado;
- código;
- participante;
- lote;
- evento;
- transferência;
- check-in.

Implementado:
- tema por evento;
- templates CLASSIC / DARK / FESTA / PREMIUM;
- logo;
- fundo;
- cores;
- texto de patrocinador;
- campos opcionais de apresentação;
- preview;
- aplicação do tema na carteira real;
- QR/código sempre protegidos e visíveis.

Ainda falta:
- tema padrão herdado da Casa;
- PNG/PDF completo personalizado;
- Apple/Google Wallet;
- editor livre/drag-and-drop;
- posição configurável do QR.

Nome:
**BF-020 — Ticket Studio / Ingresso Personalizado**.

Detalhes: `docs/projeto/LOJA-E-TICKET-STUDIO.md`.

---

## 6. Casa / produtor

### PRONTO
- perfil público;
- logo;
- capa;
- bio;
- redes;
- follow;
- próximos eventos;
- histórico;
- CRM;
- retenção;
- reativação;
- fidelidade;
- inteligência;
- financeiro.

### NOVO / PARCIAL
- perfil já possui vitrine de produtos permanentes;
- perfil pode permanecer público por produto ativo, mesmo sem evento publicado;
- compra direta dos produtos ainda não está habilitada;
- benefícios/fidelidade e comércio ainda não formam uma cesta pública unificada.

---

## 7. Promoters, parceiros e vendas

### PRONTO
- promoter;
- vendedor subordinado;
- código pessoal;
- link;
- comissão percentual/fixa;
- atribuição;
- ranking;
- split;
- clawback em reembolso;
- parceiro/atlética;
- comissão por link;
- lista de convidados;
- ranking por vendedor/parceiro.

### Atenção
Não criar um segundo sistema de afiliados. Evoluções devem usar `PromoterLink`, `PromoterSeller` e `SalesPartner` existentes.

---

## 8. VIP

### PRONTO
- mesa;
- camarote;
- lounge;
- bistrô;
- quantidade;
- capacidade;
- preço congelado;
- reserva;
- pagamento;
- acompanhamento.

### Possível evolução futura
- mapa visual de mesas/setores;
- escolha por planta;
- inventário gráfico.

---

## 9. Portaria e operação

### PRONTO
- check-in;
- QR;
- credenciais;
- dispositivos;
- check-in ao vivo;
- busca;
- convidados;
- PDV;
- operação offline/sincronização;
- cortesias.

### Regra
Falha de rede não pode ser tratada automaticamente como ingresso inválido.

### 9.1 Check-in facial — NOVO / PARCIAL

Implementado:
- schema e migrations de enrollment facial;
- `CheckinMethod.FACE`;
- opt-in por evento;
- consentimento explícito por ingresso;
- enrollment/revogação;
- verificação 1:1;
- liveness exigido pelo contrato do provedor;
- portaria com modo facial;
- bridge web e mobile;
- facial não funciona offline;
- QR/manual obrigatórios como fallback;
- transferência revoga biometria anterior;
- referência biométrica não é exposta ao cliente.

Pendente externo:
- escolher e integrar SDK/gateway biométrico real;
- job de retenção/limpeza no provedor.

Detalhes: `docs/projeto/CHECKIN-FACIAL.md`.

---

## 10. Financeiro

### PRONTO
- ledger;
- saldo;
- disponível;
- a liberar;
- taxas;
- comissão;
- proteção;
- estorno;
- chargeback;
- saque;
- conta bancária;
- repasse;
- antecipação/regras de liberação;
- intelligence hub.

### Regra
Nenhuma nova feature comercial deve criar uma “segunda contabilidade”. Produtos, loja e novos serviços precisam alimentar a mesma fonte financeira ou um subledger claramente reconciliável.

---

## 11. CRM, crescimento e fidelidade

### PRONTO
- clientes;
- segmentos;
- recorrência;
- frequentes;
- inativos;
- no-show;
- seguidores;
- opt-in;
- retenção;
- reativação;
- campanha;
- fidelidade;
- níveis;
- pontos;
- recompensas;
- vouchers;
- LTV;
- inteligência de clientes;
- carrinho abandonado.

### Atenção
Campanhas devem respeitar consentimento de marketing.

---

## 12. Observabilidade

### NOVO / EM FECHAMENTO

Já existiam:
- Prometheus;
- Grafana;
- métricas HTTP;
- métricas de filas.

Corrigido nesta rodada:
- autenticação do Prometheus na API/worker;
- `METRICS_TOKEN` em produção;
- regras carregadas pelo Prometheus;
- alertas de API down;
- worker down;
- falha de fila;
- 5xx alto;
- p95 alto;
- métrica de pedido PAID sem ingresso;
- métrica de outbox FAILED;
- métrica de outbox PENDING atrasado.

### Falta
- [x] regras de alerta para as três métricas de integridade;
- [x] runbook de incidentes;
- Alertmanager/canal de notificação externo para os alertas Prometheus de negócio;
- dashboard dedicado de saúde operacional.

---

## 13. Qualidade de produção

### NOVO
- isolamento de homologação;
- pré-publicação;
- preview;
- busca pública correta;
- bloqueio de evento vencido;
- trust copy revisada;
- documentação de continuidade.

### Falta
- script de auditoria somente leitura pronto (`pnpm --filter @borafest/database auditoria-catalogo`);
- limpeza efetiva dos registros já existentes em produção;
- smoke test em produção;
- validar variáveis reais de ambiente;
- revisar URLs antigas/rotas legadas;
- CI no fechamento final.

---

## 14. Ordem recomendada de execução

### Bloco A — fechar o que já está aberto
1. alertas de integridade financeira/outbox;
2. documentação/runbook de observabilidade;
3. consolidar inventário e navegação entre módulos;
4. preparar checklist/script de auditoria de dados de produção.

### Bloco B — Loja da Casa
5. [x] modelar Product/ProductVariant/estoque;
6. [x] página pública da loja;
7. definir arquitetura de pedido comercial direto;
8. permitir venda direta sem ingresso;
9. integrar retirada/entrega/financeiro/reembolso.

Nome:
**BF-021 — BoraFest Store / Loja da Casa**.

### Bloco C — Ticket Studio
10. [x] TicketTheme;
11. [x] templates;
12. [x] editor;
13. [x] preview;
14. [x] render na carteira web;
15. tema padrão por Casa;
16. PNG/PDF/pass opcional.

### Bloco D — fechamento
16. smoke tests;
17. build/typecheck/test;
18. CI;
19. merge/deploy.

---

## 15. O que NÃO deve ser refeito

Não reconstruir do zero:
- CRM;
- fidelidade;
- financeiro;
- promoters;
- VIP;
- check-in;
- add-ons;
- Casa pública;
- avaliações;
- seguidores;
- inteligência.

A prioridade é evoluir e conectar esses módulos.


---

## Loja da Casa — atualização 23/09/2026

Status atual: **compra real implementada em MVP operacional**.

Agora existe:
- catálogo permanente de produto/variação;
- carrinho na página pública da Casa;
- pedido comercial próprio (`StoreOrder`);
- snapshot de preço;
- reserva atômica de estoque por 15 minutos;
- Pix com gateway/failover existente;
- webhook e reconciliação;
- conversão reservado → vendido no pagamento;
- ledger e taxa da plataforma;
- expiração com devolução de reserva;
- pagamento órfão com estorno automático;
- código de retirada;
- confirmação por e-mail;
- lista de pedidos no painel da Casa;
- confirmação de entrega por código;
- reversão financeira;
- retorno de estoque em estorno antes da retirada.

Não confundir com `EventAddOn`: Loja é comércio permanente da Casa.

Pendências de evolução:
- cartão;
- entrega/frete/endereço;
- reembolso self-service da Loja;
- devolução física e movimento de reposição;
- integração à carteira “Minhas compras”;
- CRM/relatórios/push específicos da Loja.

Documentação detalhada:
`docs/projeto/LOJA-E-TICKET-STUDIO.md`.
