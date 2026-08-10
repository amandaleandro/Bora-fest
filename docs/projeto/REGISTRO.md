# REGISTRO — Estado do projeto BoraFest

> **Este arquivo é a fonte de verdade de onde estamos e onde paramos.**
> Toda sessão de trabalho (alteração, correção ou similar) DEVE terminar com uma
> atualização deste arquivo antes do commit. Quem chega (pessoa ou Claude, em
> qualquer máquina) lê este arquivo primeiro e continua do ponto correto.
>
> Regras:
> 1. Leia `docs/projeto/MEMORIA.md` (convenções e decisões) antes de codar.
> 2. A referência das fases é `docs/arquitetura/arquitetura-borafest.md`, seção 21.
> 3. Ao terminar qualquer trabalho: atualize "Estado atual", marque a fase,
>    preencha "Onde paramos" e "Próximo passo", adicione uma linha no Diário.

---

## Estado atual

| Campo | Valor |
|---|---|
| **Fase em andamento** | Handoff v2 implementado — pré-lançamento |
| **Status da fase** | 🟢 API testes 38/38 · typecheck limpo · build 14/14 |
| **Última atualização** | 2026-08-10 |
| **Atualizado por** | Amanda + Claude |
| **Branch** | `main` |

### Onde estamos (2026-08-10) — Merge de divergência + `.env` na raiz + dist desatualizado

Amanda rodou `git pull` num terminal com 4 commits locais não empurrados
contra 6 novos no remoto (branches divergentes) — o pull sozinho não
resolve isso (precisa merge). Interrompido no meio por um prompt do Git
para Windows (unlink de um pack `.idx` velho, sem relação com o conteúdo).
Resolvido por aqui:

- **Merge**: `git fetch` + `git stash` (havia uma correção local não
  commitada em `app.module.ts`) + `git merge origin/main --no-edit` (sem
  conflitos, 55 arquivos) + `stash pop`. Branch ficou 5 commits à frente do
  remoto (ainda não empurrado — falta `git push` quando a Amanda topar).
- **Correção mantida**: `apps/api/src/app.module.ts` agora carrega o `.env`
  tanto do cwd quanto de `../../.env` — a API roda com `apps/api` como cwd
  sob pnpm/turbo, mas o `.env` do monorepo vive na raiz do repo; sem isso,
  rodar a API direto da raiz (fora do turbo) não achava as variáveis.
