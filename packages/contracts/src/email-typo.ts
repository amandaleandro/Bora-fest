/**
 * Guarda-typo de e-mail no checkout (incidente 2026-09-02).
 *
 * Um comprador digitou "@gmail.comm" (dois "m"), pagou, e o ingresso foi parar
 * numa conta-fantasma desse endereço inexistente: o e-mail de acesso quicou e
 * ele ficou sem o ingresso, com o evento abrindo no mesmo dia. `z.string()
 * .email()` aceita isso numa boa — sintaticamente é válido, só que o domínio
 * não existe. Como e-mail de compra é a ÚNICA chave de entrega, um typo aqui
 * custa o ingresso; por isso a checagem é explícita.
 *
 * Dois níveis:
 *  - TLD_INVALIDO: não existe TLD assim ("comm", "con", "cmo"…). É erro de
 *    digitação com certeza — o servidor recusa e diz a correção.
 *  - DOMINIO_PARECIDO: provedor conhecido escrito errado ("gmial.com"). Pode
 *    (raramente) ser domínio real, então a UI SUGERE e o comprador decide.
 */

/** TLDs que só existem como erro de digitação, e o que a pessoa quis dizer. */
const TLD_ERRADO: Record<string, string> = {
  comm: "com",
  con: "com",
  cmo: "com",
  cim: "com",
  co: "com", // ".co" existe (Colômbia), mas em @gmail.co é typo de .com — ver uso abaixo
  om: "com",
  cpm: "com",
  vom: "com",
  "com.br.br": "com.br",
};

/** Provedores populares e as grafias erradas mais comuns. */
const DOMINIO_ERRADO: Record<string, string> = {
  "gmail.co": "gmail.com",
  "gmai.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmail.cm": "gmail.com",
  "gamil.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "hotmail.co": "hotmail.com",
  "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "hotmail.cm": "hotmail.com",
  "outlook.co": "outlook.com",
  "outlok.com": "outlook.com",
  "yahoo.co": "yahoo.com",
  "yaho.com": "yahoo.com",
  "icloud.co": "icloud.com",
  "bol.com": "bol.com.br",
  "uol.com": "uol.com.br",
};

export interface CorrecaoEmail {
  /** o endereço corrigido sugerido (ex.: "maycon@gmail.com") */
  sugestao: string;
  /** true = com certeza é typo (TLD inexistente); false = só parecido, deixe o usuário decidir */
  certeza: boolean;
}

/**
 * Devolve a correção sugerida para um e-mail, ou null se não há suspeita.
 * Não valida o formato — use junto do z.string().email().
 */
export function sugerirCorrecaoEmail(email: string): CorrecaoEmail | null {
  const limpo = email.trim().toLowerCase();
  const at = limpo.lastIndexOf("@");
  if (at <= 0) return null;
  const local = limpo.slice(0, at);
  const dominio = limpo.slice(at + 1);
  if (!dominio.includes(".")) return null;

  // 1) domínio conhecido escrito errado (sugestão, sem certeza)
  const dominioCerto = DOMINIO_ERRADO[dominio];
  if (dominioCerto) {
    // "@gmail.co" é typo de .com com certeza prática: ninguém tem conta de
    // compra em gmail.co (não existe) — tratamos como certeza.
    return { sugestao: `${local}@${dominioCerto}`, certeza: true };
  }

  // 2) TLD que não existe (certeza de typo)
  const partes = dominio.split(".");
  const tld = partes[partes.length - 1];
  const tldCerto = TLD_ERRADO[tld];
  if (tldCerto && tld !== "co") {
    partes[partes.length - 1] = tldCerto;
    return { sugestao: `${local}@${partes.join(".")}`, certeza: true };
  }

  return null;
}

/** true quando o e-mail tem typo COM CERTEZA (o servidor deve recusar). */
export function temTypoCerto(email: string): boolean {
  return sugerirCorrecaoEmail(email)?.certeza === true;
}

/** Mensagem pronta para o comprador, já com a correção. */
export function mensagemTypoEmail(email: string): string {
  const c = sugerirCorrecaoEmail(email);
  return c
    ? `Confira o e-mail: "${email.trim()}" parece ter um erro de digitação. Você quis dizer ${c.sugestao}?`
    : "E-mail inválido";
}
