import type { ManifestTicket } from "./types";
import type { ManifestIndex } from "./verify";

/**
 * Busca por documento (nome ou CPF) sobre o manifesto local — roda inteira no
 * aparelho, então funciona offline por construção. O CPF cru NUNCA chega aqui:
 * o manifesto traz apenas `cpfHash` (SHA-256 hex minúsculo dos 11 dígitos) e a
 * comparação é hash contra hash (LGPD, contrato do handoff v2).
 */

export type DocumentSearchMode = "cpf" | "name" | "none";

export interface DocumentSearchResult {
  mode: DocumentSearchMode;
  tickets: ManifestTicket[];
}

/** 11 dígitos no texto (ignorando pontuação) => o operador digitou um CPF. */
export function extractCpfDigits(query: string): string | null {
  const digits = query.replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

/** minúsculas e sem acentos — "João" encontra "joao" e vice-versa */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * CPF (11 dígitos) → compara sha256 com o cpfHash do manifesto.
 * Qualquer outro texto → busca por nome (substring, sem caixa nem acento).
 */
export async function searchByDocument(
  index: ManifestIndex,
  query: string,
  limit = 30,
): Promise<DocumentSearchResult> {
  const cpf = extractCpfDigits(query);
  if (cpf) {
    const hash = await sha256Hex(cpf);
    const tickets: ManifestTicket[] = [];
    for (const ticket of index.byId.values()) {
      if (ticket.cpfHash && ticket.cpfHash.toLowerCase() === hash) {
        tickets.push(ticket);
        if (tickets.length >= limit) break;
      }
    }
    return { mode: "cpf", tickets: sortByName(tickets) };
  }

  const term = normalizeName(query.trim());
  if (term.length < 2) return { mode: "none", tickets: [] };

  const tickets: ManifestTicket[] = [];
  for (const ticket of index.byId.values()) {
    if (ticket.attendeeName && normalizeName(ticket.attendeeName).includes(term)) {
      tickets.push(ticket);
      if (tickets.length >= limit) break;
    }
  }
  return { mode: "name", tickets: sortByName(tickets) };
}

// ===========================================================================
// BUSCA UNIFICADA (2026-09-15)
//
// Código, documento e lista eram três abas no rodapé para UMA ação: liberar
// quem já tem direito de entrar. Três caminhos de peso igual, sendo que o
// scanner resolve quase tudo e os outros dois são exceção. Agora é um campo
// só, que descobre sozinho o que foi digitado — CPF já era detectado assim;
// código entrou junto porque o manifesto já carrega `code`.
//
// E a lista deixou de ser "mais um jeito de achar": ela é outra NATUREZA de
// entrada. Quem tem ingresso prova pela posse; quem está em lista não recebeu
// nada e prova pelo CPF. Por isso as abas nunca se misturam.
// ===========================================================================

export type ModoBusca = "cpf" | "codigo" | "nome" | "vazio";

/** "ingressos" = quem tem ingresso em mãos · "todas" = qualquer lista · id = uma lista */
export type AbaBusca = "ingressos" | "todas" | (string & {});

export interface ResultadoBusca {
  modo: ModoBusca;
  tickets: ManifestTicket[];
  /**
   * Nomes das abas onde essa mesma busca acharia alguém. Separar as abas cria o
   * risco de o operador procurar na errada, ler "não encontrado" e mandar embora
   * quem ESTÁ cadastrado — recusa silenciosa que parece legítima. A tela usa
   * isto para dizer "está em: Lista do João" em vez de só negar.
   */
  outrasAbas: string[];
}

/** BF-XXXX-XXXX, inclusive parcial enquanto a pessoa digita. */
const PARECE_CODIGO = /^bf[-\s]?[a-z0-9]{0,4}[-\s]?[a-z0-9]{0,4}$/i;

function soLetrasENumeros(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export function detectarModo(query: string): { modo: ModoBusca; termo: string } {
  const bruto = query.trim();
  if (!bruto) return { modo: "vazio", termo: "" };

  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length === 11) return { modo: "cpf", termo: digitos };
  if (PARECE_CODIGO.test(bruto)) return { modo: "codigo", termo: soLetrasENumeros(bruto) };

  // UMA LETRA TAMBÉM BUSCA (2026-09-15). A regra antiga exigia 2 caracteres e
  // devolvia vazio abaixo disso — o que, agora que o campo vazio mostra a aba
  // inteira, fazia os resultados SUMIREM no instante em que o operador digitava
  // a primeira letra. O teto de resultados já protege de lista gigante; não
  // precisa de mínimo.
  return { modo: "nome", termo: normalizeName(bruto) };
}

function naAba(ticket: ManifestTicket, aba: AbaBusca): boolean {
  if (aba === "ingressos") return !ticket.lista;
  if (aba === "todas") return Boolean(ticket.lista);
  return ticket.lista?.id === aba;
}

/** Abas disponíveis a partir do que o aparelho baixou — sem lista, só Ingressos. */
export function abasDoManifesto(index: ManifestIndex): Array<{ id: AbaBusca; label: string }> {
  const listas = new Map<string, string>();
  for (const ticket of index.byId.values()) {
    if (ticket.lista) listas.set(ticket.lista.id, ticket.lista.nome);
  }
  const abas: Array<{ id: AbaBusca; label: string }> = [{ id: "ingressos", label: "Ingressos" }];
  if (listas.size === 0) return abas;
  abas.push({ id: "todas", label: "Todas as listas" });
  for (const [id, nome] of [...listas].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))) {
    abas.push({ id, label: id === "producao" ? nome : `Lista de ${nome}` });
  }
  return abas;
}

