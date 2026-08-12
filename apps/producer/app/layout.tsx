import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { PushSetup } from "@/components/PushSetup";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  title: "BoraFest — Painel do produtor",
  description: "Gerencie eventos, vendas e receba avisos de venda em tempo real.",
  manifest: "/manifest.json",
  // iOS: instalável na tela inicial (pré-requisito do Web Push no Safari).
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Painel",
  },
  icons: {
    apple: "/icons/apple-touch-icon-180.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#D9128F",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={jakarta.variable}>
      <body className="font-sans bg-bg text-ink">
        <AuthProvider>{children}</AuthProvider>
        <PushSetup />
      </body>
    </html>
  );
}
