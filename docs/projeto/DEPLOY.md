# DEPLOY — BoraFest em produção

> Revisado em 2026-10-12. Este arquivo descrevia um compose próprio com Caddy,
> que nunca foi o que roda em produção. Agora descreve o deploy de verdade:
> **EasyPanel** na VPS do Arthur, no ar desde 30/07/2026. O compose com Caddy
> (`infra/docker/docker-compose.prod.yml`) segue no repositório como caminho
> alternativo, resumido no fim (§8).

## 1. Como a produção está montada

- VPS do Arthur (Europa) com **EasyPanel**. Um serviço do tipo **Compose** usa o
  `docker-compose.yml` da **raiz** do repositório e os Dockerfiles de
  `infra/docker/easypanel/`, buildados a partir do **`origin/main`** no GitHub.
  Commit que não foi enviado (`git push`) não sobe: em 13/08 vários
  "redeploys" buildaram código velho por isso.
- O **Traefik do EasyPanel** faz o HTTPS. O compose não tem Caddy nem portas
  80/443. Os domínios ficam na aba *Domains* do serviço:

| Domínio | Serviço do compose | Porta |
|---|---|---|
| `api.borafest.com.br` | `api` | 3333 |
| `borafest.com.br` (site e portaria em `/portaria`) | `site` | 3000 |
| `painel.borafest.com.br` | `painel` | 3000 |
| `admin.borafest.com.br` | `admin` | 3000 |
| `metrics.borafest.com.br` (opcional, Grafana) | `grafana` | 3000 |

| Serviço | Imagem / Dockerfile | O que faz |
|---|---|---|
| `postgres` | `postgres:16-alpine`, volume `borafest_pg` | o banco |
| `redis` | `redis:7-alpine` com AOF, volume `borafest_redis` | filas (BullMQ), limite de requisições, sala de espera |
| `pg-backup` | `postgres:16-alpine` + `infra/scripts/pg-backup.sh` | dump diário, 14 dias no volume `borafest_pg_backups` (§6) |
| `api` | `infra/docker/easypanel/Dockerfile.api` | NestJS. No boot: `prisma migrate deploy` → seed (papéis e `PLATFORM_ADMIN_EMAILS`) → `banco-intacto` (só escreve no log) → API. Banners no volume `borafest_uploads` |
| `worker` | `infra/docker/easypanel/Dockerfile.worker` | outbox (emissão de ingresso, e-mails, push), webhooks de pagamento, reconciliação, expiração de reservas e pedidos, carrinho abandonado, sala de espera, repasse automático e Meta CAPI |
| `site` | `infra/docker/easypanel/Dockerfile.checkout` | site do comprador e portaria (Next.js standalone) |
| `painel` | `infra/docker/easypanel/Dockerfile.producer` | painel do produtor |
| `admin` | `infra/docker/easypanel/Dockerfile.admin` | backoffice |
| `prometheus`, `grafana` | imagens oficiais | métricas; o Prometheus fica só na rede interna |

**Volume não se apaga.** O banco mora em `borafest_pg` e os banners e flyers em
`borafest_uploads`. Tela vazia não prova dado perdido: no incidente de 30/08 a
API estava em crash-loop e o banco estava inteiro (§5).

## 2. Antes de implantar

1. O código está no `origin/main` (`git push`) e você anotou o commit.
2. Testes: o CI do GitHub está parado (cobrança da conta). Rode a suíte local
   antes: `pnpm --filter @borafest/api test` e `pnpm --filter @borafest/worker test`
   (com Postgres e Redis de dev) e os testes de `@borafest/payments`,
   `@borafest/tickets` e `@borafest/notifications`.
3. Tem migração nova? Leia o SQL: só pode ter `ADD`/`CREATE`. Faça um backup na
   hora (console do serviço `pg-backup`:
   `bash /opt/borafest/scripts/pg-backup.sh --uma-vez`) e rode o `banco-intacto`
   no console da API **que está no ar**, antes de implantar:
   `cd packages/database && npx tsx src/banco-intacto.ts`.
4. Tem variável nova? Ela precisa estar em **dois lugares**: no Environment do
   serviço Compose **e** no bloco `environment:` do serviço certo no
   `docker-compose.yml`. O compose só repassa ao contêiner o que lista; sem a
   linha no compose, a variável não chega, por mais que esteja no painel.
