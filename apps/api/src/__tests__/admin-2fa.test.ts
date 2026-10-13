import "reflect-metadata";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { ExecutionContext } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { closeRedisConnection, getRedisConnection } from "@borafest/queues";
import { createSessionToken } from "@borafest/auth";
import { AdminController } from "../admin/admin.controller";
import { PlatformAccessService } from "../common/platform-access.service";
import { resolveSessionUserId } from "../common/session-resolver";
import { Exige2faGuard } from "../seguranca-2fa/exige-2fa.guard";
import { Seguranca2faService } from "../seguranca-2fa/seguranca-2fa.service";
import {
  CONFIRMACAO_2FA_HEADER,
  CONFIRMACAO_2FA_PROPOSITO,
  ERRO_2FA_CONFIRMACAO_NECESSARIA,
  ERRO_2FA_NAO_ATIVADO,
} from "../seguranca-2fa/confirmacao";
import { TOTP_CHAVE_ENV } from "../seguranca-2fa/cofre-totp";
import { TOTP_PASSO_SEGUNDOS, base32Decode, codigoTotp } from "../seguranca-2fa/totp";

/**
 * Segundo fator no backoffice (2026-10-12). Antes, aprovar saque, estornar,
 * marcar repasse pago, mudar taxa e aprovar casa pediam só a sessão (código no
 * e-mail): quem invadisse o e-mail de um admin liberava dinheiro. Estes testes
 * provam a ativação do app autenticador e a exigência da confirmação na API.
 */

process.env.SESSION_JWT_SECRET ??= "segredo-so-de-teste-2fa";
const CHAVE_ANTERIOR = process.env[TOTP_CHAVE_ENV];
const CHAVE_TESTE = "chave-mestra-so-de-teste-".padEnd(64, "x");
process.env[TOTP_CHAVE_ENV] = CHAVE_TESTE;

const servico = new Seguranca2faService(new PlatformAccessService());
const guard = new Exige2faGuard(new PlatformAccessService());
const criados: string[] = [];

after(async () => {
  try {
    const redis = getRedisConnection();
    for (const id of criados) {
      const chaves = await redis.keys(`2fa:*${id}*`);
      if (chaves.length > 0) await redis.del(...chaves);
    }
  } catch {
    // Redis fora do ar: as chaves vencem sozinhas em minutos
  }
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: criados } } });
  await prisma.user.deleteMany({ where: { id: { in: criados } } });
  if (CHAVE_ANTERIOR === undefined) delete process.env[TOTP_CHAVE_ENV];
  else process.env[TOTP_CHAVE_ENV] = CHAVE_ANTERIOR;
  await closeRedisConnection();
});

async function novoUsuario(platformRole: "ADMIN" | "SUPPORT" | null) {
  const user = await prisma.user.create({
    data: { email: `2fa-${Math.random().toString(36).slice(2, 10)}@borafest.dev`, platformRole },
  });
  criados.push(user.id);
  return user;
}

