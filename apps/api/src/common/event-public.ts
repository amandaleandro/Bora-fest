/**
 * Remove o metaCapiToken de um evento antes de devolver ao cliente (auditoria
 * 2026-08-30). Nao ha serializer global no projeto, entao TODO retorno de uma
 * Event row precisa passar por aqui — publish/unpublish/republish e o block do
 * admin vazavam o token por terem sido esquecidos. Um lugar so pra nao esquecer
 * de novo.
 */
export function semSegredoDoEvento<T extends { metaCapiToken?: unknown }>(evento: T): Omit<T, "metaCapiToken"> {
  const { metaCapiToken: _segredo, ...publico } = evento;
  return publico;
}
