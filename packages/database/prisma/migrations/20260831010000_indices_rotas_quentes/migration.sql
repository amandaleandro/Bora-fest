-- Índices das rotas quentes (auditoria de performance 2026-08-30).
-- Aditivos; nas tabelas de hoje o lock do CREATE INDEX é de milissegundos.

-- login OTP/link mágico reivindica pedidos de convidado por e-mail em TODO login
CREATE INDEX "orders_contact_email_idx" ON "orders" ("contact_email");

-- perfil "Minhas compras" e carteira: pedidos do usuário, mais novos primeiro
CREATE INDEX "orders_user_id_created_at_idx" ON "orders" ("user_id", "created_at");

-- home "Em alta": groupBy de tickets por evento nas janelas de 24h/7d
CREATE INDEX "tickets_event_id_issued_at_idx" ON "tickets" ("event_id", "issued_at");

-- placar de vendas por promoter
CREATE INDEX "orders_promoter_link_id_idx" ON "orders" ("promoter_link_id");
CREATE INDEX "orders_promoter_seller_id_idx" ON "orders" ("promoter_seller_id");