/** o pedaço da requisição que o guard lê: userId (posto pelo SessionGuard) e o cabeçalho */
function contexto(userId: string, confirmacao?: string): ExecutionContext {
  const request = { userId, headers: confirmacao ? { [CONFIRMACAO_2FA_HEADER]: confirmacao } : {} };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

async function recusaCom403(promessa: Promise<unknown>, codigo: string, mensagem?: RegExp) {
  await assert.rejects(promessa, (err: any) => {
    assert.equal(err?.getStatus?.(), 403, "precisa ser 403");
    const corpo = err.getResponse();
    assert.equal(corpo.code, codigo);
    if (mensagem) assert.match(corpo.message, mensagem);
    return true;
  });
}

/** um código de 6 dígitos que com certeza NÃO vale na janela atual */
function codigoErrado(segredo: Buffer): string {
  const passoMs = TOTP_PASSO_SEGUNDOS * 1000;
  const validos = new Set([-1, 0, 1].map((d) => codigoTotp(segredo, Date.now() + d * passoMs)));
  for (let n = 0; ; n++) {
    const codigo = String(n).padStart(6, "0");
    if (!validos.has(codigo)) return codigo;
  }
}

test("as ações de dinheiro do backoffice exigem o 2FA; leitura e freios não", () => {
  const exigem = [
    "setOrganizationFee",
    "unblockOrganization",
    "approveOrganization",
    "refundOrder",
    "approveRefundRequest",
    "approvePayoutRequest",
    "updateSettlement",
    "createPayout",
    "markPayoutPaid",
  ];
  const livres = [
    "listOrganizations",
    "getOrganization",
    "listPayouts",
    "listPayoutRequests",
    "blockOrganization",
    "blockEvent",
    "blockTicket",
    "rejectPayoutRequest",
    "rejectRefundRequest",
  ];
  // "__guards__" = GUARDS_METADATA do @nestjs/common (o que @UseGuards grava no método)
  const guardsDe = (metodo: string) =>
    (Reflect.getMetadata("__guards__", (AdminController.prototype as any)[metodo]) ?? []) as unknown[];
  for (const metodo of exigem) assert.ok(guardsDe(metodo).includes(Exige2faGuard), `${metodo} sem 2FA`);
  for (const metodo of livres) assert.ok(!guardsDe(metodo).includes(Exige2faGuard), `${metodo} não deveria pedir 2FA`);
});

test("sem a chave mestra no servidor, ativar o 2FA é recusado com mensagem clara", async () => {
  const admin = await novoUsuario("ADMIN");
  delete process.env[TOTP_CHAVE_ENV];
  try {
    assert.equal((await servico.status(admin.id)).servidorPronto, false);
    await assert.rejects(servico.iniciarAtivacao(admin.id), /TOTP_ENCRYPTION_KEY/);
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    assert.equal(depois.totpSecret, null, "nada é gravado sem a chave");
  } finally {
    process.env[TOTP_CHAVE_ENV] = CHAVE_TESTE;
  }
});

test("ativar o app autenticador e exigir a confirmação nas ações de dinheiro", async () => {
  const admin = await novoUsuario("ADMIN");

  // sem 2FA: o guard pede para ativar em Segurança
  await recusaCom403(guard.canActivate(contexto(admin.id)), ERRO_2FA_NAO_ATIVADO, /Segurança/);

  const ativacao = await servico.iniciarAtivacao(admin.id);
  assert.match(ativacao.segredo, /^[A-Z2-7]{32}$/);
  assert.ok(ativacao.otpauthUrl.startsWith("otpauth://totp/BoraFest:"));
  assert.ok(ativacao.otpauthUrl.includes(`secret=${ativacao.segredo}`));

  const pendente = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
  assert.ok(pendente.totpSecret?.startsWith("v1:"), "segredo guardado cifrado");
  assert.ok(!pendente.totpSecret!.includes(ativacao.segredo), "segredo nunca em texto puro no banco");
  assert.equal(pendente.totpEnabledAt, null, "só liga depois do 1º código");
  assert.equal((await servico.status(admin.id)).ativacaoPendente, true);
  // ativação começada ainda não vale como 2FA
  await recusaCom403(guard.canActivate(contexto(admin.id)), ERRO_2FA_NAO_ATIVADO);

  const segredo = base32Decode(ativacao.segredo);
  await assert.rejects(servico.confirmarAtivacao(admin.id, codigoErrado(segredo)), /Código incorreto/);
  const ativado = await servico.confirmarAtivacao(admin.id, codigoTotp(segredo));
  assert.equal(ativado.ativo, true);
  assert.ok(ativado.confirmacao, "quem acabou de ativar já sai com uma confirmação");

  // já ativo: só com a sessão não dá para trocar a chave (seria a porta de quem só tem o e-mail)
  await assert.rejects(servico.iniciarAtivacao(admin.id), /já está ativa/);

  // sem cabeçalho: pede o código
  await recusaCom403(guard.canActivate(contexto(admin.id)), ERRO_2FA_CONFIRMACAO_NECESSARIA, /6 dígitos/);
  assert.equal(await guard.canActivate(contexto(admin.id, ativado.confirmacao)), true);

  // código do passo seguinte (dentro da tolerância de relógio) gera nova confirmação de 10 min
  const proximo = codigoTotp(segredo, Date.now() + TOTP_PASSO_SEGUNDOS * 1000);
  const conf = await servico.confirmarAcao(admin.id, proximo);
  const duracaoMs = new Date(conf.expiraEm).getTime() - Date.now();
  assert.ok(duracaoMs > 9 * 60_000 && duracaoMs <= 10 * 60_000 + 1_000, "vale 10 minutos");
  assert.equal(await guard.canActivate(contexto(admin.id, conf.confirmacao)), true);

  // o mesmo código não vale duas vezes
  await assert.rejects(servico.confirmarAcao(admin.id, proximo), /já foi usado/);

  // a confirmação é do usuário: outro admin (com 2FA) não usa a de alguém
  const outro = await novoUsuario("ADMIN");
  await prisma.user.update({ where: { id: outro.id }, data: { totpEnabledAt: new Date() } });
  await recusaCom403(guard.canActivate(contexto(outro.id, conf.confirmacao)), ERRO_2FA_CONFIRMACAO_NECESSARIA);

  // token de SESSÃO não vale como confirmação, e a confirmação não vale como sessão
  const sessao = await createSessionToken({ sub: admin.id, sv: pendente.sessionVersion });
  await recusaCom403(guard.canActivate(contexto(admin.id, sessao)), ERRO_2FA_CONFIRMACAO_NECESSARIA);
  assert.equal(await resolveSessionUserId(`Bearer ${conf.confirmacao}`), null);

  // confirmação vencida não vale
  const vencida = await createSessionToken(
    { sub: admin.id, purpose: CONFIRMACAO_2FA_PROPOSITO, sv: pendente.sessionVersion },
    "0s",
  );
  await recusaCom403(guard.canActivate(contexto(admin.id, vencida)), ERRO_2FA_CONFIRMACAO_NECESSARIA, /expirou/);

  // sessão revogada (troca de senha sobe o sessionVersion): a confirmação cai junto
  await prisma.user.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } });
  await recusaCom403(guard.canActivate(contexto(admin.id, conf.confirmacao)), ERRO_2FA_CONFIRMACAO_NECESSARIA);

  const trilha = await prisma.auditLog.findMany({ where: { actorUserId: admin.id }, select: { action: true } });
  const acoes = trilha.map((t) => t.action);
  for (const acao of ["admin.2fa.setup_started", "admin.2fa.enabled", "admin.2fa.confirmed"]) {
    assert.ok(acoes.includes(acao), `auditoria sem ${acao}`);
  }
});

