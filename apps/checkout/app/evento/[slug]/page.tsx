import { permanentRedirect } from "next/navigation";

/**
 * Link curto (2026-08-19): a página do evento passou a morar na raiz
 * (borafest.com.br/nome-do-evento). Esta rota antiga continua existindo e
 * redireciona em definitivo — cartaz, story e link já compartilhado no
 * WhatsApp não podem quebrar, e o 301 preserva o ranking no Google.
 */
export default function EventoLegado({ params }: { params: { slug: string } }) {
  permanentRedirect(`/${params.slug}`);
}
