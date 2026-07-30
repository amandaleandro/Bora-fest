/**
 * Câmera + leitura de QR. Usa `BarcodeDetector` quando existe (Chrome/Android)
 * e cai no jsQR sobre frames de um canvas quando não existe (Safari/iOS).
 * Se a câmera falhar ou for negada, quem chama segue para a busca manual —
 * a operação nunca trava (handoff v2, decisão 7).
 */

export type ScannerEngine = "barcode-detector" | "jsqr";

export interface ScannerHandle {
  engine: ScannerEngine;
  torchAvailable: boolean;
  setTorch(on: boolean): Promise<boolean>;
  stop(): void;
}

export class CameraError extends Error {
  constructor(
    public kind: "DENIED" | "UNAVAILABLE",
    message: string,
  ) {
    super(message);
  }
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

async function pickEngine(): Promise<{ engine: ScannerEngine; detector?: BarcodeDetectorLike }> {
  const Ctor = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector;
  if (Ctor) {
    try {
      const formats: string[] = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
      if (formats.includes("qr_code")) {
        return { engine: "barcode-detector", detector: new Ctor({ formats: ["qr_code"] }) };
      }
    } catch {
      /* segue para o jsQR */
    }
  }
  return { engine: "jsqr" };
}

export async function startScanner(
  video: HTMLVideoElement,
  onDecode: (raw: string) => void,
): Promise<ScannerHandle> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new CameraError("UNAVAILABLE", "Este navegador não expõe a câmera");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      audio: false,
    });
  } catch (error) {
    const name = (error as { name?: string })?.name ?? "";
    throw new CameraError(
      name === "NotAllowedError" || name === "SecurityError" ? "DENIED" : "UNAVAILABLE",
      "Não foi possível abrir a câmera",
    );
  }

  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;
  try {
    await video.play();
  } catch {
    /* alguns navegadores só liberam o play após gesto; o loop segue tentando */
  }

  const { engine, detector } = await pickEngine();
  const track = stream.getVideoTracks()[0];
  const capabilities = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
  const torchAvailable = Boolean(capabilities.torch);

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let jsQr: typeof import("jsqr").default | null = null;
  let stopped = false;
  let frame = 0;
  let lastRun = 0;

  async function tick(now: number) {
    if (stopped) return;
    frame = requestAnimationFrame(tick);
    // ~12 leituras/s: suficiente para a portaria e leve o bastante para o iPhone
    if (now - lastRun < 80) return;
    lastRun = now;
    if (video.readyState < 2 || video.videoWidth === 0) return;

    try {
      if (engine === "barcode-detector" && detector) {
        const codes = await detector.detect(video);
        if (codes.length > 0 && codes[0].rawValue) {
          onDecode(codes[0].rawValue);
        }
        return;
      }

      if (!context) return;
      if (!jsQr) {
        jsQr = (await import("jsqr")).default;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQr(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
      if (found?.data) onDecode(found.data);
    } catch {
      /* frame ruim ou jsQR indisponível: tenta no próximo */
    }
  }

  frame = requestAnimationFrame(tick);

  return {
    engine,
    torchAvailable,
    async setTorch(on: boolean) {
      if (!torchAvailable || !track) return false;
      try {
        // `torch` ainda não está no lib.dom; a capability foi conferida acima
        const constraints = { advanced: [{ torch: on }] } as unknown as MediaTrackConstraints;
        await track.applyConstraints(constraints);
        return true;
      } catch {
        return false;
      }
    },
    stop() {
      stopped = true;
      cancelAnimationFrame(frame);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
