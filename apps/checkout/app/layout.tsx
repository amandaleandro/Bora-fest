import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { SiteFooter, SiteFrame, SiteHeader } from "../components/SiteChrome";
import { SITE_URL } from "../lib/config";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "BoraFest", template: "%s" },
  description: "Compre seu ingresso sem precisar de conta ou aplicativo.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#f6f5fb",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={jakarta.variable}>
      <body className="font-sans">
        <SiteHeader />
        {/* mobile: moldura 430px · desktop: as páginas controlam a largura · portaria: sem moldura */}
        <SiteFrame>{children}</SiteFrame>
        <SiteFooter />
        {/* SW só em produção — em dev ele cacheia chunks e confunde o hot reload */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              process.env.NODE_ENV === "production"
                ? `if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");`
                : `if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));`,
          }}
        />
      </body>
    </html>
  );
}
