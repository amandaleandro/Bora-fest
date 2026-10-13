/**
 * Copia para a área de transferência (2026-10-12). Devolve false quando o
 * navegador não deixa (sem HTTPS, permissão negada, navegador de app): a tela
 * então mostra o link para a pessoa copiar na mão, em vez de dizer "Copiado".
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}
