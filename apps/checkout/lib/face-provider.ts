export interface BrowserFaceBridge {
  enroll(args: { provider: string; ticketId: string }): Promise<{ providerReference: string }>;
}

declare global {
  interface Window {
    BoraFestFace?: BrowserFaceBridge;
  }
}

export function isBrowserFaceBridgeAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.BoraFestFace?.enroll === "function";
}

export async function captureEnrollmentReference(provider: string, ticketId: string): Promise<string> {
  if (!isBrowserFaceBridgeAvailable()) {
    throw new Error("O provedor facial ainda não está disponível neste navegador");
  }
  const result = await window.BoraFestFace!.enroll({ provider, ticketId });
  if (!result?.providerReference) {
    throw new Error("O provedor facial não retornou uma referência válida");
  }
  return result.providerReference;
}
