import { PRIVACY_URL, TERMS_URL } from "@/lib/config";

// Split-screen do protótipo: painel esquerdo dark com marca + form à direita.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-sidebar to-[#4A0B3C] p-12 text-white lg:flex">
        {/* brilho da marca: vida sem gritar (temperatura profissional) */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-gradient opacity-20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-brand-gradient opacity-10 blur-3xl" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-horizontal-escuro.svg" alt="BoraFest" className="relative h-10 w-auto self-start" />
        <div className="relative">
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
        <p className="relative text-[12px] font-medium text-white/60">
          <a href={TERMS_URL} className="underline">Termos</a> ·{" "}
          <a href={PRIVACY_URL} className="underline">Privacidade (LGPD)</a>
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
  "mt-5 h-12 w-full rounded-xl bg-primary text-[14px] font-extrabold text-white shadow-cta disabled:bg-[#ecd6e4] disabled:text-muted disabled:shadow-none";