5. No compose, nunca `${VAR:?...}`: uma variável faltando derruba o deploy
   inteiro (incidente de 10/08). Padrão perigoso também derruba:
   `${WHATSAPP_PROVIDER:-devlog}` deixou API e worker em crash-loop por 8 h
   (30/08), porque a API recusa `devlog` em produção.

## 3. Implantar: ordem e por quê

O deploy é **manual**: botão *Implantar* do serviço Compose no EasyPanel, que
reconstrói as imagens e recria os contêineres. Confira os serviços nesta ordem
(e, se for subir um por vez, siga a mesma ordem):

1. **API primeiro.** Ela migra o banco no boot. No log: `migrate deploy` sem
   erro, a contagem do `banco-intacto` sem alerta e nenhuma linha
   `Configuração insegura para produção` ou `Configuração de pagamento
   incompleta` (com elas a API se recusa a subir, ver §4). Depois:
   `curl -s https://api.borafest.com.br/health`.
2. **Worker logo em seguida.** Ele precisa estar na mesma versão da API: e-mail
   novo, evento novo do outbox e mudança no livro-caixa saem da API nova e são
   processados pelo worker. Se o worker antigo pegou um e-mail novo e falhou,
   reenvie (backoffice → E-mails, a partir da rodada de 12/10).
3. **Site, com rebuild da imagem (reiniciar não basta).** As `NEXT_PUBLIC_*`
   (endereço da API, do painel, do próprio site, número do WhatsApp) são
   embutidas no **build**, com o padrão de produção nos `ARG` de
   `infra/docker/easypanel/Dockerfile.checkout`. O compose não passa build
   args: para mudar uma delas, edite o `ARG` no Dockerfile, envie e reconstrua.
   Reiniciar o contêiner mantém o bundle velho.
4. **Painel**, com rebuild (`Dockerfile.producer`, mesma regra).
5. **Admin**, com rebuild (`Dockerfile.admin`, mesma regra).

`pg-backup`, `prometheus` e `grafana` só precisam ser recriados quando o compose
ou os scripts deles mudam.

## 4. Variáveis por serviço

A lista completa, com comentários e sem valores, está em
`.env.production.example`. Tudo vai no Environment do serviço Compose; o compose
monta `DATABASE_URL` e `REDIS_URL` sozinho. Com `NODE_ENV=production` (fixo no
compose), API e worker **se recusam a subir** com configuração perigosa:
melhor parar no boot do que vender sem confirmar o pagamento.

| Serviço | Obrigatórias | Recomendadas |
|---|---|---|
| `postgres`, `pg-backup`, `api`, `worker` | `POSTGRES_PASSWORD` | — |
| `redis`, `api`, `worker` | `REDIS_PASSWORD` | — |
| `api` | `SESSION_JWT_SECRET`; `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM`; provedor de pagamento real (nunca `mock`, nem nas rotas por meio) e as chaves de **cada** provedor usado no padrão, no Pix e no cartão (`ASAAS_API_KEY` + `ASAAS_WEBHOOK_TOKEN`; `MERCADOPAGO_ACCESS_TOKEN` + `MERCADOPAGO_WEBHOOK_SECRET`); `WHATSAPP_PROVIDER` diferente de `devlog` (padrão do compose: `off`); `TOTP_ENCRYPTION_KEY` (a partir da rodada de 12/10: sem ela nenhum admin ativa o segundo fator, e aprovar saque, marcar repasse pago e estornar ficam bloqueados) | `TICKET_KEY_ENCRYPTION_KEY`, `RESEND_WEBHOOK_SECRET`, `METRICS_TOKEN`, `PLATFORM_ADMIN_EMAILS`, `VAPID_*`, `PAYMENT_MIN_CHARGE_CENTS`, `PLATFORM_*` (taxa). `CORS_ORIGINS`, `WEB_BASE_URL`, `PRODUCER_BASE_URL` e `API_PUBLIC_URL` já têm padrão de produção no compose |
| `worker` | `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM` (o worker também recusa `devlog`); as mesmas chaves de pagamento da API (ele processa webhook, reconcilia e estorna; não confere as chaves no boot, então a falta só aparece no log) | `TICKET_KEY_ENCRYPTION_KEY` (**a mesma** da API), `METRICS_TOKEN`, `VAPID_*`, `AUTO_TRANSFER_ENABLED` (padrão `false`), `WEBHOOK_RAW_RETENTION_DAYS` (LGPD: dias que o corpo cru dos webhooks de pagamento fica guardado; padrão 90) |
| `pg-backup` | — | `BACKUP_ENCRYPTION_PASSPHRASE`, `BACKUP_S3_*`, `BACKUP_ALERT_WEBHOOK_URL` (`infra/scripts/README.md`) |
| `grafana` | `GRAFANA_ADMIN_PASSWORD`, antes de apontar um domínio | `GRAFANA_ROOT_URL` |
| `site`, `painel`, `admin` | nenhuma do Environment: só as `NEXT_PUBLIC_*` do build (§3) | — |

