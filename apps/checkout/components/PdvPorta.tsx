"use client";

/**
 * PDV DA PORTA — tela nova (2026-09-11). Substitui `PortariaVenda`.
 *
 * Princípio: caixa registradora, não formulário. No escuro, com fila e uma mão
 * só, o operador precisa de três coisas na cara: QUAL ingresso, QUANTAS pessoas
 * e o TOTAL — e de dois botões para receber. Tudo o que era campo virou
 * exceção ou saiu:
 *
 * - entrega ("entra agora" / "por e-mail"): saiu. Na porta é sempre agora;
 *   venda de rua é outra operação e ganha tela própria.
 * - e-mail: saiu. Era o que criava vínculo com conta — e o comprador da porta
 *   escaneia, paga e entra, sem conta nenhuma (decisão do Arthur, 2026-09-11).
 * - CPF: só existe se o PROVEDOR de Pix exigir (`getPdvConfig`). Com o Pix no
 *   Mercado Pago a porta vira maquininha: o cliente escaneia o QR no app do
 *   banco e pronto.
 * - nome: fica, mínimo — "o básico necessário".
 *
 * O botão de pagamento É a confirmação. Dinheiro = recebeu, entrou; o acerto
 * vai para o fechamento de caixa. Pix = QR na tela, verde sozinho quando cai.
 *
 * Reuso deliberado (nada de check-in reimplementado): mesmas rotas de venda,
 * mesmo `portariaApi.checkin` da validação, mesmo polling do Pix.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { api, ApiError, type AvailabilityItem, type OrderTicket, type PdvSaleResult } from "../lib/api";
import { portariaApi } from "../lib/portaria/api";
import type { Session } from "../lib/portaria/types";

type Pagamento = "dinheiro" | "pix";
type Fase = "venda" | "pix" | "pronto";

interface Props {
  eventId: string;
  slug?: string;
  accountToken: string | null;
  session: Session;
  gateId?: string;
  gateName?: string;
  online: boolean;
  onCheckedIn?: () => void;
}

interface Resultado {
  pagamento: Pagamento;
  pessoas: number;
  totalCents: number;
  liberadas: number;
  publicToken: string;
  tickets: OrderTicket[];
  /**
   * POR QUE a entrada não fechou (2026-09-12). Antes os dois erros do caminho
   * — buscar ingressos e fazer check-in — eram engolidos por catch vazio, e a
   * tela saía verde dizendo "Pode entrar" com ZERO liberado. Na porta ninguém
   * lê 13px: lê a cor. O operador deixava passar e o ingresso continuava PAGO
   * e NÃO QUEIMADO, com QR vivo.
   */
  motivoFalha?: string;
}

/**
 * O servidor recusa a entrada com um enum. Na porta o operador precisa da AÇÃO,
 * não do código — "OTHER_EVENT" não diz a ele que o portão preso no aparelho é
 * de outro evento, que é a causa mais comum e a mais silenciosa.
 */
function motivoLegivel(result: string, reason?: string): string {
  if (reason === "OTHER_EVENT") return "O portão selecionado é de outro evento — troque o portão";
  if (reason === "NOT_FOUND") return "O servidor não achou este ingresso";
  if (reason === "BAD_SIGNATURE" || reason === "MALFORMED") return "QR não reconhecido pelo servidor";
  if (reason === "EVENT_WITHOUT_KEY") return "Evento sem chave de validação — chame o produtor";
  if (result === "CANCELED") return "Ingresso cancelado";
  if (result === "UNVERIFIED") return "Não deu para verificar a entrada";
  return "O servidor recusou a entrada";
}

function reais(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function soDigitos(v: string): string {
  return v.replace(/\D/g, "");
}
function cpfValido(raw: string): boolean {
  const cpf = soDigitos(raw);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const len of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < len; i += 1) soma += Number(cpf[i]) * (len + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(cpf[len])) return false;
  }
  return true;
}

