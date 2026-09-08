import { permanentRedirect } from "next/navigation";

/**
 * Link curto (2026-08-19): a página do evento passou a morar na raiz
 * (borafest.com.br/nome-do-evento). Esta rota antiga continua existindo e
 * redireciona em definitivo — cartaz, story e link já compartilhado no
 * WhatsApp não podem quebrar, e o 301 preserva o ranking no Google.
 *
 * A QUERY VAI JUNTO (2026-09-08): o redirect descartava a query string, e com
 * ela o ?pr= / ?p= / ?vd= — a venda acontecia e a comissão do promoter virava
 * ZERO, em silêncio. Quem divulgou por este endereço vendeu de graça. Vai UTM
 * junto também, senão a origem da venda some do relatório.
 */
export default function EventoLegado({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const query = new URLSearchParams();
  for (const [chave, valor] of Object.entries(searchParams ?? {})) {
    if (Array.isArray(valor)) valor.forEach((v) => query.append(chave, v));
    else if (valor !== undefined) query.set(chave, valor);
  }
  const qs = query.toString();
  permanentRedirect(qs ? `/${params.slug}?${qs}` : `/${params.slug}`);
}
