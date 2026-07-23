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
  → escolha de Pix ou cartão de crédito → a tela avança sozinha quando o
  pagamento é aprovado (polling do status do pedido).
  - **Pix**: QR via `react-native-qrcode-svg` + copiar código.
  - **Cartão de crédito**: formulário (número, nome, validade, CVV,
    parcelas) → tokenizado direto pelo app (`src/payments/tokenizeCard.ts`,
    sem passar o PAN pelo nosso backend) → `POST /v1/orders/:id/payments/card`.
    Sem `EXPO_PUBLIC_PAGARME_PUBLIC_KEY` configurada (gateway real ainda
    pendente de conta comercial), usa um token mock que só o `MockGateway`
    reconhece — **não é dinheiro de verdade** até essa chave existir.
- **Carteira**: ingressos com QR assinado, reenvio por e-mail/WhatsApp.
- **Push notifications**: o app pede permissão e registra o token Expo
  (`POST /v1/orders/:publicToken/push-token`) assim que o pedido é criado —
  best-effort, não bloqueia a compra se o aparelho recusar/não suportar.
  Avisa quando os ingressos ficam prontos, com ou sem conta.
- **"Meus ingressos" opcional**: login por OTP (`expo-secure-store` guarda
  o token) só pra quem quer ver o histórico de compras
  (`GET /v1/me/tickets`) — a compra em si nunca exige login.

## O que ainda falta (fora do escopo desta entrega)

- **Transferência de ingresso** e **pedido de reembolso pelo app**: a API já
  tem `POST /v1/tickets/:id/transfer` e `POST /v1/orders/:publicToken/
  refund-requests` implementados no backend (§13), mas ainda não têm tela
  neste app.
- **Ícones/splash reais, publicação nas lojas**: nada disso foi feito;
  este app não passou de testes manuais.
- **Teste em dispositivo real**: mesma limitação do `apps/mobile-checkin`
  — este ambiente de desenvolvimento não tem emulador nem celular físico.
  Validado via `expo export` (bundle real do Metro) e via smoke tests reais
  contra a API local (push token registrado, cartão aprovado/recusado via
  `MockGateway`), mas nunca aberto numa tela de verdade — push em particular
  só pode ser confirmado de ponta a ponta num aparelho real.
