import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { isPlatformAdmin, isPlatformStaff } from "@borafest/auth";

@Injectable()
export class PlatformAccessService {
  async assertStaff(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Usuário não encontrado");
    if (!isPlatformStaff(user.platformRole)) {
      throw new ForbiddenException("Acesso restrito à equipe BoraFest");
    }
    return user;
  }

  async assertAdmin(userId: string) {
    const user = await this.assertStaff(userId);
    if (!isPlatformAdmin(user.platformRole)) {
      throw new ForbiddenException("Ação restrita a administradores da BoraFest");
    }
    return user;
  }
}
