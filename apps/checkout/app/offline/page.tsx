"use client";

import Link from "next/link";
import { Icon, paths } from "../../components/icons";

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-line text-muted">
        <Icon d={paths.wifiOff} size={36} />
      </div>
      <h1 className="mt-4 text-[20px] font-extrabold">Sem conexão</h1>
      <p className="mt-2 text-[13px] font-medium text-muted">
        Seus ingressos salvos continuam disponíveis — o QR funciona offline na portaria.
      </p>
      <button onClick={() => location.reload()} className="mt-6 h-14 w-full rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta">
        Tentar novamente
      </button>
      <Link href="/minhas-compras" className="mt-3 flex h-12 w-full items-center justify-center rounded-2xl border-[1.5px] border-line-input text-[14px] font-bold">
        Ver ingressos salvos
      </Link>
    </main>
  );
}
