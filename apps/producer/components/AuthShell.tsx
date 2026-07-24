// Split-screen do protótipo: painel esquerdo dark com marca + form à direita.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-1/2 flex-col justify-between bg-gradient-to-br from-sidebar to-[#2b1157] p-12 text-white lg:flex">
        <p className="text-[20px] font-extrabold">BoraFest</p>
        <div>
          <h1 className="max-w-md text-[34px] font-extrabold leading-tight">
            A ticketeria que não trava as suas vendas.
          </h1>
          <ul className="mt-8 space-y-3 text-[14px] font-semibold text-white/85">
            {[
              "Venda liberada na hora — a verificação roda em segundo plano",
              "Vendas e check-in em tempo real",
              "Pix embutido no checkout, sem redirecionar",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success text-[11px]">✓</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[12px] font-medium text-white/60">
          <a href="http://localhost:3000/legal?aba=termos" className="underline">Termos</a> ·{" "}
          <a href="http://localhost:3000/legal" className="underline">Privacidade (LGPD)</a>
        </p>
      </aside>
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[370px]">{children}</div>
      </main>
    </div>
  );
}

export const inputCls =
  "mt-1 h-[48px] w-full rounded-xl border-[1.5px] border-line-input bg-surface px-4 text-[14px] font-medium outline-none focus:border-primary";
export const labelCls = "text-[12px] font-bold text-ink-soft";
export const primaryBtn =
  "mt-5 h-12 w-full rounded-xl bg-primary text-[14px] font-extrabold text-white shadow-cta disabled:bg-[#d9d2e8] disabled:shadow-none";
