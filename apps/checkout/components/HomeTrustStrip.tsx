import Link from "next/link";

const itens = [
  ["Compra simples", "Escolha o ingresso, pague e receba o acesso sem instalar aplicativo."],
  ["Pagamento rastreável", "O status do pedido acompanha a confirmação do pagamento e a emissão do ingresso."],
  ["Entrada preparada", "QR Code individual e operação de portaria conectada ao mesmo evento."],
];

export function HomeTrustStrip() {
  return (
    <section className="mx-auto max-w-[1160px] px-5 pb-10 lg:px-6 lg:pb-14">
      <div className="rounded-3xl border border-line bg-surface p-5 lg:p-7">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[.14em] text-primary">Do ingresso à entrada</p>
            <h2 className="mt-1 text-[21px] font-extrabold tracking-tight lg:text-[26px]">Compre sem complicação.</h2>
          </div>
          <Link href="/minhas-compras" className="text-[13px] font-extrabold text-primary">
            Acessar minhas compras →
          </Link>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {itens.map(([titulo, texto]) => (
            <div key={titulo} className="rounded-2xl border border-line bg-bg p-4">
              <p className="text-[14px] font-extrabold">{titulo}</p>
              <p className="mt-1 text-[12.5px] font-medium leading-relaxed text-muted">{texto}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
