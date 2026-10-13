"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, paths } from "../../../components/icons";
import { API_BASE_URL } from "../../../lib/config";

type Tipo = "seguidor" | "campanha";

/** GET /v1/public/descadastro/:token — o que mostrar antes do botão */
interface Situacao {
  tipo: Tipo;
  casa: string | null;
  /** mascarado pela API ("fu***@gmail.com") */
  email: string | null;
  jaSaiu: boolean;
}

/** POST /v1/public/descadastro/:token */
interface Resultado {
  ok: true;
  tipo: Tipo;
  casa: string | null;
  jaTinhaSaido: boolean;
}

type Estado =
  | { fase: "carregando" }
  | { fase: "erro"; mensagem: string; linkInvalido: boolean }
  | { fase: "pronto"; situacao: Situacao; erroDoBotao?: string }
  | { fase: "enviando"; situacao: Situacao }
  | { fase: "feito"; resultado: Resultado };

const SEM_CONEXAO = "Não conseguimos falar com a BoraFest agora. Confira sua internet e tente de novo.";

/** status 0 = nem chegou na API */
class ErroDoDescadastro extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function chamar<T>(token: string, method: "GET" | "POST"): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`${API_BASE_URL}/v1/public/descadastro/${encodeURIComponent(token)}`, {
      method,
      // JSON, não a página: o endereço da API leva navegadores para cá
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new ErroDoDescadastro(0, SEM_CONEXAO);
  }
  const corpo = (await resposta.json().catch(() => null)) as { message?: unknown } | null;
  if (!resposta.ok) {
    const mensagem = corpo?.message;
    if (typeof mensagem === "string" && mensagem) throw new ErroDoDescadastro(resposta.status, mensagem);
    if (Array.isArray(mensagem) && mensagem.length) throw new ErroDoDescadastro(resposta.status, mensagem.join(" · "));
    if (resposta.status === 429) {
      throw new ErroDoDescadastro(429, "Muitas tentativas seguidas. Espere um minuto e tente de novo.");
    }
    throw new ErroDoDescadastro(resposta.status, SEM_CONEXAO);
  }
  if (!corpo) throw new ErroDoDescadastro(resposta.status, SEM_CONEXAO);
  return corpo as T;
}

function nomeDaCasa(casa: string | null): string {
  return casa?.trim() || "esta Casa";
}

