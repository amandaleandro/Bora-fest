/**
 * Espelho de packages/contracts/src/cpf.ts — o checkout não depende de
 * @borafest/contracts (a imagem Docker dele não builda os pacotes). Se a
 * regra mudar lá, mudar aqui. Normaliza ANTES de validar: o CPF entra por
 * teclado de celular com ponto, hífen e espaço.
 */

export function normalizarCpf(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

/** 11 dígitos, não é sequência repetida e os dois verificadores conferem. */
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
