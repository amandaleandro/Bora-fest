import { NativeModules } from "react-native";

type BoraFestFaceBridge = {
  captureProbe(args: { provider: string; ticketId: string }): Promise<{
    probeReference: string;
  }>;
};

function bridge(): BoraFestFaceBridge | null {
  const candidate = (NativeModules as Record<string, unknown>).BoraFestFace as BoraFestFaceBridge | undefined;
  return candidate && typeof candidate.captureProbe === "function" ? candidate : null;
}

export function isFaceBridgeAvailable(): boolean {
  return Boolean(bridge());
}

export async function captureFaceProbe(provider: string, ticketId: string): Promise<string> {
  const native = bridge();
  if (!native) {
    throw new Error("SDK facial não instalado neste build da portaria");
  }
  const result = await native.captureProbe({ provider, ticketId });
  if (!result?.probeReference) {
    throw new Error("O SDK facial não retornou uma referência válida");
  }
  return result.probeReference;
}
