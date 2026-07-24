"use client";

import { useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";

const FAQ: Array<{ question: string; answer: string }> = [
  {
    question: "Quando eu recebo o dinheiro das vendas?",
    answer:
      "As vendas ficam disponíveis no seu saldo assim que o pagamento é aprovado, descontada a taxa da plataforma. O repasse para sua conta bancária pode ser solicitado na tela Financeiro, respeitando o prazo do meio de pagamento (Pix costuma liberar mais rápido que cartão).",
  },
  {
    question: "Como funciona o reembolso de um pedido?",
    answer:
      "Você pode estornar um pedido total ou parcialmente pela tela de Vendas. Em reembolsos parciais, só o valor escolhido é debitado do seu saldo e os ingressos continuam válidos; no reembolso total, o pedido é cancelado e os ingressos são invalidados.",
  },
  {
    question: "Como faço o check-in dos participantes no dia do evento?",
    answer:
      "Cadastre os portões e gere as credenciais (PIN) na tela Portaria. A equipe usa o app de validação para escanear o QR do ingresso; o painel mostra o check-in ao vivo com o total de presentes e o ritmo de entrada por portão.",
  },
  {
    question: "Posso emitir ingressos gratuitos para convidados?",
    answer:
      "Sim, na página do evento há a seção Cortesias: escolha o lote, a quantidade e os dados do convidado. O ingresso é emitido sem cobrança e aparece normalmente em Participantes.",
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
    <main>
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
          Fale com o nosso suporte: <span className="font-bold text-primary">suporte@borafest.com</span>
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
