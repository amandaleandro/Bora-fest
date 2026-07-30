import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";

export const metadata: Metadata = {
  title: "BoraFest — Backoffice",
  description: "Plataforma de Gestão e Operações BoraFest",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="antialiased selection:bg-brand selection:text-white">
        <AuthProvider>
          <div className="mx-auto min-h-screen max-w-7xl px-4 sm:px-6 lg:px-8 py-6">{children}</div>
        </AuthProvider>
      </body>
    </html>
  );
}
