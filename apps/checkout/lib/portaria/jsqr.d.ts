/**
 * Tipos mínimos do jsQR (fallback de leitura no Safari, onde não há
 * BarcodeDetector). Declarado aqui para o typecheck não depender do install.
 */
declare module "jsqr" {
  interface QRCode {
    data: string;
    binaryData: number[];
  }
  export default function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" },
  ): QRCode | null;
}
