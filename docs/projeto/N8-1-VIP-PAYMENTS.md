# N8.1 — Pagamento de reservas VIP

Objetivo: permitir sinal/pagamento de uma reserva VIP confirmada sem criar um pedido de ingresso falso.

Princípios:
- `Payment` continua sendo a fonte única de cobranças e webhooks.
- um `Payment` aponta para `Order` ou `VipReservation`, nunca ambos.
- pagamento VIP não emite Ticket.
- confirmação da reserva continua sendo decisão da Casa; pagamento só pode começar após `CONFIRMED`.
- valor cobrado é configurável por reserva como percentual/valor de sinal, com teto no total congelado.
- webhook, reconciliação e idempotência continuam únicos.
- ledger da Casa recebe o valor efetivamente pago como venda VIP, liberado após o evento conforme a mesma política de settlement.

Este documento acompanha a implementação em `feat/n8-1-vip-payments`.
