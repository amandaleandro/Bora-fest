import { cabecalhosDeDescadastro, type EmailMessage } from "@borafest/notifications";

function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * E-mail "a Casa que você segue publicou um evento" (2026-10-12): mesmo texto
 * de antes, agora com o motivo do envio e o link "Não quero mais receber"
 * (deixa de seguir a Casa) no rodapé e no cabeçalho List-Unsubscribe. Nome do
 * evento e da Casa são digitados pelo produtor — escapados no HTML.
 */
export function montarAvisoAosSeguidores(input: {
  to: string;
  casa: string | null;
  tituloDoEvento: string;
  linkDoEvento: string;
  descadastro: { pagina: string; umClique: string };
}): EmailMessage {
  const casa = input.casa?.trim() || null;
  const titulo = input.tituloDoEvento.trim();
  const motivo = `Você recebe este aviso porque segue ${casa ?? "esta Casa"} na BoraFest.`;
  const headers = cabecalhosDeDescadastro(input.descadastro.umClique);

  const text = [
    `${titulo} já está com vendas abertas: ${input.linkDoEvento}`,
    "",
    motivo,
    `Não quero mais receber: ${input.descadastro.pagina}`,
  ].join("\n");

  const link = escaparHtml(input.linkDoEvento);
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827;line-height:1.6">
  <p>${escaparHtml(titulo)} já está com vendas abertas.</p>
  <p><a href="${link}">${link}</a></p>
  <p style="margin-top:28px;color:#6b7280;font-size:12px">${escaparHtml(motivo)} <a href="${escaparHtml(input.descadastro.pagina)}" style="color:#6b7280;text-decoration:underline">Não quero mais receber</a></p>
</div>`.trim();

  return {
    to: input.to,
    subject: `${casa ?? "Um produtor que você segue"} publicou um novo evento`,
    html,
    text,
    ...(headers ? { headers } : {}),
  };
}
