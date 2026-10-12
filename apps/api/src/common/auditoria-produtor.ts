import type { Prisma } from "@borafest/database";

/**
 * RASTRO DAS AÇÕES DO PRODUTOR (2026-10-12): publicar, pausar, reabrir e
 * editar evento, e criar, ativar, encerrar e apagar lote não gravavam nada na
 * auditoria. Numa disputa ("quem mudou a data?", "quem fechou o lote?") não
 * havia como provar. Aqui mora só a conta do QUE mudou numa edição de evento;
 * cada serviço grava o registro na mesma transação da mudança.
 */

type ValorJson = Prisma.InputJsonValue | null;

/** Campos curtos: o registro guarda o valor de antes e o de depois. */
const CAMPOS_COM_VALOR = [
  "title",
  "startsAt",
  "endsAt",
  "timezone",
  "venueId",
  "isPrivate",
  "minAge",
  "category",
  "bannerUrl",
  "waitingRoomEnabled",
  "waitingRoomConcurrency",
] as const;

/**
 * Campos que só registram QUE mudaram: texto longo (não vale duplicar no
 * histórico) e segredo — o token do CAPI nunca vai para a auditoria.
 */
const CAMPOS_SO_MARCA = ["description", "lineup", "amenities", "pixelSettings", "metaCapiToken"] as const;

function paraJson(valor: unknown): ValorJson {
  if (valor === undefined || valor === null) return null;
  if (valor instanceof Date) return valor.toISOString();
  return valor as Prisma.InputJsonValue;
}

function mesmoValor(a: unknown, b: unknown): boolean {
  const ja = paraJson(a);
  const jb = paraJson(b);
  if ((ja !== null && typeof ja === "object") || (jb !== null && typeof jb === "object")) {
    return JSON.stringify(ja) === JSON.stringify(jb);
  }
  return ja === jb;
}

export type AlteracoesDoEvento = {
  /** nomes dos campos que mudaram (os de segredo/texto longo entram só aqui) */
  campos: string[];
  antes: Record<string, ValorJson>;
  depois: Record<string, ValorJson>;
};

/** O que mudou entre o evento de antes e o de depois de salvar. */
export function alteracoesDoEvento(antes: object, depois: object): AlteracoesDoEvento {
  const a = antes as Record<string, unknown>;
  const d = depois as Record<string, unknown>;
  const campos: string[] = [];
  const de: Record<string, ValorJson> = {};
  const para: Record<string, ValorJson> = {};
  for (const campo of CAMPOS_COM_VALOR) {
    if (mesmoValor(a[campo], d[campo])) continue;
    campos.push(campo);
    de[campo] = paraJson(a[campo]);
    para[campo] = paraJson(d[campo]);
  }
  for (const campo of CAMPOS_SO_MARCA) {
    if (!mesmoValor(a[campo], d[campo])) campos.push(campo);
  }
  return { campos, antes: de, depois: para };
}
