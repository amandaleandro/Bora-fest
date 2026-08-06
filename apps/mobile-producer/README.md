# BoraFest Produtor (app mobile)

Embalagem mobile do painel web do produtor (`apps/producer`). O painel continua sendo servido pelo Next.js; este app abre a URL configurada em `EXPO_PUBLIC_PRODUCER_URL`.

## Testar com Expo Go

```bash
cd apps/mobile-producer
EXPO_PUBLIC_PRODUCER_URL=http://SEU_IP_NA_REDE:3001 pnpm start
```

## Gerar o app instalável

Configure a URL pública do painel e gere um build Android com EAS. Para produção, a URL deve usar HTTPS.

```bash
pnpm install
cd apps/mobile-producer
npx eas login
npx eas build --platform android --profile preview
```

O perfil `preview` gera um APK instalável. O perfil `production` gera o AAB para a Play Store.