Para ver o que a API está usando de fato (provedor do Pix e do cartão, mínimo
da cobrança, taxa, repasse, chaves presentes ou ausentes, sem mostrar valores):
backoffice → **Configuração** (a partir da rodada de 12/10). Uma variável do
EasyPanel passa por cima do padrão do código; foi assim que a taxa do Pix saiu
R$ 2,50 em 14/08.

## 5. Banco intacto (regra inegociável desde 30/08)

- Toda sessão que toca produção (deploy, migração, variável, infra) termina
  rodando a checagem e colando o resultado no diário: console do contêiner
  `api` no EasyPanel → `cd packages/database && npx tsx src/banco-intacto.ts`.
  Ela conta as tabelas principais e grita se alguma estiver zerada.
- Ela também roda sozinha em todo boot da API, **depois** da migração, e só
  escreve no log (não bloqueia o boot, senão uma instalação nova entraria em
  crash-loop). Por isso o passo 3 do §2 manda rodar antes de implantar.
- "Sumiu tudo" começa separando API morta de dado perdido: primeiro `/health`,
  depois a checagem. Nunca rode nada destrutivo (drop, reset, apagar volume)
  sem a checagem provando o estado real do banco.

## 6. Backup, restauração e alerta

Tudo que roda, o que configurar e os comandos de ensaio e de restauração estão
em **`infra/scripts/README.md`** (revisão de 12/10). Em resumo:

- O serviço `pg-backup` faz um dump por dia e guarda 14 dias no volume
  `borafest_pg_backups`, **no mesmo servidor**. A rodada de 12/10 inclui os
  banners (volume de uploads), criptografia (`BACKUP_ENCRYPTION_PASSPHRASE`),
  cópia para fora do servidor (`BACKUP_S3_*`) e aviso de falha
  (`BACKUP_ALERT_WEBHOOK_URL`). Sem essas variáveis, o backup continua só local
  e sem criptografia. O dump contém CPF, e-mail e, sem
  `TICKET_KEY_ENCRYPTION_KEY`, a chave que assina os QR.
- Guarde **fora do servidor** a senha do backup e a `TICKET_KEY_ENCRYPTION_KEY`:
  sem elas, um backup restaurado não abre ou não assina QR.
- Ensaio de restauração (1 vez por mês), no console do `pg-backup`:
  `bash /opt/borafest/scripts/restore-drill.sh`. Restaura num banco temporário
  e compara as contagens; o banco real só é lido.
- Aviso de sistema fora do ar: monitor externo grátis (UptimeRobot ou
  BetterStack) em `https://api.borafest.com.br/health`. A partir da rodada de
  12/10 a rota responde 503 com o motivo quando o banco, o Redis ou o worker
  falham. `infra/scripts/healthcheck-alert.sh` é a alternativa por cron, mas
  nada mostra que esse cron foi instalado no servidor.
- Métricas: o `/metrics` da API e do worker exige `METRICS_TOKEN` (sem ele
  responde 404) e o Prometheus precisa mandar o mesmo token
  (`infra/docker/prometheus/prometheus.prod.yml`). Grafana em
  `metrics.borafest.com.br`, com o painel "BoraFest — Visão Geral".
- `infra/scripts/backup.sh` e `restore.sh` são do caminho alternativo (§8) e
  não são usados no EasyPanel.

## 7. Depois do deploy

Confira e anote no diário (com o commit implantado):

1. `curl -s https://api.borafest.com.br/health` responde `"status":"ok"`.
2. Log de boot da API: migrações aplicadas, `banco-intacto` sem alerta, sem
   aviso de pagamento (`[boot] pagamento: …`) e sem o aviso "chave que assina
   os QR … TEXTO PURO" (some quando `TICKET_KEY_ENCRYPTION_KEY` está definida).