export function DescadastroCliente({ token }: { token: string }) {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  // trava de clique duplo: o estado do React só muda no próximo render
  const enviando = useRef(false);

  const carregar = useCallback(() => {
    setEstado({ fase: "carregando" });
    chamar<Situacao>(token, "GET")
      .then((situacao) => setEstado({ fase: "pronto", situacao }))
      .catch((e: unknown) =>
        setEstado({
          fase: "erro",
          mensagem: e instanceof Error ? e.message : SEM_CONEXAO,
          // 400 = o link em si não vale: tentar de novo não resolve
          linkInvalido: e instanceof ErroDoDescadastro && e.status === 400,
        }),
      );
  }, [token]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function confirmar(situacao: Situacao) {
    if (enviando.current) return;
    enviando.current = true;
    setEstado({ fase: "enviando", situacao });
    try {
      const resultado = await chamar<Resultado>(token, "POST");
      setEstado({ fase: "feito", resultado });
    } catch (e) {
      // continua na tela do botão, com o motivo — nada foi dado como feito
      setEstado({ fase: "pronto", situacao, erroDoBotao: e instanceof Error ? e.message : SEM_CONEXAO });
    } finally {
      enviando.current = false;
    }
  }

  if (estado.fase === "carregando") {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <div className="text-center">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-[3px] border-primary/20 border-t-primary" />
          <p className="mt-4 text-[14px] font-semibold text-muted">Abrindo…</p>
        </div>
      </main>
    );
  }

  if (estado.fase === "erro") {
    return (
      <Moldura icone={paths.x} tom="neutro" titulo="Não deu para abrir este link" texto={estado.mensagem}>
        {estado.linkInvalido ? (
          <VoltarAoSite destaque />
        ) : (
          <>
            <button
              type="button"
              onClick={carregar}
              className="mt-6 h-14 w-full rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta"
            >
              Tentar de novo
            </button>
            <VoltarAoSite />
          </>
        )}
      </Moldura>
    );
  }

  if (estado.fase === "feito") {
    const { resultado } = estado;
    const casa = nomeDaCasa(resultado.casa);
    return (
      <Moldura
        icone={paths.check}
        tom="sucesso"
        titulo={resultado.tipo === "campanha" ? "Pronto, você saiu da lista" : "Pronto, você deixou de seguir"}
        texto={
          resultado.tipo === "campanha"
            ? `Você não vai mais receber e-mails de campanha de ${casa}. Seus ingressos e os avisos das suas compras continuam chegando normalmente.`
            : `Você não vai mais receber o aviso de evento novo de ${casa}. Se mudar de ideia, é só seguir de novo pela página da Casa.`
        }
      >
        <VoltarAoSite destaque />
      </Moldura>
    );
  }

  const { situacao } = estado;
  const casa = nomeDaCasa(situacao.casa);
  const noEmail = situacao.email ? ` em ${situacao.email}` : "";

  if (situacao.jaSaiu) {
    return (
      <Moldura
        icone={paths.check}
        tom="sucesso"
        titulo={situacao.tipo === "campanha" ? "Você já saiu desta lista" : "Você já não segue esta Casa"}
        texto={
          situacao.tipo === "campanha"
            ? `Você não recebe mais e-mails de campanha de ${casa}${noEmail}. Não precisa fazer mais nada.`
            : `Você não recebe mais o aviso de evento novo de ${casa}${noEmail}. Se mudar de ideia, é só seguir de novo pela página da Casa.`
        }
      >
        <VoltarAoSite destaque />
      </Moldura>
    );
  }

  const ocupado = estado.fase === "enviando";
  const erroDoBotao = estado.fase === "pronto" ? estado.erroDoBotao : undefined;
  return (
    <Moldura
      icone={paths.x}
      tom="marca"
      chamada={situacao.tipo === "campanha" ? "Campanhas por e-mail" : "Casas que você segue"}
      titulo={situacao.tipo === "campanha" ? `Parar de receber campanhas de ${casa}?` : `Deixar de seguir ${casa}?`}
      texto={
        situacao.tipo === "campanha"
          ? `Você não vai mais receber e-mails de campanha de ${casa}${noEmail}. Seus ingressos e os avisos das suas compras continuam chegando normalmente.`
          : `Você para de receber o aviso de evento novo de ${casa}${noEmail}. Seus ingressos continuam valendo normalmente.`
      }
    >
      {erroDoBotao ? (
        <p role="alert" className="mt-5 w-full rounded-xl bg-danger/10 px-3 py-2.5 text-left text-[13px] font-bold text-danger">
          {erroDoBotao}
        </p>
      ) : null}
      <button
        type="button"
        disabled={ocupado}
        onClick={() => confirmar(situacao)}
        className="mt-6 h-14 w-full rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta disabled:opacity-60"
      >
        {ocupado ? "Salvando…" : situacao.tipo === "campanha" ? "Não quero mais receber" : "Deixar de seguir"}
      </button>
      <VoltarAoSite />
    </Moldura>
  );
}

function Moldura({
  icone,
  tom,
  chamada,
  titulo,
  texto,
  children,
}: {
  icone: string;
  tom: "marca" | "sucesso" | "neutro";
  chamada?: string;
  titulo: string;
  texto: string;
  children: React.ReactNode;
}) {
  const corDoIcone =
    tom === "sucesso" ? "animate-pop bg-success text-white" : tom === "marca" ? "bg-primary/10 text-primary" : "bg-line text-muted";
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-8 py-12 text-center lg:mx-auto lg:max-w-[520px]">
      <div className={`flex h-20 w-20 items-center justify-center rounded-full ${corDoIcone}`}>
        <Icon d={icone} size={36} stroke={2.5} />
      </div>
      {chamada ? (
        <p className="mt-5 text-[13px] font-extrabold uppercase tracking-wider text-primary">{chamada}</p>
      ) : null}
      <h1 className={`${chamada ? "mt-2" : "mt-5"} break-words text-[22px] font-extrabold`}>{titulo}</h1>
      <p className="mt-2 break-words text-[13px] font-medium leading-relaxed text-muted lg:text-[14px]">{texto}</p>
      {children}
    </main>
  );
}

function VoltarAoSite({ destaque = false }: { destaque?: boolean }) {
  return destaque ? (
    <Link
      href="/"
      className="mt-6 flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-[15px] font-extrabold text-white shadow-cta"
    >
      Ver eventos
    </Link>
  ) : (
    <Link
      href="/"
      className="mt-3 flex h-12 w-full items-center justify-center rounded-2xl border-[1.5px] border-line-input text-[14px] font-bold text-primary"
    >
      Voltar para o site
    </Link>
  );
}
