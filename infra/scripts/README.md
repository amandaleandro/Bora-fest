# Backup, restauração e alerta — o que roda e o que configurar

Revisão de 2026-10-12. Vale para a produção no **EasyPanel**, que sobe o
`docker-compose.yml` da raiz. Os scripts `backup.sh` e `restore.sh` desta
pasta são do caminho alternativo (servidor próprio com Caddy,
`infra/docker/docker-compose.prod.yml`) e não são usados no EasyPanel.

## O que já roda sozinho

| O quê | Onde | Frequência |
|---|---|---|
| Dump do banco (`borafest-db-<data>.sql.gz[.enc]`) | serviço `pg-backup` → volume `borafest_pg_backups` | 1 a cada 24 h, 14 dias guardados |
| Banners e flyers (`borafest-uploads-<data>.tar.gz[.enc]`) | mesmo serviço, lendo o volume `borafest_uploads` só para leitura | junto com o dump |
| Conferência do dump (precisa terminar com "dump complete") | `pg-backup.sh` | todo ciclo |
| Status do backup | healthcheck do `pg-backup`: vira `unhealthy` (no `docker ps` e no painel, quando ele mostra) se não houver dump com menos de 26 h | a cada 10 min |
| `/health` da API: banco + Redis + worker | `apps/api/src/health` | a cada chamada |
| Batida do worker no Redis (`borafest:worker:heartbeat`, validade 90 s) | `apps/worker/src/heartbeat.ts` | a cada 30 s |

Sem nenhuma variável nova, o backup continua funcionando como antes (sem
criptografia e só no servidor), agora com os uploads incluídos, e avisa no log
o que está faltando.

## O que o Arthur configura (Environment do serviço Compose no EasyPanel)

1. **Senha do backup:** `BACKUP_ENCRYPTION_PASSPHRASE`.
   - Gere uma senha longa só com letras e números (sem `$`, aspas ou espaço),
     por exemplo `openssl rand -base64 48 | tr -dc 'A-Za-z0-9'`.
   - **Guarde também FORA do servidor** (gerenciador de senhas). Sem ela,
     nenhum backup criptografado abre. Se o servidor se perder, a senha que
     estava só nele se perde junto.
   - Se `TICKET_KEY_ENCRYPTION_KEY` (chave que protege as chaves dos QR no
     banco) estiver em uso, guarde essa também fora do servidor: sem ela, um
     banco restaurado não consegue assinar QR.
2. **Cópia para fora do servidor** (S3 compatível). Sugestões: Backblaze B2
   (barato) ou Cloudflare R2 (sem custo de download).
   - Crie um bucket **privado** e uma chave de acesso com permissão só de
     escrita nesse bucket.
   - No bucket, crie uma regra de ciclo de vida para apagar arquivos com mais
     de 30 dias. O script não apaga nada lá fora de propósito: assim, quem
     invadir o servidor não consegue apagar as cópias externas.
   - Variáveis:

     | Variável | Exemplo |
     |---|---|
     | `BACKUP_S3_BUCKET` | `borafest-backups` |
     | `BACKUP_S3_ACCESS_KEY_ID` | (da chave criada) |
     | `BACKUP_S3_SECRET_ACCESS_KEY` | (da chave criada) |
     | `BACKUP_S3_ENDPOINT` | B2: `https://s3.us-east-005.backblazeb2.com` · R2: `https://<conta>.r2.cloudflarestorage.com` · AWS: vazio |
     | `BACKUP_S3_REGION` | B2: `us-east-005` · R2: `auto` · AWS: `sa-east-1` |
     | `BACKUP_S3_PROVIDER` | `Other` (padrão) · `Cloudflare` · `AWS` · `Wasabi` |
     | `BACKUP_S3_PREFIX` | `borafest` (padrão; vira a pasta no bucket) |

   - Só arquivo criptografado sai do servidor. Sem a senha do item 1, o envio
     fica desligado e o log explica o motivo.
   - A imagem `postgres:16-alpine` não traz `openssl` nem `rclone`. O script
     instala com `apk add` quando precisa, e por isso o servidor precisa de
     acesso à internet. Se a instalação falhar, o backup local continua e o
     aviso vai para o log e para o webhook.
3. **Aviso de falha do backup:** `BACKUP_ALERT_WEBHOOK_URL`, um webhook de
   entrada do Slack ou do Discord. O aviso é enviado quando o dump, os uploads
   ou o envio falham.
