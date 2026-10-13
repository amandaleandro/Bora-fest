import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { IdentityService, VERSAO_DOS_TERMOS } from "../identity/identity.service";
import { IdentityController } from "../identity/identity.controller";

// FRENTE SERVIDOR (2026-10-12): o cadastro do produtor gravava só a data do
// aceite (users.termsAcceptedAt). Agora grava a prova como o checkout: uma
// linha por documento (termos e privacidade), na versão vigente, com IP e
// navegador — na mesma transação da conta. Clique duplo no "Criar conta" dá
// "conta já existe", não erro 500 nem aceite em dobro.

// o cadastro devolve a sessão: sem segredo definido no ambiente, usa um só de teste
process.env.SESSION_JWT_SECRET ??= "segredo-so-de-teste-cadastro";

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);
const identity = new IdentityService();

async function apagar(email: string) {
  const contas = await prisma.user.findMany({ where: { email }, select: { id: true } });
  const ids = contas.map((c) => c.id);
  await prisma.consent.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

test("cadastro grava o aceite de termos e privacidade, com versão, IP e navegador", async () => {
  const email = `produtor-${rand()}@borafest.dev`;
  try {
    const r = await identity.registerWithPassword(
      { name: "Produtora Teste", email, password: "senha-forte-123", acceptTerms: true },
      { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (teste de cadastro)" },
    );
    const conta = await prisma.user.findUniqueOrThrow({ where: { id: r.user.id } });
    assert.ok(conta.termsAcceptedAt, "a data do aceite continua na conta");

    const aceites = await prisma.consent.findMany({ where: { userId: r.user.id }, orderBy: { document: "asc" } });
    assert.deepEqual(aceites.map((a) => a.document), ["privacy", "terms"]);
    for (const aceite of aceites) {
      assert.equal(aceite.version, VERSAO_DOS_TERMOS);
      assert.equal(aceite.ip, "203.0.113.7");
      assert.equal(aceite.userAgent, "Mozilla/5.0 (teste de cadastro)");
      assert.equal(aceite.orderId, null, "aceite do cadastro não é de pedido");
      assert.equal(aceite.acceptedAt.getTime(), conta.termsAcceptedAt!.getTime(), "mesma hora da conta");
    }
  } finally {
    await apagar(email);
  }
});

test("a versão gravada no cadastro é a mesma que o checkout grava", () => {
  const fonte = readFileSync(join(__dirname, "../../../checkout/lib/consent.ts"), "utf8");
  const achado = /CONSENT_VERSION\s*=\s*"([^"]+)"/.exec(fonte);
  assert.ok(achado, "CONSENT_VERSION do site");
  assert.equal(VERSAO_DOS_TERMOS, achado[1], "trocar a versão dos termos é trocar nos dois lugares");
});

test("pela rota: IP e navegador saem da requisição, limpos como no checkout", async () => {
  const email = `produtor-rota-${rand()}@borafest.dev`;
  try {
    const controller = new IdentityController(identity);
    const navegadorEnorme = `  ${"x".repeat(600)}  `;
    const r = await controller.register(
      { name: "Produtora Rota", email, password: "senha-forte-123", acceptTerms: true },
      " 198.51.100.20 ",
      navegadorEnorme,
    );
    const aceites = await prisma.consent.findMany({ where: { userId: r.user.id } });
    assert.equal(aceites.length, 2);
    for (const aceite of aceites) {
      assert.equal(aceite.ip, "198.51.100.20");
      assert.equal(aceite.userAgent?.length, 512, "navegador cortado no limite");
    }

    // sem IP nem navegador: grava o aceite mesmo assim, com "não informado" (null)
    const email2 = `produtor-sem-origem-${rand()}@borafest.dev`;
    try {
      const r2 = await controller.register(
        { name: "Produtora Sem Origem", email: email2, password: "senha-forte-123", acceptTerms: true },
        undefined,
        "   ",
      );
      const aceites2 = await prisma.consent.findMany({ where: { userId: r2.user.id } });
      assert.equal(aceites2.length, 2);
      assert.ok(aceites2.every((a) => a.ip === null && a.userAgent === null));
    } finally {
      await apagar(email2);
    }
  } finally {
    await apagar(email);
  }
});

test("clique duplo no 'Criar conta': uma conta, um par de aceites, e o 2º recebe 'conta já existe'", async () => {
  const email = `produtor-duplo-${rand()}@borafest.dev`;
  try {
    const corpo = { name: "Produtora Dupla", email, password: "senha-forte-123", acceptTerms: true as const };
    const resultados = await Promise.allSettled([
      identity.registerWithPassword(corpo, { ip: "203.0.113.9" }),
      identity.registerWithPassword(corpo, { ip: "203.0.113.9" }),
    ]);
    const ok = resultados.filter((r) => r.status === "fulfilled");
    const recusados = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.equal(ok.length, 1, "uma conta criada");
    assert.equal(recusados.length, 1);
    assert.equal((recusados[0].reason as any).status, 409, "conflito, não erro 500");
    assert.match((recusados[0].reason as Error).message, /Já existe uma conta com este e-mail/);

    const contas = await prisma.user.findMany({ where: { email } });
    assert.equal(contas.length, 1);
    assert.equal(await prisma.consent.count({ where: { userId: contas[0].id } }), 2, "sem aceite em dobro");
  } finally {
    await apagar(email);
  }
});
