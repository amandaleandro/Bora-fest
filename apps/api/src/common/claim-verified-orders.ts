import { NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";

/** Vincula pedidos antigos sem dono somente após a conta comprovar o e-mail. */
export async function claimVerifiedOrders(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerifiedAt: true },
  });
  if (!user) throw new NotFoundException("Usuário não encontrado");
  if (!user.email || !user.emailVerifiedAt) return;

  await prisma.order.updateMany({
    where: {
      userId: null,
      contactEmail: { equals: user.email, mode: "insensitive" },
    },
    data: { userId },
  });
}
