import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { prisma } from "@borafest/database";
import { verifyDeviceToken } from "@borafest/auth";

/**
 * Autentica o aparelho de check-in: headers `x-device-id` + `x-device-token`.
 * Dispositivo BLOCKED é cortado imediatamente (bloqueio remoto, §12).
 * Anexa `request.validatorDevice` com escopo do evento.
 */
@Injectable()
export class ValidatorDeviceGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const deviceId: string | undefined = request.headers["x-device-id"];
    const token: string | undefined = request.headers["x-device-token"];

    if (!deviceId || !token) {
      throw new UnauthorizedException("Credenciais do dispositivo ausentes");
    }

    const device = await prisma.validatorDevice.findUnique({
      where: { id: deviceId },
      include: { credential: true },
    });

    if (
      !device ||
      device.status !== "ACTIVE" ||
      !device.credential.active ||
      (device.credential.expiresAt && device.credential.expiresAt.getTime() < Date.now()) ||
      !verifyDeviceToken(token, device.tokenHash)
    ) {
      throw new UnauthorizedException("Dispositivo não autorizado");
    }

    request.validatorDevice = device;

    // best-effort; não bloqueia a requisição
    prisma.validatorDevice
      .update({ where: { id: device.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);

    return true;
  }
}
