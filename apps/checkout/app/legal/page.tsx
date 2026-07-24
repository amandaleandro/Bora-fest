"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon, paths } from "../../components/icons";

const PRIVACIDADE = [
  ["O que coletamos", "Nome, e-mail, celular e dados do pedido — o mínimo para emitir e entregar seus ingressos. CPF só quando o evento exigir (meia-entrada ou controle de acesso)."],
  ["Como usamos", "Emitir ingressos, enviar por e-mail/WhatsApp, prevenir fraude e cumprir obrigações fiscais. Marketing só com o seu opt-in explícito."],
  ["Com quem compartilhamos", "Produtor do evento (lista de participantes), processador de pagamento e provedores de mensageria — sempre o mínimo necessário."],
  ["Seus direitos (LGPD — Lei 13.709/2018)", "Acessar, corrigir, portar (Baixar meus dados no perfil), revogar consentimentos e excluir sua conta a qualquer momento."],
  ["Exclusão de conta", "Solicitada no perfil, remove seus dados pessoais em até 30 dias. Registros financeiros são mantidos anonimizados por obrigação legal."],
  ["Segurança", "Criptografia em trânsito e em repouso, acesso restrito por função e trilha de auditoria em toda ação sensível."],
];

const TERMOS = [
  ["O serviço", "A BoraFest intermedia a venda de ingressos entre você e o produtor do evento. O evento é de responsabilidade do produtor."],
  ["Taxas", "A taxa de serviço é exibida desde a seleção do ingresso — sem surpresa no fim do checkout."],
  ["Reembolso (CDC art. 49)", "Compras feitas pela internet podem ser canceladas em até 7 dias. Cancelamento de evento gera reembolso integral."],
  ["Meia-entrada (Lei 12.933/2013)", "Estudantes e demais beneficiários pagam metade do preço, com documento conferido na portaria."],
  ["Transferência", "Ingressos podem ser transferidos pela carteira; o QR anterior é invalidado na hora."],
  ["Fraude", "QR codes são assinados digitalmente. Cópias e prints não passam na validação."],
];

function LegalContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"privacidade" | "termos">(
    searchParams.get("aba") === "termos" ? "termos" : "privacidade",
  );
  const sections = tab === "privacidade" ? PRIVACIDADE : TERMOS;

  return (
    <main className="px-5 pb-16 pt-6">
      <header className="flex items-center gap-3">
        <button onClick={() => router.back()} aria-label="Voltar" className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface"><Icon d={paths.back} /></button>
        <h1 className="text-[20px] font-extrabold">Privacidade & Termos</h1>
      </header>

      <div className="mt-5 flex rounded-2xl bg-line p-1">
        {([["privacidade", "Privacidade"], ["termos", "Termos de Uso"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={`flex-1 rounded-xl py-2.5 text-[13px] font-bold ${tab === key ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {sections.map(([title, body]) => (
          <section key={title} className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="text-[14px] font-extrabold">{title}</h2>
            <p className="mt-1.5 text-[13px] font-medium leading-relaxed text-ink-soft">{body}</p>
          </section>
        ))}
      </div>

      <p className="mt-6 text-center text-[12px] font-medium text-muted">
        Encarregado de dados (DPO): <span className="font-bold">privacidade@borafest.com</span>
      </p>
    </main>
  );
}

export default function LegalPage() {
  return (
    <Suspense>
      <LegalContent />
    </Suspense>
  );
}
