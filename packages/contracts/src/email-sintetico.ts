/**
 * E-MAILS SINTÉTICOS — fonte única (2026-09-15).
 *
 * Alguns pedidos nascem sem e-mail real e precisam de um valor só para
 * satisfazer o NOT NULL da coluna: venda na porta (o cliente paga e entra, não
 * digita nada) e convidado de lista (prova pelo CPF na porta, não recebe nada).
 * Esses formatos estavam escritos à mão em três lugares da API; o worker então
 * enfileirava entrega de ingresso para endereços que não existem — centenas de
 * bounces por noite contra a reputação do remetente.
 *
 * Quem GERA e quem RECONHECE leem daqui. `.local` é reservado (RFC 6762) e
 * nunca será de ninguém; o formato de lista é reconhecido pelo padrão exato,
 * não por sufixo — borafest.app é domínio real da plataforma.
 */
export function emailSinteticoPdv(): string {
  return `pdv-${Date.now()}@borafest.local`;
}

export function emailSinteticoLista(reservationId: string): string {
  return `guest-list+${reservationId}@borafest.app`;
}

const PADROES_SINTETICOS = [/^pdv-\d+@borafest\.local$/i, /^guest-list\+.+@borafest\.app$/i];

/** true = não existe caixa; qualquer envio para cá é bounce garantido. */
export function semEmailReal(email: string | null | undefined): boolean {
  if (!email) return true;
  return PADROES_SINTETICOS.some((re) => re.test(email.trim()));
}
