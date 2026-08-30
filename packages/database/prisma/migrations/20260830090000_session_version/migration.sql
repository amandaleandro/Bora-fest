-- Revogação de sessão (auditoria de segurança 2026-08-29):
-- a troca de senha incrementa session_version; o guard recusa tokens com
-- versão diferente da atual. Default 0 mantém as sessões vigentes válidas no
-- deploy (tokens antigos não trazem sv → tratados como 0 → conferem).
ALTER TABLE "users" ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;
