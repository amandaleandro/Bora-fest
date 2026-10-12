/**
 * Endereços que um EVENTO não pode usar como slug: o link curto do evento é
 * borafest.com.br/<slug> (2026-10-12), então qualquer rota fixa do site
 * (apps/checkout/app/*) ganharia do evento. Fonte única — antes havia duas
 * cópias (events.service e event-recurrence.service) e as duas tinham
 * esquecido "casa", "casas" e "fidelidade".
 */
export const SLUGS_RESERVADOS = new Set([
  "acesso", "casa", "casas", "checkout", "evento", "explorar", "favoritos", "fidelidade", "legal",
  "minhas-compras", "offline", "pedido", "perfil", "portaria",
  "api", "admin", "painel", "sitemap.xml", "robots.txt", "icon.png", "apple-icon.png", "_next",
]);
