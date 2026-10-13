import type { Metadata } from "next";
import { DescadastroCliente } from "./DescadastroCliente";

/**
 * "Não quero mais receber" (LGPD, 2026-10-12) — destino do link no rodapé dos
 * e-mails de campanha das Casas e do aviso aos seguidores. Abrir a página não
 * muda nada (antivírus e pré-visualização de e-mail abrem links sozinhos): a
 * pessoa confirma com um botão.
 */
export const metadata: Metadata = {
  title: "Não quero mais receber · BoraFest",
  // página pessoal: fora do Google, e o código do link não vaza como referência
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function DescadastroPage({ params }: { params: { token: string } }) {
  return <DescadastroCliente token={params.token} />;
}
