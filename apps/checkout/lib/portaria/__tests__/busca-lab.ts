/**
 * Laboratório da busca da portaria — mesma ideia dos labs da API.
 * Roda com: apps/api/node_modules/.bin/tsx apps/checkout/lib/portaria/__tests__/busca-lab.ts
 *
 * Guarda a regra que separa as naturezas de entrada: quem tem ingresso prova
 * pela posse, quem está em lista prova pelo CPF — e as abas nunca se misturam.
 */
import { buscarPessoa, detectarModo, abasDoManifesto } from "../search";
import type { ManifestTicket } from "../types";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, extra?: unknown) => {
  if (c) { pass++; console.log(`  PASS ${n}`); } else { fail++; console.log(`  FAIL ${n}`, extra ?? ""); }
};

const t = (over: Partial<ManifestTicket>): ManifestTicket => ({
  id: crypto.randomUUID(), code: "BF-AAAA-BBBB", status: "ACTIVE", ticketLotId: "lot",
  checkedInAt: null, updatedAt: "", attendeeName: null, cpfHash: null, lista: null, ...over,
});

// sha256("52998224725")
const HASH_CPF = "0dd3cbcffbebd0f4ca3a4fc0b1c8b3b7a30e22b3b5a2b0a26d38d2cd4a2f4cc6";

async function main() {
  const tickets = [
    t({ code: "BF-9K2L-7TQM", attendeeName: "Ana Carolina Souza", lista: null }),
    t({ code: "BF-3F9X-M2PK", attendeeName: "Ana Ramos", lista: { id: "p1", nome: "João" } }),
    t({ code: "BF-7QW4-XJ3N", attendeeName: "Bruno Lima", lista: { id: "producao", nome: "Produção" } }),
    t({ code: "BF-2M8V-QK9R", attendeeName: "Carla Mendes", lista: { id: "p1", nome: "João" } }),
  ];
  const index = { eventId: "e", publicKeyPem: null, byCode: new Map(), lots: new Map(), localCheckins: new Map(),
    byId: new Map(tickets.map((x) => [x.id, x])) } as never;

  console.log("1) deteccao do que foi digitado");
  ok("CPF com mascara", detectarModo("529.982.247-25").modo === "cpf");
  ok("codigo completo", detectarModo("BF-9K2L-7TQM").modo === "codigo");
  ok("codigo parcial (enquanto digita)", detectarModo("BF-9K2").modo === "codigo");
  ok("nome", detectarModo("ana carol").modo === "nome");
  ok("1 letra ja busca por nome (nao zera a tela)", detectarModo("a").modo === "nome");

  console.log("\n2) as abas nunca se misturam");
  const rIng = await buscarPessoa(index, "ana", "ingressos");
  ok("aba Ingressos so traz quem tem ingresso", rIng.tickets.length === 1 && rIng.tickets[0].attendeeName === "Ana Carolina Souza", rIng.tickets.map(x=>x.attendeeName));
  ok("e avisa que existe outra em outra aba", rIng.outrasAbas.includes("João"), rIng.outrasAbas);

  const rJoao = await buscarPessoa(index, "ana", "p1");
  ok("aba da lista do Joao so traz a dele", rJoao.tickets.length === 1 && rJoao.tickets[0].attendeeName === "Ana Ramos", rJoao.tickets.map(x=>x.attendeeName));

  const rTodas = await buscarPessoa(index, "a", "todas");
  ok("'todas as listas' junta as listas mas nunca ingressos",
    rTodas.tickets.length === 3 && !rTodas.tickets.some((x) => x.lista === null), rTodas.tickets.map(x=>x.attendeeName));

  console.log("\n3) busca por codigo");
  const rCod = await buscarPessoa(index, "BF-9K2L", "ingressos");
  ok("acha pelo codigo parcial", rCod.tickets.length === 1 && rCod.tickets[0].code === "BF-9K2L-7TQM");
  const rCodErrado = await buscarPessoa(index, "BF-3F9X", "ingressos");
  ok("codigo de quem esta em lista nao vaza para Ingressos", rCodErrado.tickets.length === 0 && rCodErrado.outrasAbas.includes("João"), rCodErrado);

  console.log("\n4) abas derivadas do manifesto");
  const abas = abasDoManifesto(index);
  ok("primeira aba e Ingressos", abas[0].id === "ingressos");
  ok("segunda e 'Todas as listas'", abas[1].id === "todas");
  ok("producao nao vira 'Lista de Produção'", abas.some((a) => a.label === "Produção"), abas.map(a=>a.label));
  ok("promoter vira 'Lista de João'", abas.some((a) => a.label === "Lista de João"), abas.map(a=>a.label));

  const soIngressos = { ...(index as object), byId: new Map([[tickets[0].id, tickets[0]]]) } as never;
  ok("sem listas, so a aba Ingressos", abasDoManifesto(soIngressos).length === 1);

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}
main();
