import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Portaria — BoraFest",
  description: "App de validação de ingressos na entrada do evento.",
};

// a portaria é um app: barra do sistema escura e sem zoom acidental no portão
export const viewport: Viewport = {
  themeColor: "#0b0910",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

/**
 * Shell standalone da portaria: fundo escuro cobrindo 100% da viewport em
 * qualquer tela. No mobile a coluna ocupa tudo; no desktop ela vira uma
 * "moldura de celular" (~420px) centrada sobre o fundo escuro — nunca branco.
 */
export default function PortariaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh w-full bg-bg-dark lg:flex lg:items-center lg:justify-center lg:px-6 lg:py-8">
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-bg-dark lg:h-[844px] lg:min-h-0 lg:w-[420px] lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto lg:rounded-[44px] lg:shadow-[0_48px_96px_-32px_rgba(0,0,0,.9)] lg:ring-1 lg:ring-white/10">
        {children}
      </div>
    </div>
  );
}