3. `banco-intacto` no console da API, com o resultado colado no diário (§5).
4. Backoffice → **Configuração**: provedor do Pix e do cartão, mínimo da
   cobrança, taxa, repasse e chaves presentes. Corrija no EasyPanel o que
   estiver diferente do combinado e implante de novo.
5. Webhooks: no painel do Asaas, `https://api.borafest.com.br/v1/webhooks/payments/asaas`
   com o token de `ASAAS_WEBHOOK_TOKEN`; no Mercado Pago,
   `https://api.borafest.com.br/v1/webhooks/payments/mercadopago` com a
   assinatura de `MERCADOPAGO_WEBHOOK_SECRET`; no Resend,
   `https://api.borafest.com.br/v1/webhooks/resend` com o "Signing secret" em
   `RESEND_WEBHOOK_SECRET`. Uma compra real de valor baixo confirma o caminho
   inteiro (pagar → ingresso no e-mail → QR válido na portaria).
6. Site: `https://borafest.com.br/robots.txt`, `/sitemap.xml` e o link canônico
   de um evento apontam para `https://borafest.com.br` (nunca `localhost`).
   Reenvie o sitemap no Google Search Console.
7. Pendentes dos deploys de 11 e 12/10, uma vez só:
   - eventos cancelados antes de 11/10 que ainda têm ingresso grátis valendo:
     painel → Editar evento → "Cancelar os ingressos grátis";
   - `PAYMENT_MIN_CHARGE_CENTS` e lotes pagos ativos abaixo do mínimo (a compra
     deles agora é recusada);
   - backfill do CPF dos convidados de 15/09, se nunca rodou:
     `cd apps/api && npx tsx scripts/backfill-cpf-convidados.ts` (só confere)
     e depois com `--aplicar`;
   - com `TOTP_ENCRYPTION_KEY` definida: cada admin ativa o app autenticador
     em backoffice → **Segurança**;
   - com `TICKET_KEY_ENCRYPTION_KEY` definida (a mesma na API e no worker, os
     dois já reiniciados): `cd apps/api && npx tsx scripts/cifrar-chaves-qr.ts`
     (só confere) e depois com `--aplicar`;
   - listar os `account_claim` já enviados ao e-mail de terceiro (consulta só
     de leitura) e avaliar.
8. Pendentes do deploy de 13/10, uma vez só:
   - **depois de um backup**, contas apagadas antes de 12/10 (exclusão antiga,
     que deixava dados): `cd apps/api && npx tsx scripts/lgpd-contas-apagadas-antes.ts`
     (só confere) e depois com `--aplicar`;
   - **portaria**: recarregar `borafest.com.br/portaria` nos aparelhos da porta
     antes do próximo evento (o manifesto passou ao formato 4: QR e código
     antigos de ingresso transferido são recusados também sem internet).

## 8. Caminho alternativo: servidor próprio com Caddy (não é a produção)

`infra/docker/docker-compose.prod.yml` sobe Postgres, Redis, um serviço
`migrate` (migração + seed antes da API), API, worker, os 3 sites e o Caddy
com HTTPS automático (`infra/docker/Caddyfile`, domínios em `*_DOMAIN`). Usa
`infra/docker/Dockerfile.backend` e `Dockerfile.web` e lê `.env.production`:

```bash
cp .env.production.example .env.production   # preencha
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production up -d --build
```

Backup nesse caminho: `infra/scripts/backup.sh` por cron (`0 3 * * *`) e
restauração com `infra/scripts/restore.sh`. Esse compose ficou para trás em
relação ao do EasyPanel: não tem o Pix pelo Mercado Pago (`PAYMENTS_PROVIDER_PIX`,
`MERCADOPAGO_*`), Web Push, `PLATFORM_ADMIN_EMAILS` nem o serviço `pg-backup`.
Atualize antes de usar.

## Pendências conhecidas da infraestrutura

- Sem captura de erros (tipo Sentry) nem regras de alerta no Prometheus; logs
  em JSON no stdout do EasyPanel.
- Sem Cloudflare na frente: sem cache no Brasil e sem proteção contra robôs
  (combinado desde 19/08, cerca de 30 min, sem código).
- Servidor na Europa: 0,5 a 2 s por conexão nova (medição de 31/08).
- Sem teste de carga no servidor real (só local, 07/2026).