- **`dist/` desatualizado pós-merge**: o merge trouxe schema/contratos
  novos (`PromoterLink`, `emailVerifiedAt` etc.) mas os pacotes
  `@borafest/contracts`, `@borafest/payments` e `@borafest/auth` tinham
  `dist/` compilado de ANTES — típeria (`tsc --noEmit`) e os testes da API
  falhavam com erros que pareciam bugs de produto (ex.: "No LedgerAccount
  found" no teste de promoter) mas eram só código velho compilado. Rebuild
  dos três (`pnpm --filter <pkg> build`) resolveu. **Lição**: depois de um
  merge que mexe em `packages/database/prisma/schema.prisma` ou em
  `packages/*/src`, rodar `prisma generate` + rebuildar os pacotes
  dependentes ANTES de confiar em erro de teste/typecheck como bug real.
- **`@borafest/auth` sem link**: o merge também adicionou
  `@borafest/auth` como dependência nova do worker, mas o `node_modules`
  local não tinha o symlink do workspace (pnpm não relinka sozinho quando
  um `package.json` ganha uma dependência workspace nova sem `pnpm
  install`). `pnpm install` pediu confirmação pra recriar `node_modules` do
  zero e na 1ª tentativa deu `EBUSY` num arquivo do `react-native` (lock
  do Windows/antivírus) deixando `node_modules` vazio pela metade — 2ª
  tentativa completou limpa (~3min).
- **Lixo de teste no Postgres local**: as reexecuções da suíte antes do
  fix de `dist/` deixaram ~30 organizações fixture (`Teste Integração
  ...`) no banco de dev; a busca `searchOrganizations` (sem `orderBy`,
  `take: 10`) ficou instável (achava/não achava a org certa dependendo da
  ordem física das linhas) até eu limpar esse lixo via SQL direto —
  **não é bug de produto**, é sujeira de teste local; o teste em si tem
  `finally` com cleanup correto.
- Migrações novas aplicadas no Postgres local (5443): `producer_type_
  promoter_v2`, `conta_no_checkout` (as demais já estavam).
API 38/38 · build 14/14 (checkout/producer/admin/api/worker). Não
empurrado ainda — 5 commits locais aguardando `git push` com aprovação
da Amanda.

### Onde estamos (2026-08-06, continuação) — Categoria, urgência e upsell

Terceira rodada de growth na mesma sessão (itens 3–5 do punch list:
descoberta/SEO, urgência de venda, upsell no checkout):

- **Categoria de evento**: retomei de vez a migração `add_event_category`
  (schema + contrato `eventCategorySchema` + `EventsService` grava no
  create/update). Filtro público `?category=` em `listPublicEvents`.
  Produtor escolhe categoria na criação e pode trocar na página do evento;
  home do checkout tem chips (Shows/Festas/Esportes/Teatro) agora
  conectados ao filtro de verdade (antes eram só visuais).
- **SEO técnico**: `/evento/[slug]` virou Server Component —
  `generateMetadata` por evento (title/description/OG/Twitter card usando
  banner do evento) + JSON-LD `schema.org/Event` (data, local, ofertas).
  A lógica client (reserva, follow, review) foi isolada em
  `EventPageClient.tsx`. `app/sitemap.ts` lista todo evento publicado,
  `app/robots.ts` novo. Validado com `next build` real (11/11 páginas),
  não só typecheck.
- **Urgência de venda**: badge "Restam N" (antes era só "Poucos" genérico)
  e "Termina em Xh"/"Xmin" quando o lote fecha em menos de 48h — usa
  `TicketLot.endsAt`, que já existia no schema mas não estava exposto no
  tipo do client.
- **Itens adicionais (upsell)**: `EventAddOn`/`OrderAddOnItem` novos —
  produtor cadastra item (nome+preço, sem controle de estoque) na página
  do evento; comprador escolhe quantidade no checkout, ativo entra no
  total do pedido **fora** da base de comissão do parceiro (parceiro só
  ganha sobre ingresso, não sobre merch). `POST /v1/orders` valida que o
  add-on pertence ao evento e está ativo.

Checkpoints commitados em separado (schema → backend → producer UI →
checkout UI → testes) para sobreviver a um `git pull` no meio do
trabalho sem perder o que já estava pronto — lição da rodada anterior.
Teste novo `category-and-addons.test.ts`.

**Fora do escopo desta rodada**: controle de estoque para itens
adicionais (hoje é só preço, sem capacidade) — se um item precisar de
limite (ex.: tamanho de camiseta esgotando), fica pra quando pedirem.

### Onde estamos (2026-08-06) — Growth: link de promoter, seguir produtor, avaliação

Resposta a "o que fazemos pra ganhar o mercado de ingressos" — 4 features de
growth que faltavam frente a Sympla/Ingresse/Eventbrite, todas com schema,
API, UI e testes:

- **Link de promoter/atlética** (`SalesPartner.slug`, migração
  `sales_partner_slug_and_order_attribution`): slug único por org gerado do
  nome no cadastro (com dedup); comprador que entra por
  `/evento/:slug?p=slug` grava o slug em localStorage (janela de 7 dias,
  last-click); `POST /v1/orders` resolve o parceiro e credita
  `partnerCommissionCents` igual ao PDV. `Order.attributionSource`
  (MANUAL/LINK) distingue a origem. Painel do produtor → Divulgue lista o
  link de cada parceiro com botão copiar. Teste
  `partner-link-attribution.test.ts`.
- **Vendas por parceiro**: descoberto no meio do caminho que já existe
  `GET /v1/events/:id/dashboard/sales-by-seller` (ranking por
  vendedor/parceiro com receita e comissão) com UI pronta na página Vendas
  — não duplicado; só o dashboard geral ganhou `reviews` (média/contagem).
- **Seguir produtor** (`OrganizationFollow`, migração
  `organization_follow_and_event_review`): `POST/DELETE/GET
  /v1/organizations/:id/follow`, sem checagem de membership (qualquer
  usuário logado). `EventsService.publish()` notifica os seguidores por
  e-mail (melhor esforço, não bloqueia a publicação). Botão "Seguir" no
  checkout, visível só com sessão ativa (`bf.token`).
- **Avaliação pós-evento** (`EventReview`, mesma migração acima): só quem
  teve pedido `PAID`/`FULFILLED` no evento pode avaliar, e só depois que o
  evento termina (`endsAt` no passado); um review por comprador (upsert,
  não duplica). `POST/GET /v1/events/:id/reviews[/mine]`,
  `GET /v1/public/events/:slug/reviews` (público). Widget de estrelas na
  carteira do comprador + nota média na página pública do evento. Teste
  `follow-and-review.test.ts`.

**Incidente real desta sessão**: a Amanda rodou `git pull` no meio do
trabalho (fast-forward `721ff8c → 9d2fc78`, trazendo o commit paralelo
"transferência de conta a conta + prova de compra múltipla"). O pull
sobrescreveu, sem aviso nem conflito, as edições locais não commitadas em
todo arquivo já rastreado que eu tinha tocado (schema.prisma,
events/orders/dashboard/catalog/organizations services e controllers,
contracts, app.module.ts, e os arquivos de checkout/producer) — só os
arquivos novos (migrações, módulo `reviews`, componentes, testes)
sobreviveram por não estarem rastreados. Reconstruí tudo a partir do
histórico da conversa e revalidei (typecheck + 25/25 testes). **Lição**:
`git pull` com working tree sujo pode descartar trabalho não commitado
silenciosamente quando o fast-forward não detecta conflito textual —
sempre `git stash` (ou commitar/WIP) antes de puxar com mudanças locais
pendentes, inclusive as feitas por uma sessão do Claude em andamento.

De passagem: apliquei a migração `add_event_category` que já estava no
repo (outra sessão, sem commit) mas pendente — só para destravar os
testes locais, sem relação com o trabalho acima.

**Fora do escopo** (decisão consciente): repasse automático da comissão
do parceiro — hoje `partnerCommissionCents` só fica registrado no pedido,
o acerto com a atlética continua manual. Fica para quando houver decisão
de produto sobre o modelo de pagamento.

### Onde estamos (2026-07-25)

Handoff v2 (`docs/design/`, com as 8 decisões de produto cravadas) implementado:

- **Backend**: quem paga a taxa (feeMode), ingresso nominal (participantes com
  CPF), consentimento LGPD versionado, solicitar saque (D+2 + KYC), portaria
  com motivo do inválido/portão do 1º uso/manifesto com nomes.
- **Checkout**: 3 passos (Identificação → Participantes → Pagamento), LGPD
  bloqueante v2026-07, Resumo do pedido sticky, layout desktop 1160px.
- **Portaria**: camada offline real (IndexedDB + Ed25519 local + sync em lote
  + jsQR para iOS) com a regra "sem manifesto, nunca aprovar".
- **Painel**: sidebar persistente, quem-paga-a-taxa com simulação, solicitar
  saque, convidar equipe.
- **PWA**: ícones reais, manifesto próprio da portaria, service worker versionado.
- **Perímetro**: CORS por allowlist, trustProxy, rate limit no PIN/checkins/
  pagamentos, fail-fast dos segredos do Pagar.me.
- **E-mail**: adapter Resend pronto — basta a chave para o ingresso e o OTP saírem.

**Validado de ponta a ponta (2026-07-25, no navegador + API)**:
compra com 2 ingressos nominais → LGPD bloqueante marcado → Pix pago →
participantes com CPF e consentimento (terms+privacy v2026-07) gravados →
login sem senha reivindica o pedido de convidado → carteira mostra os 2
ingressos com nome → PIN de portaria → manifesto com nome (sem CPF) →
check-in VALID → segunda leitura ALREADY_USED com aparelho do 1º uso.

Dois bugs achados e corrigidos nessa validação:
1. Rota de saque duplicava `:organizationId` (o modal do painel ia dar 404).
2. Pedido de convidado nunca era vinculado à conta — a carteira ficava vazia.
   Agora o verify do OTP (posse do e-mail comprovada) reivindica os pedidos.

**Rodada pós-feedback do Arthur (2026-07-25, tarde)** — 3 frentes em paralelo:
- **Portaria redesenhada**: app standalone de tela cheia (sem header/rodapé do
  site), seguindo o protótipo aprovado — PIN com teclado grande, seletor de
  evento/portão, abas Scanner / Código / Documento, resultados full-screen
  (verde/amarelo/vermelho), badge Online/Offline e pendentes de sync.
- **Validação por documento (sem QR), offline**: manifesto passou a levar o
  CPF **hasheado** (sha256 — o CPF cru nunca sai do servidor); a busca por
  nome/CPF roda na lista local do aparelho. Validado no navegador: CPF com
  pontuação → Marina Costa → Confirmar entrada → Válido → sincronizado.
- **Ingresso no WhatsApp**: botão "Receber meus ingressos no WhatsApp" na
  página do pedido → POST /v1/orders/:publicToken/whatsapp (normaliza celular
  BR p/ E.164) → 1 mensagem por ingresso com texto + PNG do QR
  (GET .../tickets/:id/qr.png). Adapter Meta Cloud API pronto: com as chaves,
  é setar WHATSAPP_PROVIDER=meta + WHATSAPP_CLOUD_TOKEN +
  WHATSAPP_PHONE_NUMBER_ID. Sem chaves, devlog loga (testado).

Build 14/14 · testes 34/34 (API 13, payments 10, notifications 8, tickets 3).

**Rodada Asaas (2026-07-28)** — decisão cravada pelo Arthur: Asaas é o
gateway primário ("melhor que o Pagar.me em todos os termos necessários").
- **Adapter Asaas completo** (`packages/payments/src/asaas.ts`): Pix
  (customer + payment + QR), cartão tokenizado (recusa 400 vira FAILED com
  motivo), estorno total/parcial, webhook por token fixo
  (`asaas-access-token`, fail closed), mapeamento de status completo.
  `PAYMENTS_PROVIDER=asaas` + `ASAAS_API_KEY` + `ASAAS_WEBHOOK_TOKEN`
  (sandbox: `ASAAS_API_URL=https://api-sandbox.asaas.com/v3`). Fail-fast no
  main.ts. Pagar.me continua vivo como plano B.
- **Modos de repasse por organização**: `settlementMode` PADRÃO (crédito de
  venda só vira sacável após `refundHoldDays` — 7 dias, CDC) ou INSTANTÂNEO
  (casas de confiança: saca tudo na hora, antecipação de 1,25% a.m. pró-rata
  sobre a parcela em janela — `ANTICIPATION_FEE_BPS_MONTHLY` — e
  responsabilidade de reembolso da casa via aditivo:
  `docs/juridico/REPASSE-INSTANTANEO-MINUTA.md`). Ledger ganhou `availableAt`
  e o tipo `ANTICIPATION_FEE` (migração `settlement_mode_availability`).
- **Repasse automático**: fila nova `auto-payouts` no worker (a cada 30 min)
  cria o Payout do saldo recém-liberado (mínimo `AUTO_PAYOUT_MIN_CENTS`,
  R$ 50); execução bancária segue no backoffice. Backoffice controla modo/
  janela/automático por organização (auditado, com confirmação do aditivo);
  painel do produtor mostra "liberam após a janela" e a antecipação estimada.

**Reembolso direcionado à casa (2026-07-28, tarde)** — pedido do Arthur:
- Solicitação do comprador agora informa quem analisa (`reviewedBy`): casa
  (INSTANTÂNEO) ou BoraFest (PADRÃO) — mostrado no app do comprador.
- Painel do produtor ganhou a página **Reembolsos**: casa INSTANTÂNEA aprova
  (executa o estorno de verdade — sai do saldo dela via ledger) ou recusa com
  justificativa; PADRÃO vê a fila em modo leitura ("quem analisa é a
  BoraFest"). Guarda de permissão ORDER_REFUND + trava por settlementMode no
  servidor. Executor de estorno unificado (backoffice e casa usam o mesmo:
  `common/execute-refund.ts`).

Build 14/14 · testes 43/43 (payments 16, API 16, notifications 8, tickets 3).

**🚀 EM PRODUÇÃO (2026-07-30, madrugada)** — deploy no VPS do Arthur
(72.62.138.230) via serviço Compose do EasyPanel (que já hospedava outros
serviços; Traefik dele faz o HTTPS). docker-compose.yml raiz + Dockerfiles
autocontidos em infra/docker/easypanel/. Build de estreia quebrou uma vez
(admin/producer sem pasta public/ — fix bc0f51c) e na segunda subiu em 1min24s.
Verificado da internet: api.borafest.com.br/health ok/db up, site, painel e
admin respondendo 200 com HTTPS válido. Asaas plugado (chave prod no env do
painel, com escape $$ contra interpolação do compose).

**Cartão real + localização (2026-07-30, sequência)**: checkout de cartão
agora é o modelo server-side oficial do Asaas (cartão + dados do titular +
IP do comprador direto ao PSP — nunca logado/persistido; mock em dev recusa
final 0000); formulário ganhou titular/CPF/CEP/número. Home do site trocou o
"São Paulo, SP" fixo por seletor de cidades REAIS (endpoint público de
cidades com evento publicado + filtro ?city=), escolha persistida no
aparelho. Resend: chave recebida do Arthur — vai no Environment do EasyPanel
(EMAIL_PROVIDER=resend + RESEND_API_KEY), não no git. Testes 44/44.

**Taxa REAL ponta a ponta (2026-08-01)** — pergunta do Arthur expôs
incoerência: a taxa do lote era DIGITADA pelo produtor (campo livre) e o
ledger calculava outra (bps sobre o total no pagamento) → mostrado ≠ cobrado
≠ contabilizado. Decisão cravada: **a taxa de serviço é da plataforma** —
calculada no servidor na criação do lote (4,99% do preço, piso R$ 2,49;
grátis = 0; overrides por org valem) e o ledger lança EXATAMENTE a taxa
cobrada nos itens do pedido, nos dois meios. Produtor líquida exatamente o
preço do ingresso. Teste taxa-real.test.ts trava o invariante (17/17 na API).
Banner de evento virou UPLOAD de imagem (multipart 5MB jpg/png/webp,
@fastify/multipart@8 + @fastify/static@7 fixados p/ Fastify 4, volume
borafest_uploads no compose, servido em /uploads). Painel: contraste dos
chips + upload no lugar de URL + taxa read-only (agente).

**Feedback da Marcela — 1ª usuária real (2026-08-04)**: 3 achados, todos
procediam. (1) LOCAL DO EVENTO não tinha UI nem rota — agora `venue` inline
no criar/editar evento (API cria/reaproveita o Venue por nome+cidade da org,
UF normalizada no serviço), seção no assistente + cartão Local na página do
evento; sem local o evento não entra na busca por cidade e a UI avisa.
(2) Banner sumia no F5 do painel: o dashboard não devolvia bannerUrl —
corrigido (payload agora traz bannerUrl + venue). (3) Becos sem saída de
navegação: link público da Publicação virou clicável + botão "Ver página do
evento"; Sidebar ganhou "Ver o site" e o logo abre o site do comprador.
Teste local-evento.test.ts cobre criação/reaproveitamento/dashboard.
Build 14/14 · API 18/18.

**Dia de testes de pagamento (2026-08-06)** — pedido do Arthur: tudo de
pagamento ativo + compra múltipla + transferência de ingresso entre contas.
- **Transferência conta a conta**: Ticket.ownerUserId (migração ticket_owner);
  a base da Amanda (QR reassinado + auditoria) ganhou posse real — a conta
  destino PRECISA existir (404 orienta criar conta), lote com requiresCpf
  exige CPF no cadastro destino, carteira lista por dono atual, e-mail
  'ticket_transferred' pro novo dono via fila. Contrato: toEmail apenas (nome
  vem da conta destino). UI na carteira (/perfil): botão Transferir + modal
  com confirmação de irreversibilidade. Testes 2/2.
- **Compra múltipla**: provada com teste (3 unidades no pedido → 3 códigos e
  3 QRs únicos, estoque 3 vendidos) — compra-multipla.test.ts.
- Pacotes da Amanda re-buildados (auth SALES_PERFORM, queues waiting-room,
  payments resilience) — dists estavam atrás das fontes.
API 22/22 · build 14/14.

**Pix real destravado (2026-08-07/08)** — Arthur tentou pagar e viu
"Internal server error". Diagnóstico direto contra a API do Asaas de
produção achou DOIS bloqueios reais, nenhum deles visível ao usuário:
1. **CPF do pagador é obrigatório** no Asaas ("Para criar esta cobrança é
   necessário preencher o CPF ou CNPJ do cliente") e o checkout não pedia —
   campo CPF adicionado na identificação (validado, com o porquê explicado)
   e enviado em Pix e cartão.
2. **Valor mínimo de R$ 5,00 por cobrança** — o pedido de teste era R$ 4,99
   (um centavo abaixo!). Trava nova barra antes com mensagem clara
   ("adicione mais um ingresso"), configurável por PAYMENT_MIN_CHARGE_CENTS.
   ⚠️ Impacto de negócio: nenhum pedido abaixo de R$ 5,00 é cobrável.
3. **Erro do provedor deixou de virar 500 genérico**: recusa 4xx do gateway
   agora vira 400 com a mensagem do Asaas na tela — foi isso que escondeu as
   duas causas acima.
Provado contra o Asaas real: cobrança + QR Pix gerados a R$ 5,00 com CPF.
API 22/22 · build 14/14.

**UX da jornada do comprador — Blocos B e A (2026-08-08)** — auditoria
como usuário no celular em produção, depois correção testada tela a tela
contra pilha local (API mock + evento demo com banner real):
- Bloco B (checkout blindado): resumo do pedido no TOPO do celular
  (título, data/local, qtde, total; toque expande) — antes preenchia 4
  campos às cegas; cronômetro explicado ("Reservado por 09:24"/"Pague em
  14:50"); tela de escolher ingressos com contexto (banner/data/local);
  fim dos botões de enfeite (Google/Apple "em breve" e aba Carteira
  inteira); erro antigo some quando o Pix sai.
- Bloco A (vitrine que vende): banner do evento na home (destaque com
  imagem de fundo + cards com miniatura; fallback bonito sem banner);
  PREÇO HONESTO — vitrine mostra o que se paga (preço+taxa, "com taxas",
  "Grátis" quando 0) na home E no CTA do hotsite; selo "Últimos
  ingressos" fixo (mentira) trocado por urgência REAL: "Lote atual
  termina em Xh" vindo de currentLotEndsAt (novo campo da API, fim do
  lote ativo mais próximo).
Bugs pegos no ciclo testar→corrigir: estado de hook depois de return
condicional (quebrava o checkout inteiro) e erro persistente pós-sucesso.
API 27/27 · build 14/14. Pendente de deploy pelo Arthur.

**Bloco C — identidade do evento e do produtor (2026-08-08)** —
plataforma "redonda" a pedido do Arthur:
- **Nome comercial** (Organization.displayName): campo "Perfil público" na
  página da organização do painel; o site mostra "Por Atlética XANA" em vez
  do nome civil do produtor — e o nome civil NEM TRAFEGA no payload público
  (displayName é resolvido no servidor). PATCH /v1/organizations/:id
  (permissão ORG_MANAGE_MEMBERS).
- **Campos estruturados do evento** (Event.lineup/amenities/minAge):
  wizard de criação e etapa de detalhes ganham Atrações (um por linha),
  O que está incluso (um por linha) e Idade mínima (Livre/14+/16+/18+);
  o hotsite monta as seções sozinho — chips de atrações, checklist verde
  do incluso e cartão "18+" com aviso de documento.
- Migração 20260808172047_org_display_name_event_structured_info.
Teste de integração novo (identidade.test.ts): nome comercial no público,
displayName não vaza, fallback para o nome cadastral, campos estruturados.
Verificado no navegador contra pilha local. API 28/28 · build 14/14.
⚠️ Deploy: a migração roda sozinha no boot da API (migrate deploy no CMD).

**Identidade visual oficial aplicada (2026-08-08)** — Arthur entregou a
marca final (Ativos 8/11/13: ícone B, logo horizontal p/ fundo escuro,
logo branco) e pediu o sistema inteiro nela. Gradiente magenta→rosa→
laranja (pegada Instagram) extraído por amostragem dos próprios arquivos:
- Tokens: #C913DB (magenta) · #F1126E (rosa) · #FB7032 (laranja);
  primária sólida #D9128F (contraste 4,74:1 sobre branco), hover #B30E76;
  brand-gradient linear 135° nos 3 pontos. Urgência (accent) virou
  laranja #E8590C para não sumir no rosa.
- Superfícies: site do comprador (tailwind config + varredura de roxos
  hardcoded), painel do produtor (config + Sidebar com logo horizontal),
  backoffice (preset @borafest/ui tema escuro), portaria (colors.ts),
  e-mails (render.ts) e manifests PWA (theme_color).
- Ativos versionados: public/brand/{logo-b, logo-horizontal-escuro,
  logo-horizontal-branco}.svg (extraídos dos PDFs via pdftocairo);
  favicons/app icons novos (app/icon.png + apple-icon.png + icons/ PWA)
  — os pwa-icons do handoff eram da marca ROXA antiga e foram descartados.
- Headers: logo real no site (B + wordmark) e no painel (horizontal).
Verificado no navegador (home/hotsite/seleção, mobile e desktop).
Build 14/14. ⚠️ App comprador (APK Expo) segue com tema próprio — não
rebrandado ainda; tratar quando gerar o próximo APK.

**Home viva: categorias obrigatórias + Em alta por vendas + prateleiras
(2026-08-08)** — plano aprovado pelo Arthur ("em alta = o que mais vende
naquela noite"), executado com regras de honestidade:
- **Categoria obrigatória** no cadastro de evento (contracts + wizard sem
  "Sem categoria" + validação); migração category_backfill põe FESTAS nos
  eventos antigos. Não expandir categorias sem densidade!
- **Em alta por PLACAR**: pontos = vendas 24h × 3 + vendas 7 dias × 1
  (tickets emitidos, exclui cancelado/reembolsado). A noite domina quando
  há movimento; a semana segura o ranking em noite parada. Seção SÓ
  aparece com 2+ eventos com venda real — nunca finge popularidade.
- **Prateleiras por categoria**: nascem sozinhas com 3+ eventos ativos
  (categoria rala fica em "Próximos"), ordenadas por procura, com "Ver
  todos" caindo no filtro; endpoint GET /v1/public/events/home/sections
  (cache 120s) devolve highlights+shelves+upcoming numa chamada só.
- Home (mobile e desktop): Destaque → fileira "Em alta 🔥" → prateleiras
  → Próximos; busca/chip mantém a lista plana antiga.
- **Banner v2 do produtor** (arte refinada do Arthur, mesmo webp 54 KB).
Testes novos (home-sections.test.ts): ordem do placar, honestidade do Em
alta, densidade da prateleira. API 30/30 · build 14/14 · verificado no
navegador com vendas fabricadas no banco local.

**Repasse 100% automático (2026-08-09)** — exigência do Arthur: "precisa
ser automático, senão a plataforma fica atrás das demais", com config por
casa. Última milha fechada:
- **Pix de SAÍDA pelo provedor**: AsaasGateway.transferPix (POST /transfers
  com chave Pix da conta bancária padrão da organização; tipo da chave
  detectado) + getTransferStatus para conciliação; mock idem. Interface
  opcional no PaymentGateway — o futuro adaptador de banco (Pix direto)
  encaixa aqui sem mexer no worker.
- **Worker executa sozinho**: varredura (agora a cada 5 min,
  AUTO_PAYOUTS_SWEEP_MS) cria o payout e, com AUTO_TRANSFER_ENABLED=true,
  dispara o Pix na hora; DONE→PAID, BANK_PROCESSING→concilia depois,
  FAILED→FAILED com motivo no backoffice. **Anti-duplicidade fail-closed**:
  com externalId gravado nunca se cria 2ª transferência; erro de rede sem
  resposta → FAILED pedindo conferência manual (dinheiro nunca sai dobrado
  sozinho). Trilha em audit_logs (payout.auto_transfer).
- **Mínimo POR CASA**: Organization.autoPayoutMinCents (null = padrão
  global AUTO_PAYOUT_MIN_CENTS) — POST /v1/admin/organizations/:id/
  settlement aceita autoPayoutMinCents. Casas de confiança: INSTANT +
  autoPayout + mínimo contratual = repasse na hora sem chuva de Pix.
- Migração auto_transfer (payout.external_id/fail_reason + org.auto_
  payout_min_cents). AUTO_TRANSFER_ENABLED=false por padrão — Arthur liga
  no Environment quando quiser estrear (sem chave Pix cadastrada o payout
  fica PENDING para o backoffice, sem drama).
Testes: ciclo saldo→payout→Pix→PAID com auditoria e mínimo por casa
segurando/soltando o repasse. API 30/30 · worker 3/3 · build 14/14.

**Regras de saque v2 — molde aprovado pelo Arthur (2026-08-09)** — o
produtor APERTA O BOTÃO; as regras decidem o caminho. Substitui a
varredura que criava repasse sozinha (Arthur vetou: "não quero 100%
automático, o cliente aperta um botão"):
- **Liberação (plano padrão)**: crédito de venda agora amadurece D+2
  ÚTEIS APÓS O EVENTO (padrão de mercado — o risco real é evento não
  acontecer; Sympla usa ~D+5, somos 2× mais rápidos). addBusinessDays em
  apply-status; RELEASE_BUSINESS_DAYS_AFTER_EVENT=2. Lançamentos antigos
  mantêm a data em que nasceram.
- **Clique do produtor** (requestPayout v2): mínimo por casa → 1 saque em
  andamento → 1/dia → quarentena de 48h após troca de conta/chave Pix
  (pixKeyUpdatedAt carimbado no addBankAccount) → saldo. Rotas: casa de
  CONFIANÇA (INSTANT) sob o teto contratual
  (instantMaxPerWithdrawalCents) = payout direto + fila do worker acordada
  (Pix em segundos com AUTO_TRANSFER_ENABLED); 1º saque da casa,
  ANTECIPAÇÃO e acima do teto = análise no backoffice.
- **Antecipação (padrão de mercado, receita)**: checkbox no modal de
  saque quando há saldo em janela; taxa pró-rata 1,25% a.m. simulada
  antes e lançada na aprovação; sempre passa por análise.
- **Backoffice**: fila "Saques aguardando análise" em /payouts com
  aprovar (dispara o Pix) e recusar com motivo; endpoints
  /v1/admin/payout-requests(+approve/reject).
- Worker: executeAutoTransfers vira o único papel da varredura (executa e
  concilia; NUNCA decide) — anti-duplicidade fail-closed mantida.
Testes (6): confiança saca na hora; teto roteia para análise; 1º saque com
análise; 1/dia; quarentena; antecipação com taxa no caixa. API 30/30 ·
worker 6/6 · build 14/14.

**Teto de 80% na antecipação (2026-08-10)** — decisão estratégica do
Arthur (benchmark: Sympla antecipa até 80% mediante análise; Cheers, o
concorrente direto, NÃO publica regras de dinheiro — brecha para a
BoraFest ser a plataforma de regras públicas e cravadas). Antecipação do
plano padrão libera liberado + 80% do em-janela (ANTICIPATION_MAX_BPS=
8000); os 20% retidos são colchão de reembolso até o evento. Mensagem
clara no erro e no modal ("antecipar até 80%..."). Casas de confiança
não passam por aqui. Teste do teto no repasse-automatico.test.ts.
Worker 6/6 · build 14/14.

**Tipo de produtor + Promoter v2 (2026-08-10)** — pedido do Arthur com
molde dele:
- **ProducerType obrigatório no cadastro** (CASA/ATLETICA/PRODUTORA/
  INDEPENDENTE/OUTRO) — segmenta contratos de confiança, promoters e
  relatórios; contas legadas ficam null até editar.
- **Promoter v2 = afiliado por CONTA DE PRODUTOR** (qualquer organização
  ativa, confirmado pelo Arthur): anfitriã busca por nome/nome comercial
  ou CPF/CNPJ (igualdade exata, resposta mascarada ***1234), convida com
  % sobre ingressos OU só-contabiliza (bps=0). Convite aceito no painel
  do promoter (seção Convites na lista de organizações); "Sou promoter"
  mostra link (?pr=slug), vendas e — SÓ quando há comissão — o dinheiro
  (a UI nunca diz "você não vai receber").
- **Link rastreável ?pr=** com last-click de 7 dias (mesmo mecanismo do
  ?p= de atlética); quando os dois existem, PROMOTER VENCE — nunca
  comissão dupla.
- **Split no caixa**: pagamento confirmado lança COMMISSION_DEBIT na
  anfitriã e COMMISSION_CREDIT na CARTEIRA do promoter, amadurecendo na
  MESMA regra da venda (D+2 úteis pós-evento) — saque pelas regras gerais
  já construídas, zero regra nova de dinheiro. Estorno total faz clawback
  idempotente (promoter devolve, anfitriã recebe de volta).
- Migração producer_type_promoter_v2 (enum + promoter_links + campos no
  pedido + tipos novos de lançamento).
Testes: ciclo completo (busca→convite→aceite→venda 10% = R$10→carteira→
estorno zera) e só-contabiliza (atribui sem dinheiro, payload sem campos
de comissão). API 32/32 · worker 6/6 · build 14/14.

**Conta no checkout v1 — fim do convidado (2026-08-10)** — estratégia
debatida e fechada com o Arthur ("convidado não serve, eu fico sem os
dados"), com o refinamento dele: o 1º ingresso NÃO viaja por e-mail — é o
portão que faz a conta ser verificada.
- **Checkout unificado**: sem abas convidado/código; nome, e-mail, CPF e
  celular sempre; aceite passa a incluir "criação da minha conta
  BoraFest" (LGPD).
- **Conta invisível no pedido**: e-mail sem conta → User nasce dos dados
  da compra (CPF/telefone só se livres — são únicos); e-mail com conta →
  pedido anexa. CPF da compra vira o CPF da conta (vínculo do ingresso).
- **Portão do 1º ingresso**: emissão para conta NÃO verificada gera só o
  e-mail account_claim com LINK MÁGICO (/acesso?token=JWT purpose
  email-verify, 7d) — clicar prova a posse do e-mail, verifica, loga e
  abre o pedido; a carteira do pedido devolve requiresVerification e a UI
  mostra o portão (pedir código de 6 dígitos = OTP normal, que agora
  também marca emailVerifiedAt). QR nunca sai por e-mail antes disso
  (modelo DICE — antifraude de print).
- **Corrigir e-mail digitado errado**: POST /orders/:publicToken/
  correct-email — só enquanto não verificada; posse do publicToken = a
  sessão que pagou; troca e-mail do user+pedido e reenvia o aviso.
- **2ª compra em diante**: verificado recebe ticket_delivery normal
  (e-mail/wpp/push), como o Arthur definiu.
- **WhatsApp**: botão "Receber meus ingressos no WhatsApp" (wa.me com
  texto pré-preenchido — conversa iniciada PELO cliente = resposta grátis
  na API da Meta); NEXT_PUBLIC_WHATSAPP_NUMBER no Dockerfile.checkout
  (vazio = oculto). Bot automático entra quando vierem as chaves Meta.
Testes: ciclo completo (conta nasce com CPF → aviso sem QR → carteira
trancada → link mágico verifica/loga/destrava → 2ª compra entrega
normal) e correção de e-mail com reenvio + trava pós-verificação.
API 34/34 · worker 6/6 · build 14/14.

**AUDITORIA DE SEGURANÇA + correções críticas (2026-08-10)** — depois do
incidente da Amanda ("sem permissão de edição"), varredura com 29 agentes
em 5 dimensões + verificação adversarial. 24 achados, 6 CRÍTICOS. TUDO
corrigido com teste de regressão (auditoria-seguranca.test.ts, 4 casos):
- **CRÍTICO — sequestro de conta**: informar e-mail de terceiro no
  checkout anônimo anexava o pedido À CONTA DELE; com correctEmail
  (público) o atacante trocava o e-mail da vítima e recebia link mágico =
  tomada total (inclusive de produtor com senha, que nunca tinha
  emailVerifiedAt). Correção: checkout sem sessão NÃO anexa a conta
  existente (o verifyOtp reivindica depois); correctEmail exige
  Order.accountCreatedByOrder (campo novo) e recusa conta com senha.
- **CRÍTICO — QR vazava por 4 portas**: qr.png, /status (ids), reenvio e
  WhatsApp ignoravam o portão do 1º ingresso (só a carteira travava); a
  rota de WhatsApp ainda mandava o QR para telefone arbitrário e
  sequestrava contactPhone. Portão agora é helper único
  (common/ticket-gate.ts) aplicado em todas; WhatsApp não sobrescreve
  contato existente.
- **CRÍTICO — saque duplicado**: TOCTOU (2 cliques = 2 saques) e aprovação
  dupla da mesma solicitação. Correção: criação em transação com
  re-checagem + índice único PARCIAL no banco (1 PENDING por org, em
  payout_requests e payouts) e updateMany com guarda de status.
- **CRÍTICO — estorno por partes**: 2 parciais somando o total deixavam
  ingressos VÁLIDOS e a comissão do promoter no bolso. Agora, ao alcançar
  o valor pago, vira REFUNDED de fato (ingressos cancelados + clawback).
- **CRÍTICO — escalação**: admin promovia alguém a OWNER. Só dono cria
  dono. Conta bancária (destino do dinheiro) passou a exigir gestão, não
  FINANCE_VIEW. Busca de organizações restrita a quem administra org.
- **ALTA — PII**: vendedor exportava CSV com nome/e-mail/CPF de todos.
  listOrders/participants/exports agora exigem FINANCE_VIEW.
- **ALTA — caixa**: repasse PAGO era contado como reservado E debitado
  (dupla subtração); e o repasse automático marcava PAGO sem debitar
  (dinheiro saía sem baixar saldo → risco de sacar 2×). Reservado agora é
  só PENDING e todo repasse concluído lança PAYOUT_DEBIT idempotente.
- **Funcionais**: papéis "Gestor do evento"/"Check-in" tomavam 403 ao
  listar eventos (painel inutilizável); admin tomava 403 no check-in ao
  vivo; apagar pixel não removia no servidor (checkout seguia disparando);
  "Sem categoria" era no-op; dashboard não devolvia mapsUrl.
API 42/42 · worker 6/6 · build 14/14.
⚠️ PRODUÇÃO ESTAVA EXPOSTA (rotas no ar desde f9ccb49) — deploy urgente.

**Pendências de homologação**: ativar webhook no painel Asaas → compra real
de R$ 1 → estorno de teste → usuário ADMIN de produção. Depois: chave Resend
(e-mail real) e Meta WhatsApp. Repo ainda público — Amanda vai adicionar a
deploy key do EasyPanel e privar.

### Onde estamos (2026-07-24, verificação de estado)

- **Handoff v1 (docs/design) implementado nas 4 superfícies**: Site Público
  desktop + hotsite com seleção sticky, App do Comprador (PWA com manifest e
  service worker), Painel do Produtor completo, App de Validação como PWA em
  `/portaria` (além do RN antigo em `apps/mobile-checkin`).
- **Saúde**: `pnpm build` 14/14 e `pnpm test` 24/24 verdes; API, worker e os 3
  frontends rodando em localhost (3333/3000/3001/3002).
- **2 bugs de build corrigidos nesta verificação**: (1) `NODE_ENV` vazava do
  `.env` para o `next build` via `globalPassThroughEnv` do turbo, fazendo o
  admin quebrar no prerender com runtime de dev; (2) dev server concorrendo
  pelo `.next` durante o build (limpar `.next` + parar dev antes de buildar).
- **Bloqueios de lançamento continuam externos**: conta PSP Pagar.me (chaves),
  provedor real de e-mail/WhatsApp, e VPS+domínio para subir.

### Sessão C7/C8 — Vendas (pedidos + reembolso + PDV) e Financeiro (2026-07-24, Claude)

- **Vendas** (`apps/producer/app/eventos/[eventId]/vendas/page.tsx`, nova):
  aba "Pedidos" com tabela (comprador, itens, status, total, criado/pago em)
  paginada e filtro por status, reusando `GET /v1/events/:eventId/orders`
  (já existia em `dashboard.service.ts`, só não tinha UI). Clique na linha
  abre painel lateral com detalhe (itens/lote, pagamento, ingressos) e ação
  "Reembolsar" (total ou parcial + motivo). Aba "PDV" registra venda
  presencial (lote + nome/documento/e-mail do comprador) já paga.
- **Endpoints novos no backend** (todos org-scoped via `OrgAccessService`,
  seguindo o mesmo padrão de `dashboard.controller.ts`/`finance.controller.ts`
  — nunca `platformRole=ADMIN`):
  - `GET /v1/orders/:orderId/detail` (`FINANCE_VIEW`) — detalhe completo do
    pedido para o painel.
  - `POST /v1/orders/:orderId/refund` (`ORDER_REFUND`) — equivalente
    org-scoped do `admin.refundOrder`: se o pedido tem pagamento real
    (Pix/cartão) chama o gateway como o fluxo admin; se é uma venda PDV
    (sem `Payment`222q, "pagã em dinheiro") faz o estorno manualmente no ledger
    e cancela os ingressos emitidos (reembolso total).
  - `POST /v1/events/:eventId/pdv-orders` (`EVENT_CREATE`, mesmo permission
    usado pelas cortesias) — cria a venda manual: reserva+confirma estoque
    na mesma transação, pedido já `PAID`, credita o ledger
    (`SALE_CREDIT`/`PLATFORM_FEE`, taxa calculada como Pix por não passar
    por gateway) e dispara o outbox `order.paid` — o worker emite os
    ingressos exatamente como numa compra online (mesmo caminho de
    cortesias, mas com valor real).
  - Contratos novos em `packages/contracts/src/orders.ts`
    (`pdvOrderSchema`/`PdvOrderInput`); reembolso reusa `refundOrderSchema`
    já existente em `admin.ts` (mesmo shape, sem duplicar).
- **Financeiro** (`apps/producer/app/organizacoes/[orgId]/financeiro/page.tsx`):
  restyle completo (KPIs de saldo/disponível, tabela de lançamentos com
  rótulos em PT-BR, tabela de repasses, formulário + lista de dados
  bancários). Endpoint novo `GET /v1/organizations/:id/payouts`
  (`finance.controller.ts`/`finance.service.ts`, permissão `FINANCE_VIEW`)
  — somente leitura; criação/marcação de repasse continua exclusiva do
  backoffice admin (`admin.controller.ts`), conforme decisão registrada no
  prompt (produtor não tem botão de "solicitar repasse").
- `npx tsc --noEmit -p .` limpo em `apps/api` e `apps/producer` (erros
  pré-existentes em `apps/api/src/__tests__/*.test.ts` não relacionados a
  esta mudança — assinatura antiga de um helper de teste).
- Nota: durante esta sessão outra sessão paralela também mexeu em
  `apps/producer/lib/api.ts`/`app/eventos/[eventId]/page.tsx` (C9); as
  duplicatas de `ordersApi`/`payoutsApi` que apareceram foram resolvidas
  mantendo uma única definição de cada.

### Sessão C9 — Participantes/Check-in ao vivo/Divulgue/Ajuda (2026-07-24, Claude)

- **Participantes** (`apps/producer/app/eventos/[eventId]/participantes/page.tsx`):
  restyle completo pro padrão rounded-2xl/border-line/bg-surface das outras
  telas, badges de status (`TicketStatus`: ISSUED/ACTIVE/CHECKED_IN em
  success, TRANSFERRED em muted, CANCELED/REFUNDED em danger) e busca
  client-side por nome/e-mail/código. Funcionalidade existente (listar via
  `dashboardApi.participants`, exportar CSV) preservada.
- **Check-in ao vivo standalone**
  (`apps/producer/app/eventos/[eventId]/checkin-ao-vivo/page.tsx`, nova):
  contador grande + barra de progresso + check-ins por portão, usando
  `GET /v1/events/:id/checkin-live` (que já expõe `byCheckinPoint` agrupado
  por `checkinPointId`) cruzado com `validatorConfigApi.listCheckinPoints`
  pra mostrar o nome do portão. **Gap conhecido**: a API não expõe um feed de
  check-ins individuais recentes (só contagem agregada por portão), então a
  tela não fabrica uma lista de "últimos check-ins" — ficou fora do escopo
  real do backend.
- **Divulgue** (`apps/producer/app/eventos/[eventId]/divulgue/page.tsx`,
  nova): link público do hotsite (`{CHECKOUT_URL}/evento/{slug}`, mesmo
  padrão já usado na seção Publicação da página do evento), botão copiar,
  texto pronto pra compartilhar e atalhos WhatsApp/X/Facebook. Sem QR: a
  única lib de QR do monorepo é `react-native-qrcode-svg` (só React Native,
  não roda no browser) — não valia adicionar dependência nova só pra isso,
  então ficou copiável/compartilhável apenas, como previsto no plano como
  fallback aceitável.
- **Ajuda** (`apps/producer/app/ajuda/page.tsx`, nova): FAQ estático
  (repasses, reembolso, check-in, cortesias, cupons, publicação, divulgação)
  e contato de suporte. Link "Ajuda" adicionado no `Nav.tsx` sem mais
  mudanças estruturais.
- Links adicionados na página do evento
  (`apps/producer/app/eventos/[eventId]/page.tsx`) para as duas telas novas.
- `npx tsc --noEmit -p .` limpo em `apps/producer` depois das mudanças.

### Sessão de pré-lançamento (2026-07-23, Arthur + Claude)

- **Verificação Ed25519 REAL no app de check-in** (fecha a limitação assumida
  da 1ª entrega): novo `src/qr/verifyTicketToken.ts` com `@noble/curves`
  (JS puro, roda no Hermes) — extrai a chave crua do PEM SPKI do manifesto e
  verifica a assinatura localmente; QR forjado é recusado **mesmo offline**.
  Compatibilidade cruzada provada (servidor assina com node:crypto → app
  verifica com noble; adulterado/chave errada rejeitados) e virou passo do CI.
- **Infra de produção** (`infra/docker/`): `Dockerfile.backend` (targets
  api/worker, prisma generate no build), `Dockerfile.web` (parametrizado por
  APP, Next standalone — `output: "standalone"` adicionado aos 3 apps),
  `docker-compose.prod.yml` (postgres+redis com healthcheck, serviço
  `migrate` one-shot antes de api/worker, 3 fronts, **Caddy com HTTPS
  automático** por domínio), `Caddyfile`, `.env.production.example`,
  `.dockerignore`. Compose validado com `config`.
- **CI GitHub Actions** (`.github/workflows/ci.yml`): install → prisma
  generate → build → testes unitários → typecheck do mobile → verificação
  cruzada do QR.
- **`docs/projeto/DEPLOY.md`**: passo a passo de VPS (DNS, subir, atualizar,
  seed, webhook Pagar.me, backup/restauração) + pendências conhecidas.
- **`docs/projeto/PLANO-DE-TESTES.md` (RASCUNHO para revisar com o Arthur)**:
  §22 completo mapeado em 6 blocos com status real (o que já passou em
  2026-07-23, o que é parcial, o que trava em celular/VPS/conta PSP) e ordem
  sugerida de execução.

### Bloco D — restyle do app de validação (2026-07-24, Amanda + Claude)

Implementado o Bloco D do `BACKLOG-PROTOTIPO.md` inteiro em `apps/mobile-checkin`,
restyle sobre a lógica existente (device auth, manifest sync, fila offline,
verificação Ed25519) sem tocar nela:

- **D1** — `PinLoginScreen.tsx`: PIN vira dots (preenchido/vazio) + teclado
  numérico 3×4 (`Animated` para o shake em PIN errado), mantendo o campo de
  ID do evento (a sessão do validador exige `eventId`+`pin` juntos — não dá
  para tirar sem mudar a API) e o fluxo `api.createValidatorSession` intacto.
- **D2** — `HomeScreen.tsx` restyled (tema dark/roxo, `src/theme/colors.ts`
  novo) + `CameraPrimingScreen.tsx` novo: pede permissão da câmera antes de
  abrir o scanner, com tela amigável de negada + atalho para configurações
  do aparelho (`Linking.openSettings`).
- **D3** — `ScannerScreen.tsx`: moldura com cantos + scanline animada
  (`Animated.loop`), chip de status online/offline com contagem da fila
  (deriva do retorno `offline` de cada tentativa de check-in + polling do
  sqlite local), botão de lanterna via `enableTorch` do `expo-camera`.
- **D4** — `ResultBanner.tsx` virou visão full-screen por estado (verde
  válido/âmbar já-usado com horário do check-in original/vermelho
  inválido-cancelado), com nome, tipo de ingresso e código. Isso exigiu
  estender `CheckinAttemptResult` (`attemptCheckin.ts`) com `ticketType` e
  `previousCheckinAt` vindos do `CheckinResponse` já retornado pela API —
  nenhuma mudança na verificação Ed25519.
- **D5** — `ManualSearchScreen.tsx` restyled; `SyncSummaryScreen.tsx` novo
  (pendentes na fila, hora da última sync via `meta.lastSyncAt`, lista dos
  check-ins recentes deste aparelho via `listRecentCheckins` novo em
  `database.ts`); `PrivacyScreen.tsx` novo (texto estático LGPD).
  **Gap real encontrado**: `POST /v1/checkins/:id/reverse` usa
  `SessionGuard` (login do produtor), não `ValidatorDeviceGuard` — o
  aparelho de portaria só tem token de dispositivo, então não consegue
  chamar esse endpoint. Como o controller de check-ins está fora do escopo
  desta sessão (outros agentes mexendo em `apps/producer`/`apps/api`), o
  botão "Reverter" do resumo explica isso ao usuário em vez de tentar
  reverter — reversão continua só pelo painel do produtor. D5 marcado 🟡
  no backlog por causa disso.
- `npx tsc --noEmit` em `apps/mobile-checkin` passou limpo depois das
  mudanças. **Não foi possível testar em aparelho/emulador real** nesta
  sessão — validação é só de tipos/lógica, não visual.

### Validação em navegador real (2026-07-23, Arthur + Claude)

A pendência "abrir os 3 frontends num navegador de verdade" foi executada:

- **Checkout** (`:3000`): compra completa CLICADA — página do evento (taxa
  transparente) → +2 ingressos → checkout convidado → QR Pix na tela →
  webhook mock aprovado → **a página avançou sozinha para a carteira** com os
  2 ingressos (QR, código, lote). Reenvio funcionando com rate-limit exibido
  ao usuário.
- **Painel do produtor** (`:3001`): login OTP real (código do log da API) →
  organizações → evento → catálogo (6/100 vendidos, consistente) → dashboard
  (R$ 528, 4 FULFILLED/2 EXPIRED, 1 CHECKED_IN) → participantes → portaria
  (portão, gerar PIN, aparelho BLOCKED do teste de bloqueio remoto) →
  financeiro (SALE_CREDIT R$ 176,00 + PLATFORM_FEE −R$ 8,78 = **4,99%
  aplicado ao vivo**).
- **Backoffice** (`:3002`): login OTP com `platformRole=ADMIN` → organizações
  → busca de pedidos por e-mail com ações reenviar/estornar → saúde das filas
  (contadores reais das 5 filas + outbox) → auditoria (checkin.reverse do
  teste E2E visível).
- **🐛 Bug real encontrado e corrigido nos 3 apps**: os helpers `lib/api.ts`
  mandavam `Content-Type: application/json` SEMPRE, inclusive em POST sem
  corpo (resend, estorno, bloqueio, marcar pago…) — o Fastify rejeita JSON
  declarado e vazio com 400 antes de chegar ao controller. Corrigido: o
  header só vai quando há corpo. Provado antes/depois via curl.

### Onde paramos

- **Núcleo da Fase 4 pronto e testado a nível de código** (tudo backend):
  - Schema: `payments`, `payment_events`, `webhook_deliveries`, `tickets`,
    `event_signing_keys` + janela de pagamento no pedido
    (migration `20260723054509_payments_tickets_webhooks`).
  - `packages/payments`: interface `PaymentGateway` (§11) + `MockGateway`
    (webhook HMAC) + registry + `applyGatewayStatus` (transições idempotentes,
    compartilhado por API e worker).
  - `packages/tickets`: QR Ed25519 (`BF1.<payload>.<assinatura>`) + código humano.
  - API: `POST /v1/orders/:id/payments/pix|card` (Idempotency-Key),
    `POST /v1/webhooks/payments/:provider` (assinatura verificada, payload bruto
    salvo, dedupe por evento), `GET /v1/orders/:token/tickets`, `GET /v1/me/tickets`.
  - Worker: outbox (emissão exatamente-uma-vez, estorno automático de pagamento
    órfão, revogação por estorno/chargeback), reconciliação de pagamentos,
    expiração de pedidos (libera estoque reservado).
  - **Mudança de semântica**: pedido não confirma mais venda na criação; estoque
    fica em `reserved_count` até o pagamento aprovar (webhook) — `sold_count` só
    no PAID. Janela de pagamento: 15 min.
- **Testes executados e passando** (ver §22 da arquitetura):
  fluxo Pix completo até FULFILLED com 2 tickets; webhook duplicado (no-op);
  assinatura inválida (401); cartão aprovado/recusado; replay de Idempotency-Key
  (mesma resposta, 1 pagamento só) e key reusada com payload diferente (422);
  pagamento aprovado APÓS pedido expirar → estorno automático (bug real
  encontrado e corrigido no teste); QR verificado criptograficamente e
  adulteração rejeitada; 10 compradores concorrentes em lote de 3 → exatamente
  3 reservas, zero overselling.
- **Pesquisa de gateways concluída** — ver
  [`pesquisa-gateways-2026-07.md`](pesquisa-gateways-2026-07.md).
  Recomendação: **Pagar.me primário** (split nativo com hold-até-KYC via status
  do recebedor; Pix 1,19%; crédito 4,39%) + **Asaas fallback** (Pix fixo R$1,99,
  cartão 2,99%+R$0,49; limites de onboarding no começo). Taxa BoraFest sugerida:
  **Pix 4,99% (piso R$2,49) / cartão 6,99%**, blended ~5,6% — abaixo de Sympla
  (~12%), Even3/Ingresse (10%) e challengers (7,99%).
  **⏳ Aguardando o OK do Arthur para fechar o provedor e escrever o adapter real.**

### Decisões tomadas (2026-07-23)

- ✅ **Taxa BoraFest ao produtor CONFIRMADA pelo Arthur**: Pix **4,99%**
  (piso R$2,49/ingresso), cartão **6,99%**, juros de parcelamento repassados ao
  COMPRADOR, boleto R$3,49 repassado ao comprador. Headline: "a partir de 4,99%
  no Pix, teto de 6,99%". Estrutura híbrida (%+piso fixo) também por prudência
  jurídica (entendimento Procon-SP vs. taxa percentual pura).
- ✅ **Gateway primário CONFIRMADO pelo Arthur: Pagar.me** (2026-07-23), com a
  condição de ficar **fácil de trocar** — atendida pela interface
  `PaymentGateway` + registry (`PAYMENTS_PROVIDER` escolhe o adapter; mock,
  pagarme, e futuros asaas/celcoin convivem). Alternativas descartadas na
  discussão: Mercado Pago (sem custódia própria — repasse direto ao vendedor;
  workaround de "cair na nossa conta" reprovado por risco regulatório e imposto
  sobre faturamento bruto) e Celcoin (não é mais barato em ticket baixo — Pix
  fixo R$1,50 vs 1,19% — e exige orquestrar a trava de KYC na mão).

### Fase 4 — CONCLUÍDA ✅

`PagarmeGateway` real implementado com fatos verificados na doc oficial v5
(auth Basic, `Idempotency-key` literal, QR em `last_transaction.qr_code`,
`card_token`, `DELETE /charges` p/ estorno, webhook SEM HMAC — autenticação
Basic do dashboard, fail-closed). 10 testes unitários com fetch stubado.
Troca de provedor = env `PAYMENTS_PROVIDER`.

### Fase 5 (backend) — CONCLUÍDA ✅

- `packages/notifications`: interfaces `EmailSender`/`WhatsAppSender` +
  adapters devlog + registry por env (mesmo padrão dos gateways) + templates
  puros pt-BR testados.
- Tabela `notifications` = fila persistente (PENDING→SENT/FAILED, retry com
  backoff, migration `20260723061545_notifications_contact_phone`).
- Emissão → notificações na MESMA transação do FULFILLED (entrega
  exatamente-uma-vez; e-mail sempre, WhatsApp se houver `contactPhone`).
- Link profundo `WEB_BASE_URL/pedido/:publicToken` (carteira sem conta/app).
- `POST /v1/orders/:publicToken/resend` com limite de 3 notificações/hora.
- Testado de ponta a ponta: fluxo Pix → SENT nos 2 canais no log do adapter,
  link presente, reenvio bloqueado após limite.

### Fases 6/7 (backend do check-in) — CONCLUÍDAS ✅ (lado servidor)

- Schema: `checkin_points`, `validator_credentials` (PIN hasheado),
  `validator_devices` (token hasheado + bloqueio remoto), `checkins`
  (CONFIRMED/CONFLICT/REVERSED, unique device+localSeq), `checkin_sync_batches`
  (idempotência por lote); `Ticket.updatedAt` p/ manifesto delta
  (migration `checkin_validators`).
- Produtor (RBAC): criar/listar portões, gerar credencial PIN (PIN mostrado
  uma única vez, só hash no banco), listar/bloquear dispositivos.
- App validador: `POST /v1/validator/sessions` (PIN → registra aparelho e
  devolve token de dispositivo), refresh de token, manifesto completo e delta
  (`?since=`) com a chave pública Ed25519 do evento.
- `POST /v1/checkins`: QR verificado criptograficamente no servidor, transição
  atômica "primeiro vence" (VALID/ALREADY_USED/INVALID/CANCELED + quem validou
  antes); `POST /v1/checkins/sync` idempotente por (device, batchKey) com
  CONFLICT auditável; reversão com permissão + audit_log; `checkin-live`.
- Testado de ponta a ponta (8 cenários §22): PIN errado 401, QR válido,
  duplicado com identificação do 1º aparelho, QR adulterado, sync com
  conflito, reenvio de lote idêntico sem duplicar, reversão devolvendo o
  ingresso a ACTIVE com auditoria, bloqueio remoto cortando o scan (401).

### Fase 8 — CONCLUÍDA ✅

- Schema: `User.platformRole` (`SUPPORT`/`ADMIN` — equipe interna BoraFest,
  independente das roles de organização) e overrides de taxa por organização
  (`Organization.pixFeeBps/pixFeeFloorCents/cardFeeBps`, null = padrão da
  plataforma) — migration `20260723122219_platform_role_and_org_fees`.
- **Dashboard do produtor** (`apps/api/src/dashboard`, autorizado por
  `PERMISSIONS.FINANCE_VIEW` via `OrgAccessService`, igual ao resto da API):
  `GET /v1/events/:id/dashboard` (receita, pedidos por status, ingressos por
  status, lotes com capacidade/vendido/reservado), `GET /v1/events/:id/orders`
  (paginado), `GET /v1/events/:id/participants` e
  `GET /v1/events/:id/participants/export` (CSV).
- **Backoffice mínimo** (`apps/api/src/admin`, novo `PlatformAccessService`
  em `common/` — `assertStaff`/`assertAdmin`, mesmo padrão do
  `OrgAccessService` mas sem escopo de organização): `GET/POST
  /v1/admin/organizations(/:id/fee|/block|/unblock)`, `GET /v1/admin/events`
  e `POST /v1/admin/events/:id/block`, `GET /v1/admin/orders` (busca por
  publicToken/email/evento), `POST /v1/admin/orders/:publicToken/resend`
  (reaproveita `NotificationsService.resendTickets`), `POST
  /v1/admin/orders/:publicToken/refund` (estorno controlado — reaproveita
  `getGateway().refund()` + `applyGatewayStatus`, o MESMO caminho idempotente
  do webhook, nunca muta status à parte), `GET /v1/admin/webhooks`
  (`WebhookDelivery`) e `GET /v1/admin/queues` (job counts das 5 filas BullMQ
  e contagem do `outbox_events`). Toda ação sensível grava `AuditLog`.
- Completando o §17 (revisão pós-primeira entrega): `POST
  /v1/admin/tickets/:id/block` (bloqueio de ingresso individual — status
  `CANCELED`, idempotente contra ingresso já cancelado/reembolsado) e
  `GET /v1/admin/audit-logs` (visualizar auditoria, filtro por
  entityType/entityId/organizationId).
- Testado de ponta a ponta: dashboard/participantes/CSV com pedido real
  `FULFILLED` (reserva → pedido → Pix mock → webhook assinado → ticket
  emitido); backoffice com usuário `platformRole=ADMIN`: taxa configurada,
  evento/pedido listados, reenvio, estorno controlado (pedido foi a
  `REFUNDED`, pagamento `REFUNDED` via gateway mock — e o worker já revoga o
  ingresso sozinho nesse caso, achado ao testar: `payment_reversed` cancela o
  ticket, mas não devolve estoque), webhook e filas visíveis, bloqueio de
  ingresso ativo (segunda compra completa só para este teste) e consulta de
  auditoria filtrada por `entityType=ticket`.
- Fora do escopo (nota já em MEMORIA.md): estorno/revogação ainda não devolve
  estoque ao lote para revenda — fica para a Fase 9.

### Fase 9 (núcleo) — CONCLUÍDA ✅

- Schema: `ledger_accounts` (1:1 com organização), `ledger_entries`
  (append-only, `amountCents` assinado: positivo=crédito/negativo=débito;
  tipos `SALE_CREDIT`/`PLATFORM_FEE`/`REFUND_DEBIT`/`PAYOUT_DEBIT`) e
  `payouts` (`PENDING`/`PAID`/`FAILED`) — migration
  `20260723125445_ledger_and_payouts`.
- `packages/payments/src/fees.ts`: `computePlatformFeeCents(method,
  amountCents, org)` — usa os overrides de `Organization` (Fase 8) e cai no
  padrão da plataforma (env `PLATFORM_PIX_FEE_BPS`/`_FLOOR_CENTS`/
  `PLATFORM_CARD_FEE_BPS`, default 499/249/699 = decisão de 2026-07-23).
- **Ganchos direto no `applyGatewayStatus`** (único caminho, nunca duplicado):
  `PAID` → `creditOrganizationLedger` (SALE_CREDIT bruto + PLATFORM_FEE da
  comissão, na mesma transação que confirma o estoque vendido);
  `REFUNDED`/`CHARGEBACK` → `reverseOrganizationLedgerAndStock` (REFUND_DEBIT
  que zera os dois lançamentos anteriores + `returnSaleInventory` devolve
  `sold_count` ao lote — fecha a lacuna que ficou registrada desde a Fase 4).
- API produtor: `GET /v1/organizations/:id/balance` e `/ledger`
  (`PERMISSIONS.FINANCE_VIEW`, mesmo padrão do dashboard).
- Backoffice: `GET /v1/admin/organizations/:id/ledger`, `GET
  /v1/admin/payouts`, `POST /v1/admin/organizations/:id/payouts` (cria
  repasse do saldo disponível — **bloqueado se `Organization.status !==
  'ACTIVE'`**, ou seja, sem KYC aprovado não sai repasse) e `POST
  /v1/admin/payouts/:id/mark-paid` (confirma transferência bancária manual,
  lança `PAYOUT_DEBIT`). Execução bancária real (split/recebedores Pagar.me)
  continua fora do escopo — depende de KYC comercial, por isso o repasse é
  confirmado manualmente por enquanto.
- Testado de ponta a ponta: venda nova → `SALE_CREDIT` 5500 + `PLATFORM_FEE`
  -274 (4,99% de R$55,00) → saldo R$52,26; **payout bloqueado com KYC
  pendente** (org `PENDING_VERIFICATION`); org aprovada (`ACTIVE`) → payout
  criado → marcado pago → saldo zera; estorno do mesmo pedido DEPOIS do
  payout → estoque devolvido (disponibilidade voltou a 1) e saldo foi a
  -5226 (`availableForPayoutCents` corretamente travado em 0, não negativo).

### Fase 6 (app RN de check-in) — CÓDIGO ESCRITO 🟡, não testado em aparelho

Criado `apps/mobile-checkin` (Expo + React Native + TypeScript):

- Login por PIN (`POST /v1/validator/sessions`) — registra o aparelho e
  guarda `deviceId`/`deviceToken` em `expo-secure-store`.
- Manifesto sincronizado (completo na 1ª vez, delta depois) e cacheado em
  SQLite local (`expo-sqlite`) — tabelas `tickets`, `pending_checkins`,
  `confirmed_checkins`, `meta`.
- Scanner de QR (`expo-camera`) → `POST /v1/checkins` online por padrão;
  se a rede falhar, cai para pré-check local contra o manifesto cacheado
  (`src/checkin/attemptCheckin.ts`) e enfileira o check-in.
- Busca manual por código (o manifesto não traz nome/CPF — só o caminho
  online devolve isso, então a busca offline é só por código).
- Fila offline com sincronização em lote (`POST /v1/checkins/sync`,
  `batchKey` novo por tentativa, idempotente do lado do servidor).
- Contador local (confirmados/pendentes) — **não é o contador oficial do
  produtor**: descobrimos ao mapear os contratos que
  `GET /v1/events/:id/checkin-live` e `POST /v1/checkins/:id/reverse`
  exigem `SessionGuard` (sessão de usuário do produtor), não
  `ValidatorDeviceGuard` (token de aparelho) — o app de portaria não
  consegue chamar essas duas rotas. Isso é esperado (reversão é ação do
  painel, não do celular na portaria), então o app mantém seu próprio
  contador a partir do que ele mesmo confirmou/sincronizou.
- **Simplificação assumida e documentada** (`apps/mobile-checkin/README.md`):
  o parser local do QR (`src/qr/parseTicketToken.ts`) decodifica o payload
  mas **não verifica a assinatura Ed25519** — isso exigiria uma lib de
  crypto compatível com React Native (`node:crypto` não roda lá), fora do
  escopo desta entrega. A verificação de assinatura de verdade continua
  sendo sempre do servidor, tanto no scan online quanto na sincronização do
  lote; o pré-check offline é só uma conveniência de UX/gating local.
- `pnpm --filter @borafest/mobile-checkin typecheck` limpo. **Não rodado em
  emulador/celular real** — este ambiente de trabalho não tem Android
  Studio/Xcode nem um dispositivo físico conectado. Falta validar na prática
  (Expo Go) antes de confiar no app em produção.

Criado também `docs/projeto/API-REFERENCE.md`: tabela de toda rota da API
(verbo, path, guard, schema do corpo), organizada por módulo — não existia
um lugar único para consultar isso antes (só dava pra achar lendo
controller por controller).

### Checkout web (Fase 3, frontend) — CONCLUÍDO ✅

Criado `apps/checkout` (Next.js 14 App Router + TypeScript + Tailwind),
consumindo direto a API que já existia desde a Fase 3 (backend) — nenhuma
rota nova precisou ser criada. Três páginas:

- `/evento/[slug]` — página pública (server component, busca
  `GET /v1/public/events/:slug` + `/availability`), seletor de quantidade
  por lote e botão "Continuar" que cria a reserva (`POST /v1/reservations`).
- `/checkout/[reservationId]` — formulário de contato (e-mail obrigatório,
  nome e WhatsApp opcionais, sem exigir conta) → cria o pedido
  (`POST /v1/orders`) → gera cobrança Pix (`POST /v1/orders/:id/payments/pix`)
  → mostra QR code (via `react-qr-code`) + código copia-e-cola → faz polling
  do status do pedido a cada 3s e redireciona pra carteira quando `FULFILLED`.
- `/pedido/[publicToken]` — carteira: lista os ingressos com QR (o token
  assinado, não o código curto) e botão de reenvio
  (`POST /v1/orders/:publicToken/resend`).

**Bug real encontrado testando contra a API de verdade** (não só typecheck):
`GET /v1/orders/:publicToken/tickets` NÃO devolve um array direto — devolve
`{ orderId, orderStatus, event, tickets: [...] }`. O cliente HTTP do app
(`lib/api.ts`) assumia array; corrigido antes de commitar. Isso reforça por
que testar contra a API real importa mesmo com typecheck limpo (o tipo era
só uma suposição minha até eu testar).

Testado de ponta a ponta com o event/lote de teste já usado nas fases
anteriores: página do evento renderiza preço+taxa corretos via SSR, reserva
→ pedido → Pix mock → webhook assinado → `FULFILLED` com ticket emitido,
tudo com os MESMOS contratos que o app usa (validado via curl simulando as
chamadas que o frontend faz). `next build` e `tsc --noEmit` limpos.

**Não testado visualmente num navegador** — este ambiente de trabalho não
tem ferramenta de browser/screenshot; a validação foi por contrato de API
(request/response reais) e build/typecheck, não por "clicar e ver". Antes
de confiar 100%, abrir `pnpm --filter @borafest/checkout dev` e navegar o
fluxo manualmente uma vez.

### Painel do produtor (Fase 8, frontend) — CONCLUÍDO ✅

Criado `apps/producer` (Next.js 14 + TypeScript + Tailwind). Diferente do
checkout (que não precisa de login), aqui todo mundo autentica por OTP e o
token de sessão fica em `localStorage` (`lib/auth.tsx`, `AuthProvider` +
`AuthGuard` client-side — sem middleware/servidor, é tudo SPA-like dentro
do App Router). Páginas:

- `/login` — OTP por e-mail (reaproveita `POST /v1/identity/otp/*`).
- `/organizacoes` — lista as organizações do usuário e cria novas.
- `/organizacoes/:id` — lista/cria eventos da organização; link pro financeiro.
- `/organizacoes/:id/financeiro` — saldo e extrato do ledger (Fase 9).
- `/eventos/:id` — publica o evento, cria tipo de ingresso e lote (ativa
  automaticamente), lista os lotes com vendido/disponível.
- `/eventos/:id/dashboard` — receita, pedidos/ingressos por status, lotes.
- `/eventos/:id/participantes` — lista + export CSV (via fetch+blob, não
  `<a href>` — o endpoint exige `Authorization`, um link puro não manda o
  header).
- `/eventos/:id/portaria` — cria portão, gera PIN de validador (mostrado
  uma vez), lista/bloqueia dispositivos.

**Duas lacunas reais de backend encontradas e corrigidas ao construir o
painel** (não só suposição — vieram de tentar montar a tela e faltar dado):

1. **Não existia `GET /v1/organizations`** para listar as organizações do
   usuário logado (só `POST` de criar existia). Adicionado
   `OrganizationsService.listForUser` + rota, testado retornando a org
   existente com `roleKey`.
2. **`GET /v1/events/:id/dashboard` não expunha o `ticketTypeId` de cada
   lote** (só `typeName`) — sem isso, a tela não tinha como saber em qual
   tipo de ingresso criar um lote novo sem o produtor digitar um UUID à
   mão. Adicionado `ticketTypeId` no mapeamento do dashboard.

Ambas registradas em `docs/projeto/API-REFERENCE.md`.

**Limitação assumida**: tipos de ingresso sem nenhum lote ainda não aparecem
em lugar nenhum da API (só o dashboard, que só devolve lotes) — o painel
contorna isso guardando os tipos criados na sessão atual em memória; se a
página for recarregada antes de criar o lote, o tipo "some" da tela (ele
continua existindo no banco, só não tem como listar). Documentado no
código (`knownTypes` em `eventos/[eventId]/page.tsx`).

Testado de ponta a ponta contra a API real: login por OTP → listar
organização → dashboard do evento com `ticketTypeId` novo → criar tipo de
ingresso → criar portão → gerar PIN de validador (PIN de verdade
devolvido) → exportar CSV de participantes com o header `Authorization`
correto. `next build`/`tsc --noEmit` limpos. **Não aberto num navegador de
verdade** — mesma ressalva do checkout, sem ferramenta de browser neste
ambiente.

### Backoffice web (Fase 8, frontend) — CONCLUÍDO ✅

Criado `apps/admin` (Next.js 14 + TS + Tailwind), mesmo padrão de auth do
painel do produtor (OTP + token em `localStorage`), mas o `AuthGuard`
também barra quem não tem `platformRole` (redireciona pra `/login?erro=
sem-acesso`). Páginas de admin condicionam ações sensíveis (taxa, bloqueio,
estorno, criar/marcar repasse) a `user.platformRole === 'ADMIN'` no
client — só UX, a autorização de verdade é sempre checada no backend
(`PlatformAccessService`), o frontend nunca é a única barreira.

Páginas: `/organizacoes` (lista + link de detalhe), `/organizacoes/:id`
(saldo/disponível-pra-repasse, configurar taxa Pix/cartão, bloquear/
desbloquear, criar repasse), `/eventos` (listar + bloquear), `/pedidos`
(buscar por token/e-mail, reenviar, estornar), `/payouts` (listar +
marcar pago), `/webhooks` (histórico), `/filas` (job counts das 5 filas
BullMQ + outbox), `/auditoria` (filtro por tipo de entidade).

Testado de ponta a ponta contra a API real com o usuário `platformRole=
ADMIN` já promovido nas sessões anteriores: organizações/eventos/queues/
ledger/payouts/pedidos/auditoria — todos os contratos batendo exatamente
com as interfaces TypeScript do frontend (nenhum ajuste de contrato foi
necessário desta vez, diferente do producer). `next build`/`tsc --noEmit`
limpos. **Não aberto num navegador de verdade** — mesma ressalva de
sempre, sem ferramenta de browser neste ambiente.

Com isso, as três frentes de frontend web que dependiam só da API
existente estão prontas: checkout, painel do produtor e backoffice.

### App de check-in — bug real de bundling encontrado e corrigido ✅

Sem emulador/celular neste ambiente, tentei uma validação mais forte que
`tsc` para o `apps/mobile-checkin`: `expo-doctor` (16/17 checks — só
`typescript` numa versão mais nova que o esperado pelo SDK, inofensivo) e,
principalmente, `npx expo export --platform android|ios`, que roda o
bundler Metro de verdade. **Isso pegou um bug real que o typecheck nunca
pegaria**: faltava `metro.config.js` configurado pra monorepo pnpm —
Metro tem resolução de módulos própria (não usa `require.resolve` do
Node) e quebrava de três formas em cascata sob os symlinks do pnpm:

1. Não achava `./node_modules/expo/AppEntry.js` (o `main` default do
   Expo) a partir do symlink do app.
2. Depois de apontar `nodeModulesPaths` pro workspace root, não achava
   `@babel/runtime` (dependência transitiva do `expo`, não hoisted pelo
   pnpm) — resolvido adicionando `@babel/runtime` como dependência direta
   do app.
3. O próprio `expo/AppEntry.js` faz `import App from '../../App'` — um
   caminho relativo que, seguido a partir do destino REAL do symlink
   (dentro de `node_modules/.pnpm/expo@.../`), aponta pro lugar errado.
   Resolvido trocando o entry point: `index.js` próprio na raiz do app
   (`registerRootComponent` direto, sem depender do `AppEntry.js` do
   pacote) + `"main": "index.js"` no `package.json`.

Com os três ajustes, `expo export` gerou o bundle de verdade pras duas
plataformas: **Android, 583 módulos, 1.62 MB** e **iOS, 584 módulos,
1.61 MB**, ambos sem erro. Isso é uma prova bem mais forte que "os tipos
batem" — o grafo de dependências inteiro do app resolve e o código
transpila de ponta a ponta. Ainda não prova que a UI renderiza certo ou
que a câmera/SQLite funcionam em runtime (isso só um aparelho/emulador
de verdade mostra), mas elimina uma categoria inteira de erro
("funciona no `tsc`, quebra no `expo start`") antes mesmo de alguém
tentar abrir o app.

### Testes automatizados de regressão — CRIADOS ✅

Até aqui, tudo que foi "testado de ponta a ponta" nas fases anteriores foi
validação manual (curl, scripts ad-hoc) — nunca virou proteção contra
regressão. Criado `apps/api/src/__tests__/` (Node test runner nativo via
`tsx --test`, mesmo padrão já usado em `packages/payments`/`packages/
tickets`/`packages/notifications` — não introduzi Jest):

- `inventory-concurrency.test.ts` — 10 tentativas concorrentes contra um
  lote de capacidade 3: exatamente 3 reservam, 7 recebem
  `InsufficientStockError`, disponibilidade final bate.
- `order-payment-flow.test.ts` — reserva → pedido → Pix mock →
  `applyGatewayStatus(..., "PAID")`: pedido vai a `PAID`, ledger recebe
  exatamente `SALE_CREDIT`+`PLATFORM_FEE` (2 lançamentos), estoque confirma
  venda; **webhook duplicado é no-op** (reaplica `PAID`, `paymentChanged
  === false`, ledger continua com 2 lançamentos, não 4).
- `checkin-race.test.ts` — 8 aparelhos escaneando o mesmo ingresso (por
  código, sem depender de assinatura de QR) ao mesmo tempo: exatamente 1
  `VALID`, os outros 7 `ALREADY_USED`, só 1 `Checkin` `CONFIRMED` no banco.

Cada teste cria sua própria organização/evento/lote (`__tests__/
helpers.ts`, nomes com sufixo aleatório) e limpa tudo no fim — rodam
contra o Postgres de dev sem sujar dados nem colidir entre execuções.
`pnpm --filter @borafest/api test` roda os 3.

**Dois bugs reais achados escrevendo os testes** (nenhum no app, mas
documentando porque valem a pena saber):

1. `ReservationsService`/`OrdersService` abrem uma conexão Redis/BullMQ
   persistente no construtor (correto pra uma API de vida longa) — num
   script de teste de vida curta isso mantém o processo vivo pra sempre e
   trava o test runner mesmo com todos os testes passando. Resolvido
   expondo `closeRedisConnection()` em `packages/queues` e chamando num
   hook `after()` do Node test runner.
2. No fixture do teste de check-in, gerei o código do ingresso com hex
   minúsculo (`randomBytes(...).toString('hex')`) — `resolveTicket` no
   `CheckinsService` busca por `code.toUpperCase()`, e o Postgres compara
   string por igualdade exata (sem `COLLATE NOCASE` como o SQLite do app
   RN), então nunca batia. Bug do teste, não do app; corrigido usando
   `generateTicketCode()` de `@borafest/tickets` (o gerador de verdade,
   sempre maiúsculo) em vez de inventar um formato de código no teste.

### Fase 11 (teste de carga) — primeira leva CRIADA ✅

`apps/api/scripts/load-test-reservations.ts` (`pnpm --filter @borafest/api
load-test`): dispara N reservas HTTP concorrentes de verdade (Fastify →
Nest → Postgres, não in-process como os testes de integração) contra um
lote recém-criado de capacidade C, e falha se vender mais que C. É o teste
bloqueante da arquitetura §22 ("concorrência de centenas de compras no
último ingresso"), agora rodável a qualquer momento, não só manualmente.

Rodado em duas escalas: **100 tentativas / capacidade 5** → exatamente 5
reservadas, 95 recusadas, 0 erro de rede, 133 req/s; **500 tentativas /
capacidade 20** (escala mais realista de evento-piloto) → exatamente 20
reservadas, 480 recusadas, 0 erro de rede, 139 req/s. Zero overselling nas
duas, no processo real da API (não um script isolado).

### Fase 11 (rate limit) — CRIADO ✅

`RateLimitGuard` (`apps/api/src/common/rate-limit.guard.ts`), guard global
via `APP_GUARD`, contando requisições no Redis (`INCR`+`EXPIRE`). Fallback
de 120/min/IP em toda rota sem anotação; rotas sensíveis anotadas com
`@RateLimit`: `POST /v1/identity/otp/request` (5/15min, por **destino**
— não só IP, senão dá pra spammar um e-mail alheio de vários IPs),
`POST /v1/identity/otp/verify` (10/15min por IP — defesa em profundidade;
o limite de 5 tentativas por código já existia por challenge desde a
Fase 1) e `POST /v1/reservations` (20/min por IP — trava bot de scalping
sem incomodar compra legítima).

Testado ao vivo contra a API rodando: 6ª tentativa de OTP pro mesmo
destino em 15min → `429`; destino diferente não é afetado (chave por
destino, não só IP); 21ª reserva do mesmo IP em 1min → `429`.
**Ajuste no teste de carga**: o rate limit por IP começou a interferir no
`load-test-reservations.ts` (que dispara tudo de um processo só); corrigido
mandando um `x-forwarded-for` diferente por tentativa — mais realista
também (simula compradores distintos, não um bot de um IP), e o teste
voltou a passar limpo (100 tentativas, 5 reservadas, zero interferência
do rate limit).

### Fase 12 (app público do comprador) — CÓDIGO ESCRITO 🟡

Criado `apps/mobile-public` (Expo + React Native + TypeScript), mesmo
esqueleto do `apps/mobile-checkin` (já resolvido: `metro.config.js` +
`index.js` como entry point próprio — ver Fase 6). Telas: descoberta de
eventos (home), evento + seleção de ingressos + reserva, checkout (dados
+ Pix via `react-native-qrcode-svg` + polling), carteira (ingressos com
QR + reenvio), e "meus ingressos" opcional (login por OTP,
`expo-secure-store`) — a compra em si nunca exige conta.

**Lacuna real de backend encontrada e corrigida**: não existia nenhum
endpoint de listagem de eventos publicados — só busca por slug de um
evento específico (`GET /v1/public/events/:slug`). Sem isso não tem como
existir uma tela de "descoberta". Adicionado `GET /v1/public/events`
(paginado, `fromPriceCents` calculado a partir dos lotes ativos),
registrado em `docs/projeto/API-REFERENCE.md`.

Testado contra a API real: descoberta lista o evento de teste com preço
correto; `GET /v1/me/tickets` responde `[]` corretamente pra um usuário
sem compras feitas logado (as compras de teste anteriores foram como
convidado). `pnpm typecheck`/`build` limpos em todo o monorepo (15
packages). Bundle real do Metro (`expo export`) sem erro nas duas
plataformas: **Android 834 módulos/2.35MB**, **iOS 835/2.34MB**.

**Fora do escopo desta entrega** (documentado no README do app): push
notifications, transferência de ingresso e pedido de reembolso pelo app
(rotas da arquitetura §13 que não existem no backend ainda), pagamento
por cartão (só Pix, mesma decisão do checkout web). **Não testado em
dispositivo real** — mesma limitação de sempre, sem emulador/celular
neste ambiente.

### Próximo passo

1. ~~Abrir checkout, painel e backoffice num navegador de verdade~~ ✅
   FEITO em 2026-07-23 (ver "Validação em navegador real" acima).
2. **Testar os dois apps RN em dispositivo real** (Expo Go, depois
   development build) — check-in e público, ambos com bundle validado
   mas nunca abertos numa tela de verdade.
3. **Split real com Pagar.me** (comercial + código): recebedores/KYC por
   organização, hold-até-aprovação de fato (hoje é só o gate de
   `Organization.status`), execução automática do repasse via API do
   gateway em vez de confirmação manual.
4. Comercial (não bloqueia código): conta PSP Pagar.me + Plano Customizado;
   autenticação do webhook no dashboard; provedor real de e-mail e BSP de
   WhatsApp (cada um vira adapter).
5. ~~Backup/restore testado + alerta de disponibilidade~~ ✅,
   ~~transferência de ingresso + pedido de reembolso~~ ✅ e
   ~~push notifications + pagamento por cartão no app público~~ ✅ FEITOS
   em 2026-07-23 (ver diário abaixo). Falta ainda no app: telas de
   transferência/reembolso (rota já existe no backend) e a chave PÚBLICA
   real do Pagar.me (`EXPO_PUBLIC_PAGARME_PUBLIC_KEY`, pendente da mesma
   conta comercial do item 3).
6. Fase 10: publicação dos dois apps nas lojas (só depois de testados em
   aparelho de verdade).

---

## Fases (arquitetura §21)

| # | Fase | Status | Commit(s) |
|---|---|---|---|
| 1 | Monorepo, autenticação, organizações, RBAC, banco e observabilidade | ✅ Concluída | `1f46fa0`, `7ea634d` |
| 2 | Eventos, tipos, lotes, estoque e publicação | ✅ Concluída | `05ff2f3` |
| 3 | Checkout web, reserva e pedidos | ✅ Concluída (backend + frontend `apps/checkout`) | `277e684` (backend), `7724d55`, `9c3e02c` (frontend) |
| 4 | Gateway, webhooks, pagamentos e emissão de ingressos | ✅ Concluída | `9f362ff`, `ab18e51` |
| 5 | Carteira web, e-mail, WhatsApp e links profundos | 🟢 Backend concluído (UI fica p/ etapa de front) | `ed79eb6` |
| 6 | App React Native de check-in online | 🟡 Código escrito, não testado em aparelho real | `578a20a` |
| 7 | Manifesto, SQLite, assinatura local e sincronização offline | 🟢 Backend concluído (manifesto/delta, sync idempotente); cliente RN em `578a20a` | `59fe647`, `578a20a` |
| 8 | Painel de vendas, pedidos, participantes e backoffice mínimo | ✅ Concluída (backend + `apps/producer` + `apps/admin`) | `7288370`, `cabfb6f` |
| 9 | Ledger, taxas, estornos e repasses | 🟢 Núcleo concluído (split real com Pagar.me fica p/ quando o KYC comercial estiver pronto) | `c3cd744` |
| 10 | Publicação do BoraFest Check-in nas lojas | ⬜ Não iniciada | — |
| 11 | Evento-piloto, testes de carga e hardening | 🟡 Teste de carga do estoque (500 concorrentes, zero overselling) + rate limit em OTP/reservas; backup/restore e alertas ainda não iniciados | (este commit) |
| 12 | App público BoraFest (carteira, descoberta, notificações) | 🟡 Código escrito, bundle validado (Android/iOS), sem teste em aparelho real; sem push/transferência/reembolso/cartão | (pendente commit) |

> Decisão de produto: **backend primeiro**. O frontend já foi prototipado e será
> encaixado por cima depois que toda a base de backend estiver estruturada.

---

## Diário de bordo

Formato: `AAAA-MM-DD — quem — o que foi feito — onde parou`.
Adicionar sempre a linha nova NO TOPO.

| Data | Quem | O que foi feito | Onde parou |
|---|---|---|---|
| 2026-08-04 | Amanda + Claude | **Escalabilidade sob pico de compradores simultâneos** (motivado por um evento real onde outra plataforma não aguentou): (1) webhook de pagamento deixou de processar dentro da requisição do gateway — `webhooks.service.ts` só valida o provedor e enfileira (`payment-webhook-processing`, concorrência 10); a verificação de assinatura + aplicação de status foi pro worker (`process-payment-webhook.ts`), mesmo padrão outbox já usado pra ingresso/notificação. (2) `Cache-Control` de 5-60s nas rotas públicas de leitura (listagem, hotsite, cidades) — a disponibilidade de estoque ficou de fora de propósito, precisa ser sempre real. (3) `connection_limit=10` no `DATABASE_URL` da api/worker (documentado o cálculo N réplicas × limite vs. `max_connections` do Postgres) + nota de como escalar réplicas da api pelo EasyPanel (stateless, sem sticky session). (4) Timeout de 8s + circuit breaker (`packages/payments/src/resilience.ts`) em toda chamada ao Pagar.me/Asaas — depois de 5 falhas seguidas o circuito abre por 30s e devolve 503 na hora em vez de empilhar chamadas penduradas. (5) **Sala de espera virtual**: `Event.waitingRoomEnabled/waitingRoomConcurrency` (migração nova), lógica pura em `packages/queues/src/waiting-room.ts` (fila FIFO + admitidos com TTL de 12min no Redis), worker `waiting-room-sweep` (a cada 2s, promove fila→admitido só nos eventos com fila pendente), gate em `POST /v1/reservations` (403 sem ticket admitido), toggle no painel do produtor (seção Publicação) e `TicketSelector` do checkout entra na fila sozinho e faz polling — o produtor decide quando ativar, não é automático. Testado: suíte completa da API 20/20 (3 testes novos de sala de espera), testes do pacote de pagamentos 17/17. Também corrigidas duas lacunas achadas no caminho: cadastro de evento ganhou upload de banner real (era só URL) e clareza da meia-entrada calculada automaticamente (50% do valor cheio, Lei 12.933/2013) no formulário do produtor. | Pendente: testar a sala de espera com tráfego real (só validado com testes de integração, não com pico de verdade); item 2 (réplicas da api) é decisão de infra/custo do Arthur, não só código. |
| 2026-07-25 | Arthur + Claude | **Handoff v2 concluído**: backend (feeMode, nominal, consent, saque, portaria) + telas novas nos 4 frontends + PWA real + perímetro + adapter Resend. Os 4 agentes paralelos de frontend caíram por limite de sessão, mas entregaram antes; recuperei o estado, corrigi 3 erros (tipo do banner, construtor no teste, rótulo de taxa com carrinho vazio) e revalidei: build 14/14, testes 27/27, fluxo v2 clicado no navegador com participantes e consentimento gravados. | Falta só o externo: Pagar.me, Resend e VPS. |
| 2026-07-24 | Arthur + Claude | **AUDITORIA v1 (2ª rodada, 8 agentes/405 verificações)** — `AUDITORIA-V1-2026-07-24.md`. Veredito: ~63% do caminho até um piloto que vende de verdade. Núcleo transacional sólido, MAS achados graves: portaria offline aprova QUALQUER leitura em verde sem rede (inclusive 401 de aparelho bloqueado), cartão com token FABRICADO no navegador (coletamos PAN/CVV sem tokenização), textos de 'ambiente de teste' visíveis ao comprador, 6 telas sem layout desktop, links localhost hardcoded no painel, CORS aberto e rate limit burlável por header, CI travado por billing do GitHub. BACKLOG estava marcando ✅ itens que o código não faz (E1/E3/A1/A2/D5). | Próximo: PR de perímetro+deploy, matar teatro de pagamento, reescrever caminho offline da portaria. |
| 2026-07-24 | Arthur + Claude | **Verificação de estado + 2 fixes de build**: auditoria do código real contra o handoff v1; `pnpm build` estava 11/14 — causa 1: `NODE_ENV=development` do `.env` vazava para o `next build` pelo `globalPassThroughEnv` do turbo (admin quebrava no prerender com runtime dev); causa 2: dev server concorrendo pelo `.next`. Corrigido (NODE_ENV fora do passthrough) → build 14/14 e testes 24/24 verdes. REGISTRO de 'Estado atual' reescrito (estava sem o Bloco E). | Handoff v1 nas 4 superfícies; bloqueios de lançamento seguem externos (PSP, e-mail, VPS). |
| 2026-07-24 | Arthur + Claude | **HANDOFF v1 (Bloco E) EXECUTADO — Site Público + estratégia PWA**: handoff novo versionado em docs/design; Site Público desktop responsivo no próprio apps/checkout (header Entrar/Produza, hero, grade de eventos, faixa Produza, footer LGPD; hotsite 2 colunas com SELEÇÃO LATERAL STICKY via TicketSelector compartilhado); PWA do comprador (manifest + service worker com fallback offline — SW só em produção após bug de cache em dev achado e corrigido no teste); **PWA de Validação em /portaria** (PIN dark com dots+teclado, portões, scanner com BarcodeDetector + busca manual, resultados full-screen, resumo com reverter, fila offline). Testado clicando: home/hotsite desktop, PIN real → check-in VÁLIDO verde → duplicado JÁ UTILIZADO âmbar com 1º uso/aparelho. | Handoff v1 completo nas 4 superfícies. Pendências de publicação seguem: conta Pagar.me, e-mail real, VPS. |
| 2026-07-24 | Arthur + Claude | **🏁 BACKLOG DO PROTÓTIPO 100% CONCLUÍDO** — fechado o último item (D5): rota POST /v1/validator/checkins/:id/reverse com ValidatorDeviceGuard (reverter check-in direto do aparelho da portaria, escopo do evento, audit com deviceName; testado E2E: VALID→reverte→audit→401 sem token). Com o commit da Amanda (C3/C7-C9/D1-D5) as 3 superfícies do handoff estão implementadas: A(6/6) B(10/10) C(9/9) D(5/5). Suite completa verde. | Software alinhado ao protótipo. Pendências para público seguem as externas: conta Pagar.me, e-mail real, VPS, app em celular físico. |
| 2026-07-24 | Arthur + Claude | **Correções do teste do Arthur em navegador próprio**: (1) BUG do 'tempo esgotado' instantâneo — contador nascia em 0 antes da reserva carregar e checkout reusado (reserva CONVERTED) caía na tela errada; agora contador nasce infinito, expirado exige reserva ATIVA com tempo real zerado, e checkout concluído REDIRECIONA para o pedido (token guardado na sessão; caso sem token → tela 'checkout já concluído'). (2) Pix ganhou o botão 'Já fiz o pagamento' do protótipo + faixa explícita 'Ambiente de TESTE: banco simulado aprova em ~20s' (a 'aprovação falsa' era o simulador local — em produção só aprova com dinheiro real). Revalidado E2E no navegador: timer 09:53 correto, aprovação → confirmação, voltar → cai no pedido. | Testes do Arthur seguem; próximo do backlog: C7/C3/C8/C9/D. |
| 2026-07-24 | Amanda + Claude | **C7 (Vendas: pedidos + detalhe + reembolso + PDV) e C8 (Financeiro: saldo/repasses/dados bancários) — Bloco C fechado (C1–C9)**. Backend novo, org-scoped (permissão `FINANCE_VIEW`/`ORDER_REFUND`/`EVENT_CREATE` via `OrgAccessService`, mesmo padrão do dashboard — não passa por `platformRole=ADMIN`): `GET /v1/events/:eventId/orders` (lista paginada, reaproveita `DashboardService.listOrders` já existente), `GET /v1/orders/:orderId/detail` (itens/lote/tipo, pagamentos, ingressos), `POST /v1/orders/:orderId/refund` (`refundOrderSchema` reaproveitado do admin — dispara `getGateway().refund`+`applyGatewayStatus` quando há pagamento real, ou debita o ledger direto quando é venda do PDV sem gateway), `POST /v1/events/:eventId/pdv-orders` (`pdvOrderSchema` novo em `@borafest/contracts`: lote+qtd+comprador — reserva+confirma estoque na mesma transação, pedido nasce `PAID`, credita `SALE_CREDIT`/`PLATFORM_FEE` no ledger com a taxa Pix e reusa o outbox `order.paid` pro worker emitir o ingresso, igual cortesia mas com valor real) e `GET /v1/organizations/:organizationId/payouts` (somente leitura — criação/marcação de pago continuam exclusivas do backoffice ADMIN, confirmado no `arquitetura-borafest.md` §4.5 "admin-web controla saldos/repasses"). Frontend: `apps/producer/app/eventos/[eventId]/vendas` (abas Pedidos/PDV, filtro por status, painel lateral de detalhe, modal de estorno total/parcial com motivo) e `apps/organizacoes/[orgId]/financeiro` restylizado (KPIs saldo/disponível, tabela de lançamentos, tabela de repasses, formulário+lista de contas bancárias) — `tsc --noEmit` limpo em `apps/api` e `apps/producer`. Achados corrigidos nesta sessão: 5 testes de integração quebrados por `OrdersService` ter ganhado um 2º parâmetro (`OrgAccessService`) no construtor — corrigido nos `__tests__`; link duplicado de "Vendas" na página do evento; faltavam anotações de tipo de retorno (`Promise<any>`) em `getOrderDetailForProducer`/`refundOrder` (erro TS2742 de tipo do Prisma não portável, mesmo padrão já usado em `admin.service.ts`). | Bloco C completo (C1–C9). Falta: Bloco D (restyle do app de validação, D1–D5) e revisão de C3 (tabela de "Meus eventos" ainda não restylizada). |
| 2026-07-24 | Arthur + Claude | **C5 — Dashboard Geral restylizado**: 4 KPIs com tiles coloridos (valor vendido, emitidos, aprovadas com delta verde, pedidos), vendas por lote com barras de progresso, **Check-in ao vivo** (dot pulsante, X/Y presentes, barra, +N/min — polling 10s no checkin-live) com estado vazio, e quebras por status. Validado no navegador com dados reais da sessão (R$604,80; 1/11 presentes). | Restam: C7 (vendas/PDV), C8/C9 e Bloco D. |
| 2026-07-24 | Arthur + Claude | **C4 — Wizard de criação de evento em 3 etapas** (Dados → Ingressos → Publicar): stepper visual, dados+banner, ingressos com preço final calculado em verde, revisão com hotsite e aviso 'venda começa imediatamente', Publicar/Salvar rascunho — tudo em cima das APIs já testadas; botão 'Criar novo evento' da organização leva ao wizard. Renderização validada no navegador. | Restam do protótipo: C5 (KPIs/gráfico dashboard), C7 (vendas/PDV), C8/C9 (financeiro restyle, divulgue) e Bloco D (telas do app validação). Backlog atualizado. |
| 2026-07-24 | Arthur + Claude | **C2 — Onboarding do organizador**: banner-diferencial 'vendas NÃO ficam bloqueadas' + chip de verificação pendente, card PF/PJ (toggle troca labels Nome/CPF↔Razão social/CNPJ) e card de dados bancários (banco/agência/conta/tipo/Pix). Backend novo: POST/GET /v1/organizations/:id/bank-accounts (nova conta vira padrão de repasse) — testado E2E (register→org→conta bancária→listagem). Cadastro agora desemboca no /onboarding. | Restam: C4 wizard, C5 dashboard restyle, C7 vendas/PDV, C8/C9, e Bloco D (app validação). Tudo mapeado no BACKLOG-PROTOTIPO.md. |
| 2026-07-24 | Arthur + Claude | **C6 + edição/publicação do evento no painel** (fecha 4 lacunas da auditoria): seção Publicação (link público copiável, Pausar/Reabrir vendas, banner por URL via PATCH), seção Cupons (criar %/fixo com limite, listar usos, desativar) e Cortesias (emitir por lote com nome/e-mail, lista com status). Testado logado no navegador com dados reais (BF20/ATLETICA10 com contagem de uso; cortesia FULFILLED). Conta demo do produtor ganhou senha (demo-senha-8). | Bloco C parcial: faltam C2 (onboarding PF/PJ), C4 (wizard 3 etapas), C5 (dashboard KPI restyle), C7 (vendas/PDV), C8/C9. Bloco D (app validação restyle) não iniciado. |
| 2026-07-24 | Arthur + Claude | **C1 + rotas de evento**: auth split-screen do painel (login por senha, cadastro com aceite LGPD, recuperar com link 30min, redefinir) com tokens/fonte do protótipo — login por senha TESTADO no navegador. Backend: POST /v1/events/:id/unpublish (PUBLISHED→SALES_PAUSED, página pública some) e /republish — testados via curl (404 público durante pausa). | Seguindo Bloco C: cupons/cortesias UI e edição do evento (lacunas da auditoria). |
| 2026-07-24 | Arthur + Claude | **B10 + BLOCO B COMPLETO**: perfil (login OTP inline, toggles de consentimento, Baixar meus dados, Excluir conta com bottom-sheet LGPD/Apple), Minhas compras (pedidos logado/convidado, reenvio, Solicitar reembolso CDC art.49), Privacidade & Termos (abas com LGPD/CDC/meia-entrada/DPO) e Sem conexão. Backend novo: módulo /v1/me (perfil, orders, data-export, DELETE anonimizado) — testado E2E via curl (export com todas as chaves; conta anonimizada no banco). App do Comprador 100% alinhado ao protótipo. | Próximo: Bloco C (painel do produtor). |
| 2026-07-24 | Arthur + Claude | **BLOCO B (B1–B9) — App do Comprador reconstruído com o protótipo hi-fi** e testado CLICANDO no navegador: tokens/Plus Jakarta Sans/moldura mobile; Início (busca, chips, destaque gradiente); página do evento (hero, glass, CTA sticky, estado encerrado); seleção (stepper, meia-entrada a R$40+taxa cheia, Poucos/Esgotado, resumo sticky); checkout 3 etapas com timer regressivo real, convidado×OTP, LGPD, cupom com preview (BF20 −20% → total R$76,80), Pix com QR + copiar + polling que AVANÇA SOZINHO no webhook, cartão com parcelas e recusa simulada, carteira em-breve; confirmação animada; carteira com recorte de ticket, QR Ed25519, WhatsApp e transferência. 1 bug real achado no teste (listagem paginada de eventos) e corrigido. | Falta B10 (perfil/compras/legal/offline) e blocos C (painel) e D (validação). |
| 2026-07-24 | Arthur + Claude | **BLOCO A COMPLETO (backend do protótipo)**: A3 auth por senha do produtor (register/login/recover/reset, scrypt, sem enumeração, testado 8/8), A4 cupons (PERCENT/FIXED, resgate atômico, preview público, testado), A5 cortesias (pedido R$0 PAID reusando emissão+entrega, estoque consumido, auditado, testado), A6 meia-entrada (preço/2 taxa cheia, testado). Regressão da API verde em todos. | Iniciando Bloco B: rebuild do App do Comprador (apps/checkout) com os tokens do protótipo. |
| 2026-07-24 | Arthur + Claude | **Protótipo hi-fi recebido e versionado** (`docs/design/`, 3 superfícies/34 telas + tokens) — backlog de implementação em `BACKLOG-PROTOTIPO.md`. **A1 ✅**: OTP agora é ENVIADO de verdade (template `otp_code` na fila de notificações; testado: notification SENT com código). **A2 ✅**: bug do estorno parcial corrigido (parcial debita só o valor, pedido PARTIALLY_REFUNDED, ingressos intactos; total posterior completa a reversão a líquido zero — testado E2E; 1 falha achada no reteste e corrigida: PARTIALLY_REFUNDED faltava na guarda do applyReversal). Regressão 8/8 verde. | Próximo: A3 (auth por senha do produtor) e Bloco B (App do Comprador). |
| 2026-07-24 | Arthur + Claude | **AUDITORIA código real vs arquitetura** (10 agentes, evidência por arquivo:linha) — resultado completo em `AUDITORIA-2026-07.md`. Núcleo transacional sólido (~80% da superfície MVP), MAS: OTP nunca é enviado de verdade (login quebra em produção), e-mail/WhatsApp são stubs, sem UI de cartão, sem consentimento LGPD, sem recuperação de ingresso, painel sem editar/despublicar/banner/link, BUG real de estorno parcial tratado como total, segurança/observabilidade fracas (sem MFA/Sentry, CORS aberto, restore nunca testado). | Top 10 do piloto listado na auditoria — atacar na ordem. |
| 2026-07-23 | Amanda + Claude | **Push notifications + pagamento por cartão no app público**: `PushToken` (model novo, escopo é o PEDIDO não o usuário — compra nunca exige conta) + `POST /v1/orders/:publicToken/push-token` (upsert por token). Canal `PUSH` novo em `Notification`, entregue via `ExpoPushSender` (`packages/notifications`) — DEFAULT de push é o Expo real (grátis, sem conta), não `devlog` como e-mail/WhatsApp; testado ao vivo contra a API real do Expo (token fake → erro `DeviceNotRegistered` genuíno, prova que fala com o servidor deles). `apps/worker/issue-tickets.ts` e o resend enfileiram PUSH junto com EMAIL/WHATSAPP quando há token registrado. App (`expo-notifications`+`expo-device`): pede permissão e registra o token assim que cria o pedido, best-effort (não trava a compra se recusar/não suportar). Cartão: `apps/mobile-public/src/payments/tokenizeCard.ts` tokeniza SEM passar o PAN pelo backend, chamando direto o endpoint público de tokenização do Pagar.me (REST, sem SDK) — sem `EXPO_PUBLIC_PAGARME_PUBLIC_KEY` (gateway real pendente de conta comercial), usa token mock reconhecido só pelo `MockGateway`. Tela nova de escolha Pix/cartão + formulário de cartão no `CheckoutScreen`; backend (`POST /v1/orders/:orderId/payments/card`) já existia, só faltava cliente. **Testado ao vivo** contra a API real: push token registrado com sucesso, cartão aprovado vira `PAID` na hora e cartão de teste `_fail` vira `FAILED` com motivo. Bundle Android/iOS revalidado via `expo export` (972/971 módulos, ambos limpos) e typecheck OK. | Push e cartão prontos e testados via API real; falta teste em aparelho físico (push em particular só se confirma de ponta a ponta num device de verdade) e a chave pública real do Pagar.me. Próximo: telas de transferência/reembolso no app, dispositivo real, split real com Pagar.me, Fase 10. |
| 2026-07-23 | Amanda + Claude | **Transferência de ingresso + pedido de reembolso (§13) e hardening (backup/restore + alerta, §15)**: `POST /v1/tickets/:id/transfer` (self-service, sem conta — prova posse via `orderPublicToken` no corpo; atualiza titular e reassina o QR com nonce novo, invalidando o QR antigo; audita em `AuditLog`). Novo model `RefundRequest` (migration `refund_requests`) + `POST /v1/orders/:publicToken/refund-requests` (cria PENDING, bloqueia duplicata, exige pedido PAID/FULFILLED) + admin `GET/POST /v1/admin/refund-requests` (listar, aprovar — reusa `AdminService.refundOrder`, mesmo gateway — e rejeitar com justificativa). 7 testes de integração novos (`tsx --test`), todos passando junto com os já existentes. Hardening: `infra/scripts/backup.sh` (pg_dump+gzip com retenção) e `restore.sh` (dropdb/createdb + restore, com confirmação) — **restore drill testado de verdade** contra o Postgres de dev (dump → drop/create → restore, contagem de linhas de `events`/`orders` idêntica antes/depois); `infra/scripts/healthcheck-alert.sh` (polling de `/health`, alerta só na mudança de estado, webhook estilo Slack/Discord) — **testado ao vivo** subindo a API, derrubando (porta trocada) e religando, confirmado que só alerta nas transições e fica em silêncio quando o estado não muda. `docs/projeto/DEPLOY.md` e `API-REFERENCE.md` atualizados com os crons sugeridos e as novas rotas. | Transferência/reembolso e hardening de backup/alerta prontos e testados. Falta: push notifications e pagamento por cartão no app público (Fase 12), teste em aparelho real dos 2 apps RN, split real com Pagar.me, Fase 10 (lojas). |
| 2026-07-23 | Amanda + Claude | **Fase 12 (app público do comprador)**: novo `apps/mobile-public` (Expo/RN), reaproveitando o fix de bundling pnpm+Metro do `mobile-checkin` (metro.config.js + index.js como entry point próprio) — bundlou limpo nas 2 plataformas de primeira (Android 834 módulos/2.35MB, iOS 835/2.34MB). Telas: descoberta de eventos (home), evento + reserva, checkout (Pix + QR + polling), carteira (ingressos + reenvio), "meus ingressos" opcional via login OTP (`expo-secure-store`) — compra nunca exige conta. Gap real encontrado construindo a home: não existia endpoint de listagem de eventos públicos, só busca por slug — criado `GET /v1/public/events` (`CatalogService.listPublicEvents` + `PublicCatalogController`), testado ao vivo sem colisão de rota com `:slug`. Fora do escopo (documentado no README do app): push notifications, transferência de ingresso e pedido de reembolso (rotas não existem no backend ainda), pagamento por cartão (só Pix), teste em aparelho real (sem emulador/celular neste ambiente). | Fase 12: código escrito e validado via `expo export`, não testado em aparelho real. Próximo: testar as 2 apps RN (check-in + público) em dispositivo de verdade; split real com Pagar.me; itens comerciais; Fase 10 (lojas) e resto do hardening da Fase 11. |
| 2026-07-23 | Amanda + Claude | **Fase 11 (rate limit)**: `RateLimitGuard` global (Redis `INCR`+`EXPIRE`, fallback 120/min/IP) com `@RateLimit` em `otp/request` (5/15min por destino), `otp/verify` (10/15min por IP) e `POST /v1/reservations` (20/min por IP) — item do §15 que não existia. Testado ao vivo: 429 na 6ª tentativa de OTP pro mesmo destino, destino diferente não afetado, 429 na 21ª reserva do mesmo IP. Ajustei o `load-test-reservations.ts` pra mandar `x-forwarded-for` diferente por tentativa (senão o próprio rate limit atrapalhava o teste de estoque) — ficou mais realista de quebra (simula compradores distintos). | Rate limit no ar em OTP e checkout. Próximo: resto do hardening (backup/restore, alertas) ou Fase 12 (app público). |
| 2026-07-23 | Amanda + Claude | **Fase 11 (teste de carga)**: `apps/api/scripts/load-test-reservations.ts` (`pnpm --filter @borafest/api load-test`) dispara N reservas HTTP concorrentes de verdade contra um lote recém-criado — o teste bloqueante da arquitetura §22, agora repetível a qualquer momento em vez de manual. Rodado em 2 escalas contra a API real: 100 tentativas/capacidade 5 (133 req/s) e 500 tentativas/capacidade 20 (139 req/s, escala de evento-piloto) — zero overselling e zero erro de rede nas duas. | Teste de carga do estoque pronto. Falta o resto do checklist de hardening (backup/restore, rate limit, alertas) antes de fechar a Fase 11 de vez. Próximo: Fase 12 (app público) ou completar o hardening. |
| 2026-07-23 | Amanda + Claude | **Testes automatizados de regressão** (`apps/api/src/__tests__`, Node test runner via `tsx --test`): concorrência de estoque (10 tentativas vs. capacidade 3 → exatamente 3), fluxo pedido→pagamento→ledger com webhook duplicado (no-op, sem duplicar lançamento) e corrida de check-in (8 aparelhos, 1 `VALID`). 2 bugs achados NOS TESTES (não no app): conexão Redis/BullMQ pendurada travando o test runner (resolvido com `closeRedisConnection()` novo em `packages/queues`) e um fixture de teste gerando código de ingresso em minúsculo que nunca batia com a busca `toUpperCase()` do `CheckinsService` (corrigido usando o gerador de código de verdade). `pnpm --filter @borafest/api test` roda os 3, todos passando, dados de teste limpos automaticamente. | Primeira leva de testes de regressão pronta. Próximo: Fase 11 (evento-piloto/hardening) ou Fase 12 (app público) — as frentes que dão pra avançar sem device físico nem decisão comercial. |
| 2026-07-23 | Arthur + Claude | **Pré-lançamento (construção sem dependências)**: verificação Ed25519 real no app de check-in (@noble/curves, compatibilidade cruzada com o servidor provada e no CI); infra de produção completa (Dockerfiles api/worker/web standalone, compose com migrate one-shot + Caddy HTTPS, .env.production.example, DEPLOY.md); CI GitHub Actions; rascunho do PLANO-DE-TESTES.md com o §22 mapeado por status e donos. | Falta revisar o plano de testes junto, testar app no celular, subir homolog num VPS e conta Pagar.me p/ split real. |
| 2026-07-23 | Arthur + Claude | **Validação em navegador real dos 3 frontends**: compra completa clicada no checkout (Pix mock → carteira avançando sozinha), painel do produtor via OTP (dashboard, participantes, portaria, financeiro com a taxa 4,99% ao vivo) e backoffice ADMIN (pedidos, filas, auditoria). Bug real corrigido nos 3 `lib/api.ts`: Content-Type em POST sem corpo causava 400 do Fastify em toda ação sem payload (reenvio/estorno/bloqueio/marcar-pago). | Frontends web aprovados. Falta: app RN em aparelho físico (Expo Go) e split real Pagar.me. |
| 2026-07-23 | Amanda + Claude | **Validação extra do app de check-in** sem aparelho físico: `expo-doctor` (16/17 ok) e, principalmente, `expo export --platform android/ios` rodando o bundler Metro de verdade — achou 3 erros reais em cascata por falta de `metro.config.js` configurado pra pnpm (resolução de symlink, `@babel/runtime` não hoisted, e o próprio `AppEntry.js` do pacote `expo` fazendo um import relativo que quebra sob symlink). Corrigido com `metro.config.js` + `@babel/runtime` como dependência direta + `index.js` próprio como entry point (mais robusto que depender do `AppEntry.js` do pacote). Bundle final: Android 583 módulos/1.62MB, iOS 584/1.61MB, ambos sem erro — prova bem mais forte que typecheck de que o app resolve de ponta a ponta. | Bundle valida limpo nas duas plataformas. Ainda falta abrir de verdade num aparelho/Expo Go pra validar UI, câmera e fluxo offline na prática. |
| 2026-07-23 | Amanda + Claude | **Backoffice web** (`apps/admin`, Next.js/TS/Tailwind, mesmo padrão de OTP+localStorage do painel, mas o `AuthGuard` também barra quem não tem `platformRole`): organizações (taxa, bloqueio, repasse), eventos (bloqueio), pedidos (busca/reenvio/estorno), payouts (marcar pago), webhooks, filas (job counts das 5 filas + outbox) e auditoria. Todos os contratos bateram exatamente com as interfaces TS do frontend sem precisar de ajuste no backend desta vez. `next build`/`tsc` limpos, validado via curl com o mesmo token/contratos do frontend. **Não aberto num navegador de verdade** (mesma ressalva de sempre). Com isso as 3 frentes de frontend web que só dependiam da API existente (checkout, painel do produtor, backoffice) estão prontas. | Backoffice web pronto. Próximo: alguém abrir os 3 frontends num navegador de verdade, testar o app RN em aparelho, ou avançar pro split real com Pagar.me. |
| 2026-07-23 | Amanda + Claude | **Painel do produtor** (`apps/producer`, Next.js/TS/Tailwind, login por OTP com token em localStorage): organizações, eventos (criar/publicar), catálogo (tipo+lote com ativação), dashboard, participantes+export CSV (via fetch+blob por causa do header Authorization), financeiro (saldo/ledger) e portaria (portões, PIN de validador, dispositivos). Achadas e corrigidas 2 lacunas reais no backend testando de verdade: faltava `GET /v1/organizations` (listar orgs do usuário) e o dashboard não expunha `ticketTypeId` por lote (impossível criar lote sem digitar UUID à mão). `next build`/`tsc` limpos, fluxo validado via curl com os mesmos contratos do frontend. **Não aberto num navegador de verdade** (mesma ressalva do checkout). | Painel do produtor pronto. Próximo: backoffice web (`apps/admin`), depois testar tudo (checkout+painel+app RN) numa sessão com navegador/aparelho de verdade. |
| 2026-07-23 | Amanda + Claude | **Checkout web** (`apps/checkout`, Next.js/TS/Tailwind): página do evento, checkout com Pix (QR via `react-qr-code`) e carteira com os ingressos, tudo consumindo a API que já existia. Achado um bug real testando contra a API de verdade (não só typecheck): `GET /v1/orders/:publicToken/tickets` devolve um objeto `{event, tickets}`, não um array — o cliente HTTP assumia array errado, corrigido antes de commitar. `next build`/`tsc` limpos; fluxo validado via curl simulando as chamadas do frontend (reserva → pedido → Pix mock → webhook → `FULFILLED`), mas **não aberto num navegador de verdade** (sem ferramenta de browser neste ambiente). | Checkout web pronto, falta alguém abrir no navegador uma vez. Próximo: painel do produtor/backoffice web (mesma ideia, consumir API existente) ou testar o app de check-in em aparelho. |
| 2026-07-23 | Amanda + Claude | **Fase 6 (app RN de check-in)** + **doc de referência da API**: `apps/mobile-checkin` (Expo/RN/TS) com login por PIN, manifesto em SQLite local, scanner de QR com fallback offline (fila + sync em lote), busca manual por código e contador local. Mapeamos os contratos exatos de validator/checkins antes de codar e achamos duas pegadinhas: `checkin-live`/`reverse` exigem sessão de usuário (não token de aparelho — o app não pode chamá-las), e `syncCheckinsSchema` só aceita `ticketId` (não `qrToken`), então o parser local do QR (sem verificar assinatura Ed25519 — isso ficou documentado como limitação assumida) é obrigatório para o caminho offline. `pnpm typecheck` limpo em tudo, mas **não testado em aparelho real** (sem emulador/celular neste ambiente). Criado também `docs/projeto/API-REFERENCE.md` com todas as rotas da API por módulo — lacuna que não existia antes. | Fase 6 com código pronto, falta testar em Expo Go antes de qualquer publicação em loja (Fase 10). |
| 2026-07-23 | Amanda + Claude | **Fase 9 (núcleo)**: ledger append-only (`ledger_accounts`/`ledger_entries`) e `payouts`, cálculo de comissão configurável por organização (`computePlatformFeeCents`), tudo pendurado direto no `applyGatewayStatus` (PAID credita venda+comissão e confirma estoque; estorno/chargeback reverte o ledger a zero E devolve o estoque vendido — fechando a lacuna aberta desde a Fase 4). API de saldo/ledger para o produtor e backoffice de repasse (bloqueado sem KYC aprovado, confirmação manual da transferência até o split real do Pagar.me). Testado de ponta a ponta: venda → saldo líquido correto → payout bloqueado sem KYC → aprovado → payout pago → saldo zera → estorno pós-payout devolve estoque e deixa saldo negativo (repasse futuro descontado), disponível-para-repasse travado em zero. | Fase 9 (núcleo) concluída. Split real com Pagar.me (recebedores/KYC) fica para quando o comercial fechar a conta PSP. |
| 2026-07-23 | Amanda + Claude | **Fase 8**: dashboard do produtor (receita, pedidos, participantes, export CSV) e backoffice mínimo (organizações, taxa configurável por org, eventos, busca de pedidos, reenvio, estorno controlado via gateway, webhooks, saúde das filas), com `PlatformRole` (SUPPORT/ADMIN) novo no schema e auditoria em toda ação sensível. Testado de ponta a ponta com um pedido real pago via mock gateway até `FULFILLED` e depois estornado pelo backoffice. | Fase 8 concluída. Próximo: Fase 9 (ledger, taxas, estornos com devolução de estoque e repasses). |
| 2026-07-23 | Arthur + Claude | **Fases 6/7 (backend do check-in)**: portões e PIN pelo produtor, sessão do validador por PIN + registro/refresh/bloqueio de dispositivo, manifesto completo/delta com chave pública Ed25519, check-in atômico "primeiro vence" com verificação criptográfica do QR, sync offline idempotente por lote com trilha de conflito, reversão auditada e painel ao vivo. 8 cenários E2E passando. | Backend do check-in pronto. Próximo: Fase 8 (dashboard produtor + backoffice mínimo). |
| 2026-07-23 | Arthur + Claude | **Fase 5 (backend)**: package notifications (e-mail/WhatsApp por adapter + templates pt-BR), fila persistente `notifications` com retry, entrega disparada na mesma transação do FULFILLED, link profundo da carteira, endpoint de reenvio com limite. Testado de ponta a ponta (SENT nos 2 canais, link ok, limite ok). | Backend da F5 pronto. Próximo: backend do check-in (Fases 6/7 — sessões de validador, manifesto, checkins/sync). |
| 2026-07-23 | Arthur | **Decisões**: taxa BoraFest confirmada (Pix 4,99% piso R$2,49 / cartão 6,99%, parcelamento no comprador) e **Pagar.me confirmado como gateway primário** (fácil de trocar via adapter/env). MP descartado (sem custódia própria) e Celcoin (não é mais barato em ticket baixo + escrow manual). | — |
| 2026-07-23 | Arthur + Claude | **Fase 4 (fechamento)**: `PagarmeGateway` real com fatos verificados na doc oficial v5 (webhook v5 sem HMAC → Basic; header `Idempotency-key`; customer completo p/ Pix) + 13 testes unitários. | Fase 4 concluída. |
| 2026-07-23 | Arthur + Claude | **Fase 4 (núcleo)**: pagamentos Pix/cartão atrás da interface `PaymentGateway` (mock por ora), webhooks idempotentes com payload bruto e assinatura, outbox → emissão exatamente-uma-vez com QR Ed25519, estorno automático de pagamento órfão, expiração de pedidos, reconciliação. Testes §22 executados (concorrência, duplicado, atrasado, adulteração) — 1 bug real achado e corrigido (PAID pós-expiração não estornava). Pesquisa de 13 gateways concluída e salva em `pesquisa-gateways-2026-07.md`. | Falta: Arthur confirmar Pagar.me+Asaas e taxa; escrever adapter real; depois Fase 5. |
| 2026-07-23 | Arthur + Claude | Criada estrutura de docs (`docs/projeto` com memória/registro, `docs/arquitetura`), scripts de conveniência na raiz, README corrigido. Pesquisa de gateways disparada. | Aguardando definição do gateway para iniciar o código da Fase 4. |
| 2026-07-23 | Amanda + Claude | Fase 3: reservas com TTL, checkout mínimo e worker de expiração (`277e684`). | Fase 3 concluída. |
| 2026-07-23 | Amanda + Claude | Fase 2: eventos, catálogo e estoque atômico (`05ff2f3`). | Fase 2 concluída. |
| 2026-07-23 | Amanda + Claude | Fase 1: fundação do monorepo (auth, organizações/RBAC, banco) + fix de build/portas (`1f46fa0`, `7ea634d`). | Fase 1 concluída. |
