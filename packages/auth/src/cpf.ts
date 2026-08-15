/**
 * Validação dos DÍGITOS VERIFICADORES do CPF (decisão 2026-08-15): a defesa
 * real contra digitação errada — praticamente todo typo quebra o checksum e é
 * recusado na hora, sem fricção de e-mail de confirmação.
 */
export function isValidCpf(raw: string): boolean {
  const cpf = raw.replace(/\D/g, "");
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // 000..., 111... são inválidos
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i += 1) sum += Number(cpf[i]) * (len + 1 - i);
    const dv = ((sum * 10) % 11) % 10;
    if (dv !== Number(cpf[len])) return false;
  }
  return true;
}
