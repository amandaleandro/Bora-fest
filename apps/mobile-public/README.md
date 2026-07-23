# BoraFest (app público do comprador)

App do comprador: descoberta de eventos, compra (reserva → Pix → carteira)
e "meus ingressos" opcional por login OTP. Consome a API descrita em
`docs/projeto/API-REFERENCE.md`.

## Rodar em desenvolvimento

```bash
pnpm install
cd apps/mobile-public
EXPO_PUBLIC_API_URL=http://SEU_IP_NA_REDE:3333 pnpm start
```

Abra no celular com o app **Expo Go**. `localhost` não funciona a partir
de um celular físico nem do emulador Android (use o IP da sua máquina na
rede local, ou `http://10.0.2.2:3333` no emulador Android).

## O que já funciona

- **Descoberta de eventos** (`GET /v1/public/events` — endpoint novo desta
  entrega, não existia antes; só havia busca por slug de um evento
  específico).
- **Compra sem conta**: seleção de ingressos → reserva → dados de contato
  → Pix (QR via `react-native-qrcode-svg` + copiar código) → a tela avança
  sozinha quando o pagamento é aprovado (polling do status do pedido).
- **Carteira**: ingressos com QR assinado, reenvio por e-mail/WhatsApp.
- **"Meus ingressos" opcional**: login por OTP (`expo-secure-store` guarda
  o token) só pra quem quer ver o histórico de compras
  (`GET /v1/me/tickets`) — a compra em si nunca exige login.

## O que ainda falta (fora do escopo desta entrega)

- **Push notifications**: a arquitetura menciona "notificações" como parte
  da Fase 12; isso não foi implementado (exigiria configurar Expo push
  tokens + endpoint de registro no backend, que também não existe ainda).
- **Transferência de ingresso** e **pedido de reembolso pelo app**: a API
  já tem `POST /v1/tickets/:id/transfer` e `POST /v1/orders/:id/refund-requests`
  na arquitetura original (§13), mas não foram implementados no backend
  ainda — não dá pra construir a tela sem a rota existir.
- **Pagamento por cartão**: só Pix está implementado na tela (mesma
  decisão de escopo do checkout web `apps/checkout`) — cartão exigiria
  tokenização client-side (`tokenizecard.js` do Pagar.me), mais complexo
  de fazer direito num app RN.
- **Ícones/splash reais, publicação nas lojas**: nada disso foi feito;
  este app não passou de testes manuais.
- **Teste em dispositivo real**: mesma limitação do `apps/mobile-checkin`
  — este ambiente de desenvolvimento não tem emulador nem celular físico.
  Validado via `expo export` (bundle real do Metro, ver
  `docs/projeto/REGISTRO.md`), mas nunca aberto numa tela de verdade.
