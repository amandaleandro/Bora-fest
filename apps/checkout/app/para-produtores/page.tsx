import Link from "next/link";

const PANEL = process.env.NEXT_PUBLIC_PANEL_URL ?? "http://localhost:3001";

const recursos = [
  ["Ingressos e lotes", "Crie lotes, acompanhe disponibilidade e venda online com taxas transparentes."],
  ["Promoters e listas", "Saiba quem vendeu, quem cadastrou convidados e quantas pessoas realmente entraram."],
  ["Portaria offline", "Valide QR Code, nome, CPF e código mesmo quando a internet do evento falhar."],
  ["PDV na porta", "Venda presencialmente por Pix ou dinheiro e libere a entrada no mesmo fluxo."],
  ["VIP e reservas", "Organize áreas VIP, disponibilidade, sinal, saldo e acompanhamento da reserva."],
  ["Financeiro", "Acompanhe vendas, taxas, reembolsos e valores do evento com rastreabilidade."],
];

const segmentos = [
  "Atléticas e festas universitárias",
  "Boates e casas noturnas",
  "Casas de show",
  "Produtoras e festivais",
  "Eventos esportivos",
  "Bares e eventos recorrentes",
];

export const metadata = {
  title: "BoraFest para produtores",
  description: "Venda ingressos, organize promoters, listas, VIP, portaria e financeiro do seu evento em um só lugar.",
};

export default function ParaProdutoresPage() {
  return (
    <main className="bg-bg text-ink">
      <section className="mx-auto max-w-[1160px] px-5 py-14 lg:px-6 lg:py-24">
        <div className="max-w-3xl">
          <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-[12px] font-extrabold text-primary">
            BoraFest para produtores
          </span>
          <h1 className="mt-5 text-[38px] font-extrabold leading-[1.05] tracking-tight lg:text-[58px]">
            Venda, opere a portaria e entenda seu evento em um só lugar.
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] font-medium leading-relaxed text-muted lg:text-[18px]">
            O BoraFest conecta a venda ao que acontece no dia do evento: promoters, listas, VIP, PDV, check-in e financeiro sem depender de várias ferramentas separadas.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href={`${PANEL}/cadastro`} className="rounded-2xl bg-primary px-6 py-3.5 text-center text-[14px] font-extrabold text-white shadow-cta">
              Criar conta de produtor
            </a>
            <a href={`${PANEL}/login`} className="rounded-2xl border border-line-input bg-surface px-6 py-3.5 text-center text-[14px] font-extrabold text-ink">
              Entrar no painel
            </a>
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[1160px] px-5 py-14 lg:px-6 lg:py-20">
          <div className="max-w-2xl">
            <p className="text-[12px] font-extrabold uppercase tracking-[0.18em] text-primary">Operação completa</p>
            <h2 className="mt-3 text-[28px] font-extrabold tracking-tight lg:text-[38px]">Mais que um checkout de ingresso.</h2>
            <p className="mt-3 text-[15px] font-medium leading-relaxed text-muted">
              A venda é só o começo. O painel foi pensado para acompanhar o evento até a última entrada na portaria.
            </p>
          </div>
          <div className="mt-9 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {recursos.map(([titulo, descricao]) => (
              <article key={titulo} className="rounded-3xl border border-line bg-bg p-6">
                <h3 className="text-[17px] font-extrabold">{titulo}</h3>
                <p className="mt-2 text-[13.5px] font-medium leading-relaxed text-muted">{descricao}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1160px] px-5 py-14 lg:px-6 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-start">
          <div>
            <p className="text-[12px] font-extrabold uppercase tracking-[0.18em] text-primary">Para quem produz</p>
            <h2 className="mt-3 text-[28px] font-extrabold tracking-tight lg:text-[38px]">Feito para operações diferentes.</h2>
            <p className="mt-3 text-[15px] font-medium leading-relaxed text-muted">
              Use somente o que fizer sentido para o seu evento e mantenha a equipe trabalhando no mesmo fluxo.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {segmentos.map((segmento) => (
              <div key={segmento} className="rounded-2xl border border-line bg-surface px-4 py-4 text-[14px] font-bold">
                <span className="mr-2 text-success">✓</span>{segmento}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1160px] px-5 pb-16 lg:px-6 lg:pb-24">
        <div className="rounded-[32px] bg-brand-gradient px-6 py-10 text-white lg:px-12 lg:py-12">
          <div className="flex flex-col justify-between gap-7 lg:flex-row lg:items-center">
            <div className="max-w-2xl">
              <h2 className="text-[28px] font-extrabold tracking-tight lg:text-[36px]">Seu próximo evento pode rodar no BoraFest.</h2>
              <p className="mt-2 text-[14px] font-medium text-white/80">
                Crie a organização, cadastre o evento e configure os lotes pelo painel do produtor.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a href={`${PANEL}/cadastro`} className="rounded-2xl bg-white px-6 py-3.5 text-center text-[14px] font-extrabold text-primary">
                Começar agora
              </a>
              <Link href="/" className="rounded-2xl border border-white/30 px-6 py-3.5 text-center text-[14px] font-extrabold text-white">
                Ver eventos
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
