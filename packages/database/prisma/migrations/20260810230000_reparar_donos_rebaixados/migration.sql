-- Reparo de dados único (incidente 2026-08-10): o bug antigo do convite
-- (inviteMember com upsert) rebaixava membro ATIVO — a dona de uma
-- organização virava seller/INVITED e perdia a edição dos próprios eventos.
-- O código já foi corrigido; esta migração restaura quem já foi afetado.
--
-- Invariante: TODA organização é criada com seu criador como owner. Logo,
-- organização SEM nenhum owner ativo está comprovadamente danificada. Nesse
-- caso, o membro mais antigo (o criador) é restaurado a owner/ACTIVE.
-- Idempotente: depois de rodar, toda org tem owner e re-executar não faz nada.
WITH orgs_sem_dono AS (
  SELECT o.id AS org_id
  FROM organizations o
  WHERE NOT EXISTS (
    SELECT 1
    FROM organization_members om
    JOIN roles r ON r.id = om.role_id
    WHERE om.organization_id = o.id
      AND r.key = 'owner'
      AND om.status = 'ACTIVE'
  )
),
membro_original AS (
  SELECT DISTINCT ON (om.organization_id) om.id AS membership_id
  FROM organization_members om
  JOIN orgs_sem_dono s ON s.org_id = om.organization_id
  ORDER BY om.organization_id, om.invited_at ASC
)
UPDATE organization_members om
SET role_id = (SELECT id FROM roles WHERE key = 'owner'),
    status = 'ACTIVE',
    sales_partner_id = NULL
FROM membro_original mo
WHERE om.id = mo.membership_id;
