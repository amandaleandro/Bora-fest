export default function EventPublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-[1160px] gap-3 px-5 py-6 lg:grid-cols-3 lg:px-6 lg:py-8">
          <div className="rounded-2xl border border-line bg-bg p-4">
            <p className="text-[13px] font-extrabold text-ink">Pagamento acompanhado</p>
            <p className="mt-1 text-[12px] font-medium leading-relaxed text-muted">O pedido só avança conforme a confirmação do pagamento e a emissão do ingresso.</p>
          </div>
          <div className="rounded-2xl border border-line bg-bg p-4">
            <p className="text-[13px] font-extrabold text-ink">QR Code individual</p>
            <p className="mt-1 text-[12px] font-medium leading-relaxed text-muted">Cada ingresso emitido possui um acesso próprio para validação na portaria.</p>
          </div>
          <div className="rounded-2xl border border-line bg-bg p-4">
            <p className="text-[13px] font-extrabold text-ink">Sem aplicativo obrigatório</p>
            <p className="mt-1 text-[12px] font-medium leading-relaxed text-muted">Você pode comprar, acessar o pedido e apresentar seu ingresso diretamente pelo navegador.</p>
          </div>
        </div>
      </section>
    </>
  );
}