/**
 * Um campo só: nome, CPF ou código. Roda inteira no aparelho — continua offline
 * por construção, e o CPF segue comparado por hash (o número nunca desce).
 */
export async function buscarPessoa(
  index: ManifestIndex,
  query: string,
  aba: AbaBusca,
  limit = 30,
): Promise<ResultadoBusca> {
  const { modo, termo } = detectarModo(query);

  const hash = modo === "cpf" ? await sha256Hex(termo) : null;
  const casa = (t: ManifestTicket): boolean => {
    if (modo === "cpf") return Boolean(t.cpfHash && t.cpfHash.toLowerCase() === hash);
    if (modo === "codigo") return soLetrasENumeros(t.code).startsWith(termo);
    if (modo === "nome") return Boolean(t.attendeeName && normalizeName(t.attendeeName).includes(termo));
    return true; // "vazio": mostra a aba inteira, que é o comportamento útil aqui
  };

  const daAba: ManifestTicket[] = [];
  const foraDaAba = new Map<string, string>();
  for (const ticket of index.byId.values()) {
    if (!casa(ticket)) continue;
    if (naAba(ticket, aba)) {
      if (daAba.length < limit) daAba.push(ticket);
    } else if (modo !== "vazio") {
      // só interessa apontar "está em outro lugar" quando houve busca de verdade
      const id = ticket.lista?.id ?? "ingressos";
      foraDaAba.set(id, ticket.lista?.nome ?? "Ingressos");
    }
  }

  return { modo, tickets: sortByName(daAba), outrasAbas: [...foraDaAba.values()] };
}

function sortByName(tickets: ManifestTicket[]): ManifestTicket[] {
  return tickets.sort((a, b) =>
    (a.attendeeName ?? a.code).localeCompare(b.attendeeName ?? b.code, "pt-BR"),
  );
}

// --- SHA-256 ----------------------------------------------------------------

/** WebCrypto quando existe; senão a implementação JS pura abaixo. */
export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const digest = await subtle.digest("SHA-256", bytes);
      return bytesToHex(new Uint8Array(digest));
    } catch {
      /* cai no fallback síncrono */
    }
  }
  return sha256Sync(bytes);
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

// FIPS 180-4 em JS puro — necessário porque `crypto.subtle` só existe em
// contexto seguro, e a portaria pode rodar por http em IP de rede local.
// prettier-ignore
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256Sync(input: Uint8Array): string {
  const state = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  // padding: 0x80 + zeros + tamanho em bits (inputs aqui são curtos: cabe em 32 bits)
  const length = input.length;
  const padded = new Uint8Array((((length + 8) >> 6) << 6) + 64);
  padded.set(input);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, (length * 8) >>> 0);

  const w = new Int32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }

    state[0] = (state[0] + a) | 0;
    state[1] = (state[1] + b) | 0;
    state[2] = (state[2] + c) | 0;
    state[3] = (state[3] + d) | 0;
    state[4] = (state[4] + e) | 0;
    state[5] = (state[5] + f) | 0;
    state[6] = (state[6] + g) | 0;
    state[7] = (state[7] + h) | 0;
  }

  return state.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}
