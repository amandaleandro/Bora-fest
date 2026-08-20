-- Correção 2026-08-19: PLATFORM_FEE e COMMISSION_DEBIT nasciam MADUROS
-- (available_at = agora) enquanto o SALE_CREDIT da mesma venda só liberava
-- D+N úteis após o evento. Efeito no painel: "a liberar" mostrava o valor
-- BRUTO e cada venda futura derrubava o saldo sacável de hoje.
--
-- Aqui alinhamos os lançamentos JÁ GRAVADOS: cada débito de taxa/comissão
-- passa a ter o mesmo available_at do crédito irmão (mesma referência).
-- Idempotente: rodar de novo não muda nada.
UPDATE ledger_entries AS fee
SET available_at = venda.available_at
FROM ledger_entries AS venda
WHERE fee.type IN ('PLATFORM_FEE', 'COMMISSION_DEBIT')
  AND venda.type = 'SALE_CREDIT'
  AND venda.reference_type = fee.reference_type
  AND venda.reference_id = fee.reference_id
  AND venda.ledger_account_id = fee.ledger_account_id
  AND fee.available_at <> venda.available_at;