test("SUPPORT e conta comum ouvem 'restrito' antes de qualquer conversa sobre 2FA", async () => {
  const suporte = await novoUsuario("SUPPORT");
  await assert.rejects(guard.canActivate(contexto(suporte.id)), /restrita a administradores/);
  const comum = await novoUsuario(null);
  await assert.rejects(guard.canActivate(contexto(comum.id)), /restrito à equipe/);
  await assert.rejects(servico.iniciarAtivacao(comum.id), /restrito à equipe/);
  await assert.rejects(servico.confirmarAcao(comum.id, "123456"), /restrito à equipe/);
});

test("quem não ativou não consegue pedir confirmação", async () => {
  const admin = await novoUsuario("ADMIN");
  await recusaCom403(servico.confirmarAcao(admin.id, "123456"), ERRO_2FA_NAO_ATIVADO, /Segurança/);
});

test("5 códigos errados seguidos travam as tentativas, até o código certo", async () => {
  const admin = await novoUsuario("ADMIN");
  const { segredo } = await servico.iniciarAtivacao(admin.id);
  const chave = base32Decode(segredo);
  for (let i = 0; i < 5; i++) {
    await assert.rejects(servico.confirmarAtivacao(admin.id, codigoErrado(chave)), /Código incorreto/);
  }
  await assert.rejects(servico.confirmarAtivacao(admin.id, codigoTotp(chave)), (err: any) => {
    assert.equal(err?.getStatus?.(), 429);
    assert.match(err.message, /15 minutos/);
    return true;
  });
  const depois = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
  assert.equal(depois.totpEnabledAt, null, "travado não liga o 2FA");
});

test("20 códigos errados AO MESMO TEMPO: só 5 chegam a ser conferidos (revisão 2026-10-13)", async () => {
  const admin = await novoUsuario("ADMIN");
  const { segredo } = await servico.iniciarAtivacao(admin.id);
  const chave = base32Decode(segredo);
  const resultados = await Promise.allSettled(
    Array.from({ length: 20 }, () => servico.confirmarAtivacao(admin.id, codigoErrado(chave))),
  );
  const motivos = resultados.map((r) => (r.status === "rejected" ? (r.reason as any) : null));
  assert.ok(motivos.every(Boolean), "nenhum código errado passa");
  const conferidos = motivos.filter((e) => /Código incorreto/.test(e.message)).length;
  const travados = motivos.filter((e) => e.getStatus?.() === 429).length;
  assert.equal(conferidos, 5, "a trava vale mesmo com as requisições em paralelo");
  assert.equal(travados, 15);
});
