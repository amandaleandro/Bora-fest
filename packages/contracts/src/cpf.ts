/**
 * CPF — fonte única da regra (2026-09-15).
 *
 * A validação de dígito verificador já existia COPIADA em dois lugares
 * (`orders.service.ts` no servidor e `PdvPorta.tsx` na tela) e agora a lista de
 * convidados precisava de uma terceira. Regra duplicada neste projeto já deu
 * errado antes — foi exatamente o motivo de `origem-gratis.ts` existir. Aqui
 * tem um dono só.
 *
 * O CPF entra por teclado de celular, no meio da fila: chega com ponto, hífen,
 * espaço no fim. Normalizar ANTES de validar é parte da regra, não cortesia —
 * validar o texto cru recusa CPF bom (mesma lição do e-mail em 2026-09-02).
 */

/** Só os dígitos — descarta máscara, espaço e qualquer lixo de teclado. */
export function normalizarCpf(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

/**
 * CPF válido de verdade: 11 dígitos, não é sequência repetida e os dois dígitos
 * verificadores conferem. Aceita com ou sem máscara.
 *
 * Importa recusar "111.111.111-11" e afins: são os valores que alguém digita
 * para "preencher o campo" quando ele é obrigatório e a pessoa não tem o dado.
 */
export function ehCpfValido(raw: string | null | undefined): boolean {
  const cpf = normalizarCpf(raw);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const len of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < len; i += 1) soma += Number(cpf[i]) * (len + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(cpf[len])) return false;
  }
  return true;
}

/** "12345678909" -> "123.456.789-09" (só para exibir; nunca para comparar). */
export function formatarCpf(raw: string | null | undefined): string {
  const cpf = normalizarCpf(raw);
  if (cpf.length !== 11) return raw ?? "";
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}
