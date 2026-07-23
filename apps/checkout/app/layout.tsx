import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BoraFest",
  description: "Compre seu ingresso sem precisar de conta ou aplicativo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="mx-auto min-h-screen max-w-xl">{children}</div>
      </body>
    </html>
  );
}
