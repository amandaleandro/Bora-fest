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

### PARCIAL

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

### Falta para virar Loja da Casa
- catálogo permanente independente de evento;
- estoque;
- SKU;
- variações (P/M/G/GG, cor etc.);
- imagem;
- categorias;
- venda sem ingresso;
- retirada/entrega;
- estoque por evento/operação;
- relatório específico de produtos;
- ledger/contabilidade separado por produto quando necessário.

### Direção futura
Criar **BoraFest Store / Loja da Casa** reutilizando a base conceitual de add-ons, sem duplicar o mecanismo de pedidos desnecessariamente.

---

## 5. Ingresso personalizado

### FUTURO

A segurança do ingresso já existe:
- Ticket;
- QR assinado;
- código;
- participante;
- lote;
- evento;
- transferência;
- check-in.

Falta a camada visual:

- tema por Casa;
- tema por evento;
- logo;
- fundo;
- cores;
- layout;
- patrocinadores;
- posição do QR;
- campos exibidos;
- preview do ingresso;
- modelos prontos;
- eventual exportação/pass.

Nome de backlog:
**BF-020 — Ticket Studio / Ingresso Personalizado**.

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

### PARCIAL
- perfil ainda não possui loja permanente;
- não existe vitrine de produtos fora de eventos;
- não há catálogo de benefícios/comércio unificado na página pública.

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
- adicionar regras de alerta para as três métricas de integridade;
- Alertmanager/canal de notificação externo;
- dashboard dedicado de saúde operacional;
- runbook de incidentes.

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
5. modelar Product/ProductVariant/Inventory;
6. reutilizar checkout/pedido quando houver evento;
7. permitir venda direta sem ingresso;
8. integrar retirada/estoque/financeiro;
9. página pública da loja.

Nome:
**BF-021 — BoraFest Store / Loja da Casa**.

### Bloco C — Ticket Studio
10. TicketTheme;
11. templates;
12. editor;
13. preview;
14. render do ingresso;
15. tema por Casa/evento.

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
