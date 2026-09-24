import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-8 text-center lg:mx-auto lg:max-w-[520px]">
      <p className="text-[13px] font-extrabold uppercase tracking-wider text-primary">Erro 404</p>
      <h1 className="mt-2 text-[22px] font-extrabold">Essa página não existe</h1>
      <p className="mt-2 text-[13px] font-medium leading-relaxed text-muted lg:text-[14px]">
        O link pode estar errado ou o evento saiu do ar. Seus ingressos continuam em Minhas compras.
      </p>
      <Link
        href="/"
        className="mt-6 flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta"
      >
        Ver eventos
      </Link>
      <Link
        href="/minhas-compras"
        className="mt-3 flex h-12 w-full items-center justify-center rounded-2xl border-[1.5px] border-line-input text-[14px] font-bold text-primary"
      >
        Minhas compras
      </Link>
    </main>
  );
}
