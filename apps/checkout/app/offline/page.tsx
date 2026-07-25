"use client";

import Link from "next/link";
import { Icon, paths } from "../../components/icons";

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-8 text-center lg:mx-auto lg:max-w-[520px]">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-line text-muted lg:h-[120px] lg:w-[120px] lg:rounded-[32px] lg:text-muted-4">
        <Icon d={paths.wifiOff} size={36} />
      </div>
      <h1 className="mt-4 text-[20px] font-extrabold">Sem conexão</h1>
      <p className="mt-2 text-[13px] font-medium leading-relaxed text-muted lg:text-[14px]">
        Não conseguimos falar com nossos servidores agora. As telas que você já abriu neste aparelho continuam
        disponíveis — seus ingressos voltam a carregar assim que a conexão retornar.
      </p>
      <button onClick={() => location.reload()} className="mt-6 h-14 w-full rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta">
        Tentar novamente
      </button>
      <Link href="/minhas-compras" className="mt-3 flex h-12 w-full items-center justify-center rounded-2xl border-[1.5px] border-line-input text-[14px] font-bold text-primary">
        Ver ingressos salvos
      </Link>
    </main>
  );
}
