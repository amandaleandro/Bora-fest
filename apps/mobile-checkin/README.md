# BoraFest Check-in (React Native / Expo)

App de portaria: login por PIN, leitura de QR, busca manual, fila offline e
sincronização em lote. Consome a API descrita em
`docs/projeto/API-REFERENCE.md` (seções "Validador" e "Check-in").

## Rodar em desenvolvimento

```bash
pnpm install
cd apps/mobile-checkin
EXPO_PUBLIC_API_URL=http://SEU_IP_NA_REDE:3333 pnpm start
```

Abra no celular com o app **Expo Go** (Android/iOS), escaneando o QR que
aparece no terminal. `localhost` não funciona a partir de um celular físico
nem do emulador Android (use o IP da sua máquina na rede local, ou
`http://10.0.2.2:3333` no emulador Android).

## O que já funciona

- Login por PIN (`POST /v1/validator/sessions`) — registra o aparelho e
  guarda o token em `expo-secure-store`.
- Sincronização do manifesto (completo na primeira vez, delta depois),
  cacheado em SQLite local (`expo-sqlite`).
- Scanner de QR (`expo-camera`) chamando `POST /v1/checkins` — online por
  padrão; se a rede falhar, cai para um pré-check local contra o manifesto
  cacheado e enfileira o check-in.
- Busca manual por código do ingresso (o manifesto não traz nome/CPF — só o
  caminho online devolve isso).
- Fila offline com sincronização em lote (`POST /v1/checkins/sync`,
  idempotente por `batchKey`).
- Contador local (confirmados/pendentes) — **não é o contador oficial do
  produtor** (`GET /v1/events/:id/checkin-live` exige sessão de usuário, não
  token de aparelho; ver nota em `API-REFERENCE.md`).

## O que ainda falta (fora do escopo desta entrega)

- **Verificação de assinatura do QR no aparelho**: hoje o parser local
  (`src/qr/parseTicketToken.ts`) só decodifica o payload, não confere a
  assinatura Ed25519 (isso exigiria uma lib de crypto compatível com React
  Native, tipo `@noble/ed25519`, mais extrair a chave pública raw do PEM do
  manifesto). Sem isso, o pré-check offline confia no payload sem detectar
  adulteração — só o servidor detecta de verdade. Ver limitação documentada
  na arquitetura (§12): "dois aparelhos totalmente offline não conseguem se
  coordenar entre si nem detectar QR forjado sem verificação local."
- **Seleção de evento/portão na tela de login**: hoje é preciso colar o
  `eventId` manualmente; o ideal é o produtor gerar um link/QR de convite
  com o evento e o portão já embutidos.
- **Reversão de check-in**: é uma ação do painel do produtor
  (`POST /v1/checkins/:id/reverse`, exige sessão de usuário), não do app de
  portaria — de propósito, não é uma lacuna.
- **Publicação nas lojas** (Fase 10 da arquitetura): contas Google
  Play/Apple Developer, ícones/splash reais, EAS Build — nada disso foi
  feito ainda; este app não passou de testes manuais via Expo Go.
- Teste em dispositivo real: este ambiente de desenvolvimento não tem
  emulador Android/iOS nem um celular físico conectado, então o app foi
  escrito e checado por tipos (`pnpm --filter @borafest/mobile-checkin
  typecheck`), mas **não foi executado de fato** — rodar em um celular com
  Expo Go é o próximo passo antes de confiar nele em produção.
