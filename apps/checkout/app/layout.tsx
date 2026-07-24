import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { SiteHeader, SiteFooter } from "../components/SiteChrome";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  title: "BoraFest",
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
        {/* mobile: moldura 430px · desktop: as páginas controlam a largura */}
        <div className="mx-auto min-h-dvh w-full max-w-[430px] bg-bg lg:max-w-none">{children}</div>
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
