"use client";

import { useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { CHECKOUT_URL } from "@/lib/config";

/** Endereço da portaria como o produtor digita no celular (ex.: borafest.com.br/portaria). */
const PORTARIA = `${CHECKOUT_URL.replace(/^https?:\/\//, "").replace(/\/$/, "")}/portaria`;

/**
 * FAQ revisado em 2026-10-12 contra o código: o dinheiro NÃO cai no saldo
 * "assim que o pagamento é aprovado" (libera D+2 úteis após o fim do evento —
 * packages/payments apply-status), o Pix do saque é feito pela equipe, e não
 * existe "app de validação": a portaria é a página /portaria do site.
 */
const FAQ: Array<{ question: string; answer: string }> = [
  {
    question: "Quando eu recebo o dinheiro das vendas?",
    answer:
      "O valor de cada venda online e de cada Pix na porta (o que fica para você, sem a taxa da BoraFest) entra no seu saldo e é liberado para saque 2 dias úteis depois do fim do evento — é a garantia para devolver o dinheiro se o evento não acontecer. Com saldo liberado, peça o saque em Financeiro: a equipe BoraFest faz o Pix para a conta cadastrada, sem tarifa, e o repasse aparece como Pago ali mesmo. O primeiro saque da casa passa por análise. Antes da liberação dá para antecipar até 80% do valor ainda não liberado, com taxa de antecipação e análise. Casas com repasse instantâneo combinado com a BoraFest sacam antes da liberação, pagando a taxa de antecipação. Para sacar, o cadastro da produtora precisa estar aprovado pela BoraFest e ter uma conta bancária no Financeiro. Venda em dinheiro na porta não passa pela BoraFest: o valor fica com quem vendeu e o acerto é feito pelo Fechamento de caixa, sem taxa.",
  },
  {
    question: "Como funciona o reembolso de um pedido?",
    answer:
      "Você pode estornar um pedido total ou parcialmente pela tela de Vendas. Em reembolsos parciais, só o valor escolhido é debitado do seu saldo e os ingressos continuam válidos; no reembolso total, o pedido é cancelado e os ingressos são invalidados.",
  },
  {
    question: "Como faço o check-in dos participantes no dia do evento?",
    answer: `Na aba Check-in do evento, cadastre os portões e gere um PIN para a equipe. No dia, a equipe abre ${PORTARIA} no celular (não precisa instalar nada), escolhe o evento e digita o PIN — ou entra com a própria conta BoraFest, se ela está na sua equipe como Administrador, Check-in ou Vendedor. Dá para escanear o QR do ingresso ou buscar pelo código. O painel mostra o check-in ao vivo com o total de presentes e o ritmo de entrada por portão.`,
  },
  {
    question: "Posso dar entrada grátis?",
    answer:
      "Sim, sempre antes do evento: (1) um ingresso com preço R$ 0, que aparece no site e a pessoa garante sem pagar; (2) Cortesias, na página do evento: escolha o lote, a quantidade e os dados do convidado — o ingresso sai sem cobrança e aparece normalmente em Participantes; (3) a Lista de convidados. Na porta não sai cortesia: o balcão só vende ingresso pago.",
  },
  {
    question: "Como funciona a lista de convidados?",
    answer:
      "Na página do evento, abra Lista de convidados e cadastre o nome e o CPF de cada pessoa. O CPF é obrigatório porque o convidado não recebe ingresso: na portaria, a equipe confere pelo nome ou CPF. Cada convidado ocupa uma vaga do lote escolhido. A lista fecha quando o evento começa.",
  },
  {
    question: "Como cancelo um ingresso grátis?",
    answer:
      "Em Vendas, abra o pedido de R$ 0 e toque em Cancelar ingresso (pedido grátis não tem reembolso, porque não houve pagamento). O QR deixa de valer, a vaga volta para o lote e a pessoa recebe um e-mail avisando, quando o pedido tem e-mail. Ingresso que já foi usado na entrada continua como está.",
  },
  // Perguntas de 2026-10-12, conferidas contra o código do dia (editar/page,
  // LoteDoIngresso, convites-email, orders.service, checkins.service,
  // etiquetas-porta, catalog.service e relatorio-meia).
  {
    question: "Como deixo um evento privado?",
    answer:
      "Em Editar evento, ligue Evento privado. Ele sai da home, da busca, da página da Casa e do Google e só abre por link — quem tem o link compra normalmente. Ele também não aparece na agenda dos promoters: mande a cada um o link desta festa, na aba Promoters. Quando você abre ao público um evento que já está publicado, os seguidores da Casa recebem um aviso (uma vez só).",
  },
  {
    question: "Como vendo um ingresso só para quem tem o link?",
    answer:
      "Na aba Ingressos, ao criar ou editar o lote, escolha em Quem pode pegar a opção Só com o link de convite. O lote some do site e só aparece para quem abrir o link dele — copie em Link de convite. Se o link vazar, toque em Trocar link: o antigo para de funcionar na hora, e quem já pegou o ingresso continua com ele.",
  },
  {
    question: "Como convido pessoas por e-mail?",
    answer:
      "No lote, escolha em Quem pode pegar a opção Só quem eu convidar por e-mail. Depois, em Convidar por e-mail, cole os endereços (até 200 por envio). Cada pessoa recebe um link pessoal, e o ingresso só sai para o e-mail convidado. A tela mostra a situação de cada convite e deixa reenviar ou revogar. Revogar não tira o ingresso de quem já pegou — para isso, cancele o pedido em Vendas.",
  },
  {
    question: "Para que servem o código e a cota do promoter?",
    answer:
      "Na aba Promoters do evento você define, para cada promoter, um código pessoal (ex.: BIA10, de 3 a 16 letras ou números) e a cota de convidados. O comprador digita o código no checkout e a venda conta para o promoter mesmo sem o link; se ele chegou pelo link de um promoter, vale o link. A cota é quantos convidados o promoter pode pôr na lista de cada evento — 0 = nenhum.",
  },
  {
    question: "Registrei uma entrada por engano. Como desfaço?",
    answer:
      "Na porta, o próprio aparelho que registrou desfaz em até 10 minutos: Resumo da portaria → Últimas entradas → Reverter. Depois disso, ou se foi em outro aparelho, o dono ou um administrador da Casa desfaz na aba Check-in do evento, em Desfazer entrada. O ingresso volta a valer — a não ser que o pedido tenha sido cancelado ou reembolsado; aí a entrada continua registrada.",
  },
  {
    question: "O que significam MEIA-ENTRADA e GRATUITO na porta?",
    answer:
      "São etiquetas que aparecem quando a entrada é liberada, com ou sem internet. MEIA-ENTRADA · peça o documento: o ingresso foi comprado como meia — confira o documento do benefício. GRATUITO: ingresso de R$ 0 que não veio da lista de convidados (por exemplo, lote grátis ou cupom de 100%). Quem está na lista continua aparecendo como CONVIDADO ou CORTESIA.",
  },
  {
    question: "Como funciona a virada automática de lote?",
    answer:
      "Ao criar ou editar um lote, ligue Abrir quando o lote anterior esgotar e escolha o lote anterior do mesmo ingresso. O novo lote fica guardado, fora do site, e abre sozinho quando o anterior esgotar ou for encerrado.",
  },
  {
    question: "Onde tiro o relatório de meia-entrada?",
    answer:
      "Em Vendas, toque em Exportar meia-entrada (CSV): sai um ingresso de meia por linha, com data da compra, tipo, lote, participante, código, canal (site ou porta), situação e pedido. As planilhas de pedidos e de participantes também têm a coluna meia.",
  },
  {
    question: "Como crio cupons de desconto?",
    answer:
      "Na página do evento, seção Cupons, você define o código, o tipo de desconto (percentual ou valor fixo) e um limite de usos opcional. O desconto é aplicado automaticamente quando o comprador digita o código no checkout.",
  },
  {
    question: "Meu evento não aparece para o público, o que fazer?",
    answer:
      "Confira se o evento está com status Publicado na página do evento. Eventos em rascunho ou despublicados não aparecem no hotsite. Você pode publicar, pausar vendas ou republicar a qualquer momento.",
  },
  {
    question: "Como divulgo meu evento?",
    answer:
      "Use a tela Divulgue dentro do evento para copiar o link público ou um texto pronto para compartilhar no WhatsApp, X e Facebook.",
  },
];

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left text-[15px] font-extrabold"
      >
        {question}
        <span className="ml-4 text-muted">{open ? "−" : "+"}</span>
      </button>
      {open ? <p className="mt-3 text-[13px] font-semibold leading-relaxed text-muted">{answer}</p> : null}
    </div>
  );
}

function AjudaContent() {
  return (
    <main className="mx-auto w-full max-w-[900px] px-5 pb-10">
      <Nav />
      <div className="mt-6">
        <h1 className="text-[22px] font-extrabold">Ajuda</h1>
        <p className="mt-1 text-[13px] font-semibold text-muted">
          Perguntas frequentes de quem organiza eventos na BoraFest.
        </p>
      </div>

      <div className="mt-5 space-y-3">
        {FAQ.map((item) => (
          <FaqItem key={item.question} question={item.question} answer={item.answer} />
        ))}
      </div>

      <section className="mt-5 rounded-2xl border border-line bg-surface p-6 text-center">
        <p className="text-[15px] font-extrabold">Não encontrou o que precisava?</p>
        <p className="mt-1 text-[13px] font-semibold text-muted">
          Fale com o nosso suporte: <span className="font-bold text-primary">suporte@borafest.com.br</span>
        </p>
      </section>
    </main>
  );
}

export default function AjudaPage() {
  return (
    <AuthGuard>
      <AjudaContent />
    </AuthGuard>
  );
}
