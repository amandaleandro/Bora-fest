-- Rede de segurança contra corrida de saque (auditoria 2026-08-10): no máximo
-- UMA solicitação pendente por organização, garantido pelo banco.
CREATE UNIQUE INDEX IF NOT EXISTS "payout_requests_one_pending_per_org"
  ON "payout_requests" ("organization_id")
  WHERE "status" = 'PENDING';

-- idem para o repasse em execução
CREATE UNIQUE INDEX IF NOT EXISTS "payouts_one_pending_per_org"
  ON "payouts" ("organization_id")
  WHERE "status" = 'PENDING';
