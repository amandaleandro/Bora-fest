import { prisma } from "@borafest/database";

/**
 * Portão do 1º ingresso (decisão 2026-08-10): enquanto a conta criada no
 * checkout não for verificada, NENHUMA porta entrega o QR — carteira, imagem
 * do QR, /status, reenvio por e-mail e envio por WhatsApp.
 *
 * Auditoria 2026-08-10 achou o portão aplicado só na carteira; as outras
 * portas serviam o mesmo QR para quem tivesse o link. Agora é uma função só,
 * usada por todas elas.
 */
export async function isOrderLockedByVerification(orderId: string): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { user: { select: { emailVerifiedAt: true } } },
  });
  return Boolean(order?.user && !order.user.emailVerifiedAt);
}

export const TICKET_GATE_MESSAGE =
  "Confirme seu e-mail para liberar os ingressos — abra o link que enviamos ou peça um código na página do pedido";
