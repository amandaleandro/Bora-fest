import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});
import { AuthProvider } from "@/lib/auth";

export const metadata: Metadata = {
  title: "BoraFest — Painel do produtor",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={jakarta.variable}>
      <body className="font-sans bg-bg text-ink">
        <AuthProvider>
          <div className="mx-auto min-h-screen max-w-4xl px-4">{children}</div>
        </AuthProvider>
      </body>
    </html>
  );
}