4. **Aviso de sistema fora do ar:** crie um monitor externo grátis
   (UptimeRobot ou BetterStack) para `https://api.borafest.com.br/health`,
   a cada 1–5 min, com alerta por e-mail, WhatsApp ou Telegram. A rota
   responde 200 quando banco, Redis e worker estão bem, e 503 com o motivo
   quando algum falha. Configure o monitor como HTTP(s) comum (alerta em
   status diferente de 200) ou por palavra-chave `"status":"ok"`.
5. Depois de salvar as variáveis, faça **Deploy** de novo. As variáveis só
   chegam ao contêiner na recriação.

## Como conferir que está funcionando

- Log do serviço `pg-backup`: procure `banco ok`, `uploads ok` e, com bucket
  configurado, `enviado para fora`. Linhas com `ERRO:` dizem o que falhou.
- Para forçar um backup agora (por exemplo, antes de uma migração arriscada),
  abra o console do `pg-backup` e rode:
  `bash /opt/borafest/scripts/pg-backup.sh --uma-vez`
- No bucket, os arquivos aparecem em `<BACKUP_S3_PREFIX>/`.
- Rode `curl -s https://api.borafest.com.br/health`. A resposta esperada é
  `{"status":"ok","db":"up","redis":"up","worker":"up",...}`.

## Ensaio de restauração (fazer 1x por mês e após mudar o backup)

No console do serviço `pg-backup`:

```sh
bash /opt/borafest/scripts/restore-drill.sh            # usa o dump mais recente
bash /opt/borafest/scripts/restore-drill.sh /backups/borafest-db-AAAAMMDD-HHMMSS.sql.gz.enc
```

O ensaio cria um banco temporário `borafest_ensaio_<data>`, restaura o dump
nele e mostra a contagem de linhas das tabelas principais lado a lado com o
banco real (que só é lido). Também confere o pacote de uploads do mesmo ciclo.
No fim, apaga o banco temporário. O banco real nunca é tocado. Ele precisa de
espaço livre em disco do tamanho do banco, então rode fora do horário de pico.
Se terminar com `ENSAIO OK`, anote a data no item 5.2 de
`docs/projeto/PLANO-DE-TESTES.md`.

## Restauração de verdade

Faça isso **só com perda comprovada** pela checagem `banco-intacto`. Tela
vazia nunca é prova. O roteiro abaixo não apaga nada: o banco atual é
renomeado e fica guardado para análise.

1. No EasyPanel, pare os serviços `api` e `worker`.
2. No console do `pg-backup`, escolha o arquivo com `ls -lt /backups`.
3. Restaure num banco novo e confira:

   ```sh
   psql -d postgres -c 'CREATE DATABASE borafest_restaurado;'
   # dump criptografado (.enc); se o openssl faltar: apk add openssl
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENCRYPTION_PASSPHRASE \
     -in /backups/borafest-db-AAAAMMDD-HHMMSS.sql.gz.enc | gunzip -c | psql -X -d borafest_restaurado
   # dump sem criptografia (.sql.gz):
   #   gunzip -c /backups/borafest-db-AAAAMMDD-HHMMSS.sql.gz | psql -X -d borafest_restaurado
   psql -d borafest_restaurado -c 'SELECT count(*) FROM orders;'
   ```

4. Troque os nomes, sem apagar nada:

   ```sh
   psql -d postgres -c "ALTER DATABASE borafest RENAME TO borafest_quebrado_$(date +%Y%m%d);" \
                    -c 'ALTER DATABASE borafest_restaurado RENAME TO borafest;'
   ```

5. Suba `api` e `worker` de novo e confira o log da checagem `banco-intacto`
   no boot da API.

**Uploads (banners/flyers).** No `pg-backup`, o volume entra só para leitura.
A restauração é feita no host do servidor. Ache os nomes reais dos volumes
(`docker volume ls | grep -E 'uploads|pg_backups'`) e rode:

```sh
docker run --rm -e BACKUP_ENCRYPTION_PASSPHRASE \
  -v <volume_uploads>:/uploads -v <volume_pg_backups>:/backups alpine sh -c \
  'apk add --no-cache openssl >/dev/null && openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
     -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in /backups/borafest-uploads-AAAAMMDD-HHMMSS.tar.gz.enc \
   | tar -xzf - -C /uploads'
```

**Servidor perdido:** baixe os arquivos do bucket (painel do provedor ou
`rclone`) e abra em qualquer máquina com OpenSSL 1.1.1 ou mais novo:
`openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in ARQ.enc -out ARQ` (o
comando pede a senha). Depois, siga os passos acima no servidor novo.

> O número `-iter 200000` precisa ser igual em `pg-backup.sh`,
> `restore-drill.sh` e neste arquivo. Se mudar em um, mude nos três.