export default function PdvPorta({ eventId, accountToken, session, gateId, gateName, online, onCheckedIn }: Props) {
  const chaveLote = `bf.pdv.lote.${eventId}`;

  const [lots, setLots] = useState<AvailabilityItem[]>([]);
  const [lotsErro, setLotsErro] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [pixExigeCpf, setPixExigeCpf] = useState(false);
  /** GET /config falhou: mostra o CPF sem exigir, em vez de esconder e travar o Pix */
  const [cfgErro, setCfgErro] = useState(false);

  // MEIA-ENTRADA (2026-09-15): aparece só se o lote permitir, como uma opção
  // tocável a mais na mesma lista — não um checkbox, não um mecanismo à parte.
  // A seleção é composta (lote + inteira/meia) para caber no mesmo estado que
  // já persistia só o lote.
  const [opcaoKey, setOpcaoKey] = useState<string>(() =>
    typeof localStorage !== "undefined" ? localStorage.getItem(chaveLote) ?? "" : "",
  );
  const [qtd, setQtd] = useState(1);
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");

  const [fase, setFase] = useState<Fase>("venda");
  const [ocupado, setOcupado] = useState<null | "registrando" | "gerando-pix" | "liberando">(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pedido, setPedido] = useState<PdvSaleResult | null>(null);
  const [pixCode, setPixCode] = useState<string | null>(null);
  const [pixExpirado, setPixExpirado] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [mostrarRetirada, setMostrarRetirada] = useState(false);

  const paradoRef = useRef(false);
  // CHAVE DE IDEMPOTÊNCIA DA TENTATIVA (2026-09-13): nasce no toque de cobrar,
  // sobrevive ao timeout/retry da MESMA tentativa (o servidor replica a
  // resposta em vez de vender de novo) e morre em nova venda ou quando o
  // pedido muda (lote/quantidade/nome).
  const chaveRef = useRef<string | null>(null);
  // sufixo por FORMA de pagamento (2026-09-15): Pix que falhou e Dinheiro em
  // seguida não podem dividir a mesma chave — o servidor devolvia o pedido
  // pendente do Pix e o cliente pagava em dinheiro sem receber ingresso. Não
  // zera chaveRef na troca: o retry da mesma forma continua protegido.
  function chaveDaTentativa(forma: Pagamento): string {
    if (!chaveRef.current) chaveRef.current = crypto.randomUUID();
    return `${chaveRef.current}:${forma}`;
  }
  const nomeRef = useRef<HTMLInputElement>(null);
  const cpfRef = useRef<HTMLInputElement>(null);

  // --- carga: lotes + configuração da porta ---------------------------------
  const carregar = useCallback(() => {
    if (!accountToken) {
      setLotsErro(true);
      setCarregando(false);
      return;
    }
    setCarregando(true);
    setLotsErro(false);
    Promise.all([api.getPdvLots(eventId, accountToken), api.getPdvConfig(eventId, accountToken).catch(() => null)])
      .then(([items, cfg]) => {
        const vendaveis = items.filter((i) => i.available > 0);
        setLots(vendaveis);
        if (cfg) {
          setPixExigeCpf(cfg.pixExigeCpf);
          setCfgErro(false);
        } else {
          // um blip no 4G aqui escondia o campo de CPF pelo turno inteiro, e o
          // Pix passava a ser recusado com 400 sem a tela ter como pedir o CPF
          setCfgErro(true);
        }
        // opção lembrada: se o lote sumiu, ou era meia num lote que deixou de
        // permitir, cai na inteira do primeiro lote disponível
        setOpcaoKey((atual) => {
          const [lid, half] = atual.split(":");
          const l = vendaveis.find((x) => x.lotId === lid);
          if (l && (half !== "1" || l.halfPriceEnabled)) return atual;
          const primeiro = vendaveis[0];
          return primeiro ? `${primeiro.lotId}:0` : "";
        });
      })
      .catch(() => setLotsErro(true))
      .finally(() => setCarregando(false));
  }, [eventId, accountToken]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (opcaoKey && typeof localStorage !== "undefined") localStorage.setItem(chaveLote, opcaoKey);
  }, [opcaoKey, chaveLote]);

  // cada lote com halfPriceEnabled vira DUAS opções tocáveis — inteira e meia —
  // em vez de um checkbox por cima. Aparece exatamente como qualquer ingresso.
  const opcoes = lots.flatMap((l) => {
    const inteira = { ...l, meia: false, key: `${l.lotId}:0` };
    return l.halfPriceEnabled ? [inteira, { ...l, meia: true, key: `${l.lotId}:1` }] : [inteira];
  });
  const lote = opcoes.find((o) => o.key === opcaoKey) ?? null;
  const maxQtd = lote ? Math.min(20, lote.available) : 1;
  const unitCents = lote ? (lote.meia ? Math.round(lote.priceCents / 2) : lote.priceCents) + lote.feeCents : 0;
  const totalCents = unitCents * qtd;

  // janela do evento: fora dela "entrar agora" queimaria o ingresso
  const diaDoEvento = (() => {
    const ini = session.event.startsAt ? new Date(session.event.startsAt).getTime() : null;
    const fim = session.event.endsAt ? new Date(session.event.endsAt).getTime() : null;
    // data desconhecida NÃO é "porta aberta" (auditoria 2026-09-12): sem data,
    // recusar e dizer — vender às cegas queimaria o ingresso.
    if (ini === null) return false;
    const agora = Date.now();
    return agora >= ini - 12 * 3600_000 && agora <= (fim ?? ini) + 6 * 3600_000;
  })();

  // pedido pendente de um Pix que falhou só vale se nada mudou
  useEffect(() => {
    if (fase === "venda") {
      setPedido(null);
      chaveRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opcaoKey, qtd, nome, cpf]);

  // --- o que trava a venda, por forma de pagamento ----------------------------
  function bloqueio(p: Pagamento): string | null {
    // a decisão "PDV só vende na porta" vira controle aqui (e no servidor)
    if (!diaDoEvento) return "Hoje não tem porta — o PDV só vende no dia do evento.";
    if (!lote) return "Escolha o ingresso.";
    if (p === "pix" && pixExigeCpf && !cpfValido(cpf)) return "Este provedor de Pix exige o CPF para gerar o QR.";
    if (cpf.trim() && !cpfValido(cpf)) return "Esse CPF não confere.";
    if (!online) return "Sem internet — a venda na porta precisa de conexão.";
    if (!accountToken) return "Sessão da conta expirou. Saia e entre de novo.";
    return null;
  }
  const bloqueioBase = bloqueio("dinheiro");

  function payload() {
    const doc = soDigitos(cpf);
    const nomeTrim = nome.trim();
    return {
      ticketLotId: lote!.lotId,
      quantity: qtd,
      // string vazia FALHA a validação do servidor (min 2 chars); omitir é o
      // que faz o nome ser de fato opcional (2026-09-13)
      buyerName: nomeTrim.length >= 2 ? nomeTrim : undefined,
      buyerDocument: doc.length >= 5 ? doc : undefined,
      halfPrice: lote!.meia || undefined,
    };
  }
  function msgErro(e: unknown): string {
    return e instanceof ApiError ? e.message : "Sem conexão. A venda na porta precisa de internet.";
  }

  // --- check-in automático: a MESMA chamada da validação ---------------------
  const liberar = useCallback(
    async (orderId: string, publicToken: string, pagamento: Pagamento, pessoas: number, total: number) => {
      setOcupado("liberando");
      // ingressos nascem no worker (outbox, ~3s): espera com tentativas
      let tickets: OrderTicket[] = [];
      let motivoFalha: string | undefined;
      for (let t = 0; t < 12; t += 1) {
        if (paradoRef.current) return;
        try {
          const r = await api.getPdvOrderTickets(eventId, orderId, accountToken!);
          tickets = r.tickets ?? [];
          if (tickets.length > 0) {
            motivoFalha = undefined;
            break;
          }
        } catch (e) {
          // guardar o motivo, não engolir: é ele que explica a tela âmbar
          motivoFalha = e instanceof ApiError ? e.message : "Sem resposta do servidor";
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (tickets.length === 0 && !motivoFalha) {
        motivoFalha = "A emissão do ingresso não terminou a tempo";
      }
      let liberadas = 0;
      for (const tk of tickets) {
        try {
          const r = await portariaApi.checkin(session, {
            qrToken: tk.qrToken,
            checkinPointId: gateId,
            scannedAt: new Date().toISOString(),
          });
          if (r.result === "VALID") {
            liberadas += 1;
            onCheckedIn?.();
          } else if (r.result === "ALREADY_USED") liberadas += 1;
          else motivoFalha = motivoLegivel(r.result, r.reason);
        } catch (e) {
          // o pagamento vale; o que falhou foi a ENTRADA — e isso precisa
          // chegar na tela. Causa mais comum: portão de outro evento preso no
          // aparelho, que devolve 403 "Portão inválido para este evento".
          motivoFalha = e instanceof ApiError ? e.message : "Sem conexão ao liberar a entrada";
        }
      }
      if (paradoRef.current) return;
      setResultado({ pagamento, pessoas, totalCents: total, liberadas, publicToken, tickets, motivoFalha });
      setOcupado(null);
      setFase("pronto");
    },
    [eventId, accountToken, gateId, onCheckedIn, session],
  );

  /**
   * NOVA TENTATIVA de liberar a entrada, com os ingressos que já existem
   * (2026-09-12). Seguro por construção: o check-in é idempotente e devolve
   * ALREADY_USED para quem já entrou, então repetir não queima nada duas vezes
   * nem cobra de novo — o dinheiro não é tocado aqui.
   */
  const tentarLiberarDeNovo = useCallback(
    async (r: Resultado) => {
      if (ocupado) return;
      paradoRef.current = false;
      setOcupado("liberando");
      let liberadas = 0;
      let motivoFalha: string | undefined;
      for (const tk of r.tickets) {
        try {
          const res = await portariaApi.checkin(session, {
            qrToken: tk.qrToken,
            checkinPointId: gateId,
            scannedAt: new Date().toISOString(),
          });
          if (res.result === "VALID") {
            liberadas += 1;
            onCheckedIn?.();
          } else if (res.result === "ALREADY_USED") liberadas += 1;
          else motivoFalha = motivoLegivel(res.result, res.reason);
        } catch (e) {
          motivoFalha = e instanceof ApiError ? e.message : "Sem conexão ao liberar a entrada";
        }
      }
      setResultado({ ...r, liberadas, motivoFalha });
      setOcupado(null);
    },
    [ocupado, session, gateId, onCheckedIn],
  );

  // --- receber ----------------------------------------------------------------
  async function receberDinheiro() {
    paradoRef.current = false;
    setOcupado("registrando");
    setErro(null);
    try {
      // Pix que ficou pendente segura a vaga no lote: solta antes de vender em
      // dinheiro, senão a mesma pessoa ocupa duas vagas até o Pix expirar
      if (pedido?.orderId) {
        const cancelamento = await api.cancelPdvPixSale(eventId, pedido.orderId, accountToken!);
        if (!cancelamento.canceled) {
          throw new Error("Este Pix já foi pago ou não pôde ser cancelado. Confira o pagamento antes de receber em dinheiro.");
        }
        setPedido(null);
      }
      const venda = await api.createPdvCashSale(eventId, payload(), accountToken!, chaveDaTentativa("dinheiro"));
      await liberar(venda.orderId, venda.publicToken, "dinheiro", qtd, totalCents);
    } catch (e) {
      // a chave da tentativa FICA: tocar de novo replica a mesma venda no
      // servidor (idempotente) em vez de criar uma segunda paga
      setErro(e instanceof Error ? e.message : "Sem resposta do servidor. Toque de novo — a venda não será duplicada.");
      setOcupado(null);
    }
  }

  async function receberPix() {
    paradoRef.current = false;
    setOcupado("gerando-pix");
    setErro(null);
    setPixExpirado(false);
    try {
      // retry reaproveita o pedido pendente (não come estoque de novo)
      const venda = pedido ?? (await api.createPdvPixSale(eventId, payload(), accountToken!, chaveDaTentativa("pix")));
      setPedido(venda);
      const doc = soDigitos(cpf);
      const pix = await api.createPixPayment(venda.orderId, { payerDocument: doc.length >= 11 ? doc : undefined });
      if (!pix.pixQrCodeText) {
        setErro("Não foi possível gerar o Pix agora. Tente de novo em instantes.");
        setOcupado(null);
        return;
      }
      setPixCode(pix.pixQrCodeText);
      setOcupado(null);
      setFase("pix");
    } catch (e) {
      // AUTO-CURA: se o servidor disse que o provedor exige CPF, a tela passa a
      // pedir — sem depender de o GET /config ter funcionado na abertura
      if (e instanceof ApiError && /CPF/i.test(e.message)) setPixExigeCpf(true);
      setErro(msgErro(e));
      setOcupado(null);
    }
  }

  function receber(p: Pagamento) {
    if (ocupado) return;
    const b = bloqueio(p);
    if (b) {
      setErro(b);
      if (b.includes("nome")) nomeRef.current?.focus();
      else if (b.includes("CPF")) cpfRef.current?.focus();
      return;
    }
    setErro(null);
    if (p === "dinheiro") void receberDinheiro();
    else void receberPix();
  }

  // polling do Pix: verde sozinho quando cai.
  //
  // CHECAGEM ATIVA NO GATEWAY (2026-09-13, passo 5): a tela não pode depender
  // só do webhook — é a lição do checkout online (caso da Marcela, 2026-08-14),
  // e na porta pesa mais: o operador está PARADO esperando, como maquininha.
  // A cada ~15s, e sempre que o app volta pra frente (ele vira o celular pro
  // cliente e desvira), pedimos ao servidor que confira no gateway.
  useEffect(() => {
    if (fase !== "pix" || !pedido) return;
    paradoRef.current = false;
    const pessoas = qtd;
    const total = totalCents;
    const orderId = pedido.orderId;
    const onVisible = () => {
      if (document.visibilityState === "visible") api.syncPayment(orderId).catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    let tick = 0;
    const id = setInterval(async () => {
      if (document.visibilityState === "hidden") return; // sem gastar rede escondido
      try {
        tick += 1;
        if (tick % 6 === 0) await api.syncPayment(orderId).catch(() => undefined);
        let st = await api.getOrderStatus(pedido.publicToken);
        if (["CANCELED", "EXPIRED", "REFUNDED"].includes(st.status)) {
          // ANTES de decretar "expirou · nada foi cobrado", olhar o gateway UMA
          // vez: um Pix que caiu tarde no banco não pode virar cliente barrado
          // com o dinheiro debitado. Só é terminal se continuar terminal.
          await api.syncPayment(orderId).catch(() => undefined);
          st = await api.getOrderStatus(pedido.publicToken);
        }
        if (["PAID", "FULFILLED"].includes(st.status)) {
          clearInterval(id);
          await liberar(orderId, pedido.publicToken, "pix", pessoas, total);
        } else if (["CANCELED", "EXPIRED", "REFUNDED"].includes(st.status)) {
          clearInterval(id);
          setPixExpirado(true);
        }
      } catch {
        /* mantém o polling */
      }
    }, 2500);
    return () => {
      paradoRef.current = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase, pedido]);

  /** "Já pagou — conferir agora": o operador força a checagem no gateway sem esperar o tick */
  async function conferirPixAgora() {
    if (!pedido || ocupado) return;
    setOcupado("liberando");
    try {
      await api.syncPayment(pedido.orderId).catch(() => undefined);
      const st = await api.getOrderStatus(pedido.publicToken);
      if (["PAID", "FULFILLED"].includes(st.status)) {
        await liberar(pedido.orderId, pedido.publicToken, "pix", qtd, totalCents);
        return;
      }
      setOcupado(null);
      setErro(["CANCELED", "EXPIRED", "REFUNDED"].includes(st.status)
        ? "O gateway confirma: este Pix não foi pago."
        : "Ainda não caiu. Peça para conferir no app do banco.");
    } catch (e) {
      setOcupado(null);
      setErro(msgErro(e));
    }
  }

  /**
   * CANCELAR de verdade (2026-09-13): antes só voltava a tela e o pedido ficava
   * pendente no servidor, prendendo a vaga por 30 min com a cobrança viva. Se
   * o servidor disser que já pagou, NÃO voltamos — seguimos para liberar.
   */
  async function cancelarPix() {
    if (pixExpirado || !pedido || !accountToken) {
      proximaVenda();
      return;
    }
    setOcupado("registrando");
    try {
      const r = await api.cancelPdvPixSale(eventId, pedido.orderId, accountToken);
      if (!r.canceled && ["PAID", "FULFILLED"].includes(r.status)) {
        // pagou enquanto o operador cancelava: o polling cuida da entrada
        setOcupado(null);
        setErro("Este Pix já foi pago — liberando a entrada.");
        return;
      }
    } catch (e) {
      // sem rede: não dá pra garantir o cancelamento; a tela diz a verdade
      setOcupado(null);
      setErro(msgErro(e) + " O pedido pode continuar pendente por até 30 min.");
      return;
    }
    proximaVenda();
  }

  function proximaVenda() {
    paradoRef.current = true;
    chaveRef.current = null;
    setFase("venda");
    setPedido(null);
    setPixCode(null);
    setPixExpirado(false);
    setResultado(null);
    setErro(null);
    setCopiado(false);
    setOcupado(null);
    setMostrarRetirada(false);
    setNome("");
    setCpf("");
    setQtd(1);
    // o LOTE fica (na fila é quase sempre o mesmo); MEIA NÃO — cada venda
    // começa em inteira, e quem tem direito precisa de um toque consciente.
    // Erro de omissão (esquecer o toque) sai mais caro que erro de excesso
    // (perguntar de novo) — e "obrigar" nunca é o padrão seguro na porta.
    setOpcaoKey((atual) => (atual.split(":")[0] ? `${atual.split(":")[0]}:0` : atual));
    carregar();
    setTimeout(() => nomeRef.current?.focus(), 50);
  }

  // ==========================================================================
  if (!online && fase === "venda") {
    return (
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
        <p className="mb-1.5 text-[17px] font-extrabold">Venda na porta precisa de internet</p>
        <p className="max-w-[280px] text-[13px] font-medium leading-relaxed text-white/50">
          O Pix e a emissão do ingresso dependem do servidor. A validação continua funcionando offline nas
          outras abas.
        </p>
      </div>
    );
  }

  // ---- PRONTO: o dinheiro e a ENTRADA são dois fatos ---------------------------
  if (fase === "pronto" && resultado) {
    const r = resultado;
    // A cor vem do que ACONTECEU, não da fase (correção 2026-09-12). Antes o
    // círculo era sempre verde e o título sempre "Pode entrar", mesmo com ZERO
    // liberado — e na porta, no escuro, a dois metros, lê-se a COR, não os 13px
    // do subtítulo. O operador deixava passar, e os ingressos ficavam PAGOS e
    // NÃO QUEIMADOS, com QR vivo para repassar.
    const faltam = Math.max(0, r.pessoas - r.liberadas);
    const tudoLiberado = faltam === 0 && r.liberadas > 0;
    return (
      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-4 pt-4">
        <div
          className={`mx-auto mt-1 flex h-[88px] w-[88px] items-center justify-center rounded-full ${
            tudoLiberado ? "bg-success" : "bg-warning"
          }`}
        >
          {tudoLiberado ? (
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none">
              <path d="M5 12l5 5 9-11" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none">
              <path d="M12 7v7" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
              <circle cx="12" cy="18" r="1.7" fill="#fff" />
            </svg>
          )}
        </div>
        <h1 className="mt-4 text-center text-[26px] font-extrabold leading-tight">
          {tudoLiberado ? "Pode entrar" : `Pago — falta liberar ${faltam}`}
        </h1>
        <p className="mx-auto mt-1.5 max-w-[300px] text-center text-[13.5px] font-medium text-white/60">
          {tudoLiberado
            ? `${r.liberadas} ${r.liberadas === 1 ? "pessoa liberada" : "pessoas liberadas"}${gateName ? ` · ${gateName}` : ""}`
            : (r.motivoFalha ?? "A entrada não foi confirmada pelo servidor")}
        </p>
        <p className="mt-1 text-center text-[13px] font-bold text-white/80">
          {reais(r.totalCents)} · {r.pagamento === "dinheiro" ? "em dinheiro" : "no Pix"}
          {r.liberadas > 0 && !tudoLiberado ? ` · ${r.liberadas} de ${r.pessoas} já entrou` : ""}
        </p>

        {/* saída de emergência: o código serve para validar na mão, na aba Documento */}
        {!tudoLiberado && r.tickets.length > 0 && (
          <button
            onClick={() => void tentarLiberarDeNovo(r)}
            disabled={ocupado === "liberando"}
            className="mt-4 h-[52px] w-full flex-none rounded-2xl border-[1.5px] border-warning/60 bg-warning/[.14] text-[14px] font-extrabold text-[#fbbf24] disabled:opacity-50"
          >
            {ocupado === "liberando" ? "Tentando..." : "Tentar liberar de novo"}
          </button>
        )}

        {r.tickets.length > 0 && (
          <div className="mt-5 space-y-2">
            {r.tickets.map((tk) => (
              <div
                key={tk.id}
                className="flex items-center justify-between gap-3 rounded-2xl border-[1.5px] border-white/10 bg-white/[.05] px-4 py-3"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{tk.attendeeName ?? nome}</span>
                <span className="flex-none rounded-full bg-success/20 px-2.5 py-1 text-[11px] font-bold text-[#4ade80]">
                  {tk.code}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* opcional, DEPOIS da venda: ingresso no celular dele */}
        {r.publicToken && (
          <div className="mt-4">
            {!mostrarRetirada ? (
              <button
                onClick={() => setMostrarRetirada(true)}
                className="w-full rounded-2xl border-[1.5px] border-white/12 py-3 text-[13px] font-bold text-white/70"
              >
                Quer o ingresso no celular dele?
              </button>
            ) : (
              <div className="rounded-2xl border-[1.5px] border-white/12 bg-white/[.05] px-4 py-4">
                <p className="text-center text-[12px] font-medium text-white/55">
                  Ele escaneia, entra na conta e o ingresso fica salvo lá.
                </p>
                <div className="mx-auto mt-3 w-[160px] rounded-xl bg-white p-2.5">
                  <QRCode
                    value={`${typeof window !== "undefined" ? window.location.origin : ""}/pedido/${r.publicToken}`}
                    size={140}
                    style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <button
          onClick={proximaVenda}
          className="mt-auto h-[56px] w-full flex-none rounded-2xl bg-primary text-[16px] font-extrabold text-white shadow-cta"
        >
          Próxima venda
        </button>
      </div>
    );
  }

  // ---- PIX: o cliente escaneia no banco ----------------------------------------
  if (fase === "pix") {
    return (
      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-4 pt-4 text-center">
        {pixExpirado ? (
          <>
            <p className="mt-6 text-[20px] font-extrabold">Pix expirou</p>
            <p className="mt-1 text-[13px] font-medium text-white/55">Nenhum valor foi cobrado. Gere de novo.</p>
          </>
        ) : (
          <>
            <p className="text-[13px] font-bold uppercase tracking-wider text-white/45">Total</p>
            <p className="text-[38px] font-extrabold leading-none">{reais(totalCents)}</p>
            {pixCode && (
              <div className="mx-auto mt-4 w-fit rounded-3xl bg-white p-3">
                <QRCode value={pixCode} size={220} />
              </div>
            )}
            <p className="mt-4 text-[15px] font-extrabold">Ele escaneia no app do banco</p>
            <p className="mx-auto mt-1 inline-flex items-center gap-2 text-[12.5px] font-semibold text-[#fbbf24]">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-warning/30 border-t-[#fbbf24]" />
              {ocupado === "liberando" ? "Pagamento caiu — liberando a entrada..." : "Aguardando o pagamento"}
            </p>
            <button
              onClick={() => {
                if (!pixCode) return;
                navigator.clipboard?.writeText(pixCode);
                setCopiado(true);
                setTimeout(() => setCopiado(false), 2000);
              }}
              className={`mx-auto mt-4 inline-flex h-11 items-center rounded-2xl border-[1.5px] px-5 text-[13px] font-bold ${
                copiado ? "border-success text-[#4ade80]" : "border-white/25 text-white"
              }`}
            >
              {copiado ? "Código copiado" : "Copiar código Pix"}
            </button>
            <button
              onClick={() => void conferirPixAgora()}
              disabled={!!ocupado}
              className="mx-auto mt-2 inline-flex h-11 items-center rounded-2xl border-[1.5px] border-white/25 px-5 text-[13px] font-bold text-white disabled:opacity-50"
            >
              {ocupado === "liberando" ? "Conferindo..." : "Já pagou — conferir agora"}
            </button>
          </>
        )}
        <button
          onClick={() => void cancelarPix()}
          disabled={ocupado === "registrando"}
          className="mt-auto h-12 w-full flex-none rounded-2xl border-[1.5px] border-white/15 text-[14px] font-bold text-white/70 disabled:opacity-50"
        >
          {pixExpirado ? "Voltar" : ocupado === "registrando" ? "Cancelando..." : "Cancelar · nada foi cobrado"}
        </button>
      </div>
    );
  }

  // ---- VENDA: a tela ------------------------------------------------------------
  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-3">
        {!diaDoEvento && (
          <p className="mb-3 rounded-2xl border-[1.5px] border-danger/50 bg-danger/[.12] px-4 py-3 text-[12.5px] font-bold leading-relaxed text-[#fda4af]">
            O evento não é hoje. Vender aqui libera a entrada AGORA e queima o ingresso.
          </p>
        )}

        {erro && (
          <p className="mb-3 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-[12.5px] font-semibold text-[#fb7185]">
            {erro}
          </p>
        )}

        {/* INGRESSO: preço na cara, um toque */}
        {carregando ? (
          <p className="mb-4 rounded-2xl bg-white/[.05] px-4 py-4 text-[13px] font-semibold text-white/45">Carregando...</p>
        ) : lotsErro ? (
          <div className="mb-4 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-4">
            <p className="text-[13px] font-bold text-[#fbbf24]">Não foi possível carregar os ingressos.</p>
            <button onClick={carregar} className="mt-2 rounded-xl bg-white/10 px-4 py-2 text-[12px] font-bold text-white">
              Tentar de novo
            </button>
          </div>
        ) : cfgErro ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3">
            <p className="text-[12px] font-semibold text-[#fbbf24]">Configuração do Pix não carregou — o CPF fica opcional.</p>
            <button onClick={carregar} className="flex-none rounded-xl bg-white/10 px-3 py-2 text-[11.5px] font-bold text-white">
              Tentar de novo
            </button>
          </div>
        ) : null}
        {!carregando && !lotsErro && lots.length === 0 ? (
          <p className="mb-4 rounded-2xl bg-white/[.05] px-4 py-4 text-[13px] font-semibold text-white/45">
            Nenhum ingresso com vaga para vender agora.
          </p>
        ) : (
          <div className={`mb-4 grid gap-2.5 ${opcoes.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
            {opcoes.map((o) => {
              const ativo = o.key === opcaoKey;
              const precoExibido = o.meia ? Math.round(o.priceCents / 2) : o.priceCents;
              return (
                <button
                  key={o.key}
                  onClick={() => {
                    setOpcaoKey(o.key);
                    setQtd((q) => Math.min(Math.max(1, q), Math.min(20, o.available)));
                    setErro(null);
                  }}
                  className={`rounded-2xl border-[1.5px] px-4 py-3 text-left ${
                    ativo ? "border-primary bg-primary/15" : "border-white/10 bg-white/[.05]"
                  }`}
                >
                  <span className="block truncate text-[12px] font-semibold text-white/55">
                    {o.ticketTypeName} · {o.lotName}
                    {o.meia ? " · Meia" : ""}
                  </span>
                  <span className="mt-1 block text-[20px] font-extrabold leading-tight">{reais(precoExibido + o.feeCents)}</span>
                  <span className="mt-0.5 block text-[10.5px] font-medium text-white/35">{o.available} vagas</span>
                </button>
              );
            })}
          </div>
        )}

        {/* PESSOAS: número gigante, passos grandes */}
        <div className="mb-4 flex items-center justify-center gap-6">
          <button
            onClick={() => setQtd((q) => Math.max(1, q - 1))}
            disabled={qtd <= 1}
            aria-label="Menos um"
            className="flex h-[58px] w-[58px] flex-none items-center justify-center rounded-2xl border-[1.5px] border-white/15 bg-white/[.06] text-[26px] font-extrabold disabled:opacity-30"
          >
            −
          </button>
          <div className="text-center">
            <span className="block min-w-[56px] text-[48px] font-extrabold leading-none tabular-nums">{qtd}</span>
            <span className="mt-1 block text-[11px] font-semibold text-white/40">{qtd === 1 ? "pessoa" : "pessoas"}</span>
          </div>
          <button
            onClick={() => setQtd((q) => Math.min(maxQtd, q + 1))}
            disabled={!lote || qtd >= maxQtd}
            aria-label="Mais um"
            className="flex h-[58px] w-[58px] flex-none items-center justify-center rounded-2xl border-[1.5px] border-white/15 bg-white/[.06] text-[26px] font-extrabold disabled:opacity-30"
          >
            +
          </button>
        </div>

        {/* NOME: o básico necessário */}
        <input
          ref={nomeRef}
          value={nome}
          onChange={(e) => {
            setNome(e.target.value);
            if (erro) setErro(null);
          }}
          placeholder="Nome de quem entra"
          autoCapitalize="words"
          enterKeyHint="done"
          className="h-[54px] w-full rounded-2xl border-[1.5px] border-white/15 bg-white/[.07] px-4 text-[16px] font-semibold text-white outline-none placeholder:font-medium placeholder:text-white/30 focus:border-primary"
        />
        {(pixExigeCpf || cfgErro) && (
          <input
            ref={cpfRef}
            value={cpf}
            onChange={(e) => {
              setCpf(e.target.value);
              if (erro) setErro(null);
            }}
            placeholder={pixExigeCpf ? "CPF (obrigatório no Pix)" : "CPF (se o Pix pedir)"}
            inputMode="numeric"
            className={`mt-2.5 h-[54px] w-full rounded-2xl border-[1.5px] bg-white/[.07] px-4 text-[16px] font-semibold text-white outline-none placeholder:font-medium placeholder:text-white/30 focus:border-primary ${
              cpf.trim() && !cpfValido(cpf) ? "border-red-400/70" : "border-white/15"
            }`}
          />
        )}
      </div>

      {/* BARRA FIXA: total + receber. O botão JÁ confirma. */}
      <div className="flex-none border-t border-white/10 bg-[#120e1a]/95 px-5 pb-3 pt-3 backdrop-blur">
        <div className="mb-2.5 flex items-baseline justify-between">
          <span className="text-[12px] font-bold uppercase tracking-wider text-white/40">Total</span>
          <span className="text-[30px] font-extrabold leading-none tabular-nums">{reais(totalCents)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={() => receber("dinheiro")}
            disabled={!!ocupado}
            className="flex h-[60px] flex-col items-center justify-center rounded-2xl bg-success text-white shadow-cta-green disabled:opacity-40"
          >
            <span className="text-[16px] font-extrabold">{ocupado === "registrando" || ocupado === "liberando" ? "Liberando..." : "Dinheiro"}</span>
            <span className="text-[10.5px] font-semibold text-white/75">recebi, pode entrar</span>
          </button>
          <button
            onClick={() => receber("pix")}
            disabled={!!ocupado}
            className="flex h-[60px] flex-col items-center justify-center rounded-2xl bg-primary text-white shadow-cta disabled:opacity-40"
          >
            <span className="text-[16px] font-extrabold">{ocupado === "gerando-pix" ? "Gerando..." : "Pix"}</span>
            <span className="text-[10.5px] font-semibold text-white/75">ele escaneia e paga</span>
          </button>
        </div>
        <p className="mt-2 min-h-[16px] text-center text-[11.5px] font-bold leading-relaxed text-amber-300">
          {bloqueioBase ?? ""}
        </p>
      </div>
    </div>
  );
}
