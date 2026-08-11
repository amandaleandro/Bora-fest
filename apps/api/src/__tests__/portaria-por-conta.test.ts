import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { ValidatorService } from "../validator/validator.service";
import { OrgAccessService } from "../common/org-access.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

const validator = new ValidatorService(new OrgAccessService());

async function membro(organizationId: string, roleKey: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const user = await prisma.user.create({
    data: { email: `pt-${Math.random().toString(36).slice(2, 9)}@borafest.dev` },
  });
  await prisma.organizationMember.create({
    data: { organizationId, userId: user.id, roleId: role.id, status: "ACTIVE" },
  });
  return user;
}

test("portaria por conta: dono e operador entram sem PIN; estranho é barrado", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5, priceCents: 1000, feeCents: 0 });
  const outra = await createFixtureEvent({ lotCapacity: 5, priceCents: 1000, feeCents: 0 });
  try {
    const dono = await membro(f.organization.id, "owner");
    const operador = await membro(f.organization.id, "operator");
    const estranho = await membro(outra.organization.id, "owner");

    // dono (conta principal) valida direto — sem se convidar
    const sessaoDono = await validator.createSessionFromAccount(dono.id, f.event.id, {
      name: "iPhone do dono",
    } as never);
    assert.ok(sessaoDono.deviceToken, "dono entra sem PIN");
    assert.equal(sessaoDono.event.id, f.event.id);
    assert.ok(sessaoDono.credentialLabel.startsWith("Conta ·"), "credencial nomeada por pessoa");

    // operador convidado também
    const sessaoOp = await validator.createSessionFromAccount(operador.id, f.event.id, {
      name: "Android portaria",
    } as never);
    assert.ok(sessaoOp.deviceToken);
    assert.notEqual(sessaoOp.deviceId, sessaoDono.deviceId, "dispositivos separados por pessoa");

    // quem não tem acesso ao evento é barrado
    await assert.rejects(
      () => validator.createSessionFromAccount(estranho.id, f.event.id, { name: "x" } as never),
      /não tem acesso/i,
    );
  } finally {
    await cleanupFixtureEvent(f.organization.id);
    await cleanupFixtureEvent(outra.organization.id);
  }
});

test("lista de eventos da portaria mostra SÓ os autorizados (não os de outros produtores)", async () => {
  const minha = await createFixtureEvent({ lotCapacity: 5, priceCents: 1000, feeCents: 0 });
  const alheia = await createFixtureEvent({ lotCapacity: 5, priceCents: 1000, feeCents: 0 });
  try {
    const operador = await membro(minha.organization.id, "operator");
    const lista = await validator.listMyValidatorEvents(operador.id);
    const ids = lista.map((e) => e.id);

    assert.ok(ids.includes(minha.event.id), "vê o evento da casa dele");
    assert.ok(!ids.includes(alheia.event.id), "NÃO vê evento de outro produtor");

    // quem não é de nenhuma organização não vê nada
    const forasteiro = await prisma.user.create({
      data: { email: `fora-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
    });
    assert.deepEqual(await validator.listMyValidatorEvents(forasteiro.id), []);
  } finally {
    await cleanupFixtureEvent(minha.organization.id);
    await cleanupFixtureEvent(alheia.organization.id);
  }
});
