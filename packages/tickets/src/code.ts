import { randomBytes } from "crypto";

/** Alfabeto sem caracteres ambíguos (0/O, 1/I/L) para busca manual na portaria. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Código humano curto do ingresso, ex.: BF-7KQ2-M9XV. */
export function generateTicketCode(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (i === 3) out += "-";
  }
  return `BF-${out}`;
}
