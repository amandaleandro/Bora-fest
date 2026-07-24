import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  title: "BoraFest",
  description: "Compre seu ingresso sem precisar de conta ou aplicativo.",
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
        {/* moldura mobile-first do protótipo (390–430px), centrada no desktop */}
        <div className="mx-auto min-h-dvh w-full max-w-[430px] bg-bg">{children}</div>
      </body>
    </html>
  );
}
