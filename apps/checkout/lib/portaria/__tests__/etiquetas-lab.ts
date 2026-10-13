/**
 * Laboratório das etiquetas da porta (MEIA-ENTRADA / GRATUITO) no caminho
 * OFFLINE — mesma ideia do busca-lab.ts.
 * Roda com: apps/api/node_modules/.bin/tsx apps/checkout/lib/portaria/__tests__/etiquetas-lab.ts
 *
 * Guarda duas regras: (1) a etiqueta sai do manifesto guardado, sem rede, e um
 * manifesto antigo sem os campos não quebra (sai sem etiqueta); (2) o aparelho
 * só grava o formato que o servidor confirmou — senão uma API ainda antiga
 * deixaria o manifesto "novo" sem as etiquetas para sempre.
 */
import { buildIndex, verifyLocally } from "../verify";
import { formatoConfirmado, precisaManifestoInteiro } from "../sync";
import type { ManifestTicket } from "../types";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, extra?: unknown) => {
  if (c) { pass++; console.log(`  PASS ${n}`); } else { fail++; console.log(`  FAIL ${n}`, extra ?? ""); }
};

const t = (over: Partial<ManifestTicket>): ManifestTicket => ({
  id: crypto.randomUUID(), code: "BF-AAAA-BBBB", status: "ACTIVE", ticketLotId: "lot",
  checkedInAt: null, updatedAt: "", attendeeName: "Portador", ...over,
});

function main() {
  const meia = t({ code: "BF-MEIA-0001", meia: true, gratuito: false });
  const gratis = t({ code: "BF-GRAT-0001", meia: false, gratuito: true });
  const convidado = t({ code: "BF-CONV-0001", tipo: "CONVIDADO", meia: false, gratuito: false });
  // guardado antes de 2026-10-12: sem as chaves
  const antigo = t({ code: "BF-VELH-0001" });
  const usado = t({ code: "BF-USAD-0001", meia: true, status: "CHECKED_IN", checkedInAt: new Date().toISOString() });

  const index = buildIndex({
    eventId: "e", publicKeyPem: "chave", lots: [], queue: [],
    tickets: [meia, gratis, convidado, antigo, usado],
  });

  console.log("1) etiquetas no resultado offline");
  const rMeia = verifyLocally({ ticketId: meia.id }, index);
  ok("meia: VALID com MEIA-ENTRADA", rMeia.kind === "VALID" && rMeia.meia === true && rMeia.gratuito === false, rMeia);
  ok("meia pelo codigo digitado (caixa baixa)", verifyLocally({ code: "bf-meia-0001" }, index).meia === true);

  const rGratis = verifyLocally({ ticketId: gratis.id }, index);
  ok("gratis do site: VALID com GRATUITO", rGratis.kind === "VALID" && rGratis.gratuito === true && rGratis.meia === false, rGratis);

  const rConv = verifyLocally({ ticketId: convidado.id }, index);
  ok("convidado segue CONVIDADO, sem GRATUITO", rConv.tipo === "CONVIDADO" && rConv.gratuito === false, rConv);

  const rAntigo = verifyLocally({ ticketId: antigo.id }, index);
  ok("manifesto antigo sem os campos: VALID, sem etiqueta, sem quebrar",
    rAntigo.kind === "VALID" && rAntigo.meia === false && rAntigo.gratuito === false, rAntigo);

  const rUsado = verifyLocally({ ticketId: usado.id }, index);
  ok("ja usado continua 'Ja utilizado' (etiqueta nao libera ninguem)", rUsado.kind === "ALREADY_USED", rUsado);

  console.log("\n2) formato gravado = o que o servidor confirmou");
  ok("API antiga (sem manifestSchema) grava 2", formatoConfirmado(undefined) === 2);
  ok("API com etiquetas grava 3", formatoConfirmado(3) === 3);
  // formato 4 (2026-10-12): `qrAtual`, a recusa offline do QR de antes da transferência
  ok("API nova grava 4", formatoConfirmado(4) === 4);
  ok("API mais nova que o site nao passa de 4", formatoConfirmado(5) === 4);
  ok("valor estranho conta como API antiga", formatoConfirmado(Number.NaN) === 2);
  ok("guardado 2 refaz o full", precisaManifestoInteiro(2) === true);
  ok("guardado sem formato refaz o full", precisaManifestoInteiro(undefined) === true);
  ok("guardado 3 refaz o full (sem qrAtual)", precisaManifestoInteiro(3) === true);
  ok("guardado 4 segue no delta", precisaManifestoInteiro(4) === false);

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}
main();
