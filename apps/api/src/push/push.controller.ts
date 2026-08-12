import { Controller, Get } from "@nestjs/common";

/**
 * Chave pública VAPID para o PWA se inscrever no Web Push. A chave PÚBLICA não é
 * segredo (vai para o navegador de qualquer forma) — expor por endpoint evita
 * depender de build-arg do Next e funciona em runtime. A privada NUNCA sai daqui.
 */
@Controller("v1/push")
export class PushController {
  @Get("vapid-public-key")
  vapidPublicKey() {
    return { publicKey: process.env.VAPID_PUBLIC_KEY ?? null };
  }
}
