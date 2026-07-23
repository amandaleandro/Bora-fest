import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";

export const metadata: Metadata = {
  title: "BoraFest — Painel do produtor",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AuthProvider>
          <div className="mx-auto min-h-screen max-w-4xl px-4">{children}</div>
        </AuthProvider>
      </body>
    </html>
  );
}
