import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { createSessionToken } from "@borafest/auth";
import {
  ResendEmailSender,
  registerEmailSender,
  renderCrmReactivationEmail,
  resendHeaders,
  type CrmReactivationPayload,
  type EmailMessage,
} from "@borafest/notifications";
import { resolveSessionUserId } from "../common/session-resolver";
import { IdempotencyService } from "../common/idempotency.service";
import { OrgAccessService } from "../common/org-access.service";
import { CustomerCrmService } from "../customer-crm/customer-crm.service";
import { CrmReactivationService } from "../customer-crm/crm-reactivation.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { EventsService } from "../events/events.service";
import { DescadastroService, LINK_DE_DESCADASTRO_INVALIDO } from "../descadastro/descadastro.service";
import { DescadastroController, querPagina } from "../descadastro/descadastro.controller";
import {
  criarTokenDeDescadastro,
  lerTokenDeDescadastro,
  linksDeDescadastro,
  mascararEmail,
} from "../descadastro/descadastro-token";
import { montarAvisoAosSeguidores } from "../descadastro/aviso-seguidores";
import { ERRO_DESCADASTRADO } from "../descadastro/supressao";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

/**
 * LGPD — sair dos e-mails (2026-10-12). Campanha da Casa e aviso aos
 * seguidores não tinham link para sair. Estes testes provam:
 *  - o link assinado descadastra (campanha → marketing_opt_outs; seguidor →
 *    deixa de seguir aquela Casa), e repetir não duplica;
 *  - link adulterado, cortado, de sessão ou de outro segredo é recusado — e o
 *    link nunca vale como login;
 *  - o disparo de campanha pula quem saiu (prévia, envio e fila pendente);
 *  - os e-mails levam o rodapé e o List-Unsubscribe de um clique.
 */

process.env.SESSION_JWT_SECRET ??= "segredo-so-de-teste-descadastro";

const capturados: EmailMessage[] = [];
registerEmailSender({
  provider: "capture-descadastro",
  async send(message) {
    capturados.push(message);
  },
});
process.env.EMAIL_PROVIDER = "capture-descadastro";

const descadastro = new DescadastroService();
const sufixo = () => Math.random().toString(36).slice(2, 10);

after(async () => {
  await closeRedisConnection();
});

function codigoDoLink(url: string): string {
  const achado = /\/descadastro\/([A-Za-z0-9_-]+)/.exec(url);
  assert.ok(achado, `link de descadastro esperado em: ${url}`);
  return decodeURIComponent(achado[1]);
}

describe("descadastro — o código do link", () => {
  it("ida e volta (seguidor e campanha) e cabe no limite de 100 caracteres do Fastify", () => {
    const organizationId = randomUUID();
    const userId = randomUUID();
    const notificationId = randomUUID();

    const seguidor = criarTokenDeDescadastro({ tipo: "seguidor", organizationId, userId });
    const campanha = criarTokenDeDescadastro({ tipo: "campanha", notificationId });

    for (const token of [seguidor, campanha]) {
      assert.match(token, /^[A-Za-z0-9_-]+$/, "só caracteres seguros na URL");
      assert.ok(token.length <= 100, `parâmetro de rota acima de 100 vira 404 no Fastify (${token.length})`);
    }
    assert.deepEqual(lerTokenDeDescadastro(seguidor), { tipo: "seguidor", organizationId, userId });
    assert.deepEqual(lerTokenDeDescadastro(campanha), { tipo: "campanha", notificationId });
    // nada pessoal no link: só tipo (1 byte), ids (16 cada) e assinatura (16).
    // Pelo TAMANHO, não procurando "@": os bytes aleatórios da assinatura
    // traziam 0x40 em ~12% das execuções (teste instável, 2026-10-13)
    assert.equal(Buffer.from(campanha, "base64url").length, 1 + 16 + 16);
    assert.equal(Buffer.from(seguidor, "base64url").length, 1 + 32 + 16);
  });

  it("token adulterado, cortado, de sessão ou assinado com outro segredo é recusado", async () => {
    const organizationId = randomUUID();
    const userId = randomUUID();
    const valido = criarTokenDeDescadastro({ tipo: "seguidor", organizationId, userId });

    // troca UM caractere no meio (ids) e no fim (assinatura)
    const troca = (texto: string, i: number) =>
      texto.slice(0, i) + (texto[i] === "A" ? "B" : "A") + texto.slice(i + 1);
    assert.equal(lerTokenDeDescadastro(troca(valido, 10)), null, "id adulterado");
    assert.equal(lerTokenDeDescadastro(troca(valido, valido.length - 3)), null, "assinatura adulterada");
    assert.equal(lerTokenDeDescadastro(valido.slice(0, -4)), null, "link cortado");
    assert.equal(lerTokenDeDescadastro(`${valido}x`), null, "lixo no fim");
    assert.equal(lerTokenDeDescadastro(""), null);
    assert.equal(lerTokenDeDescadastro(undefined), null);

    // trocar o usuário do link por outro (sem refazer a assinatura) não passa
    const bytes = Buffer.from(valido, "base64url");
    Buffer.from(randomUUID().replace(/-/g, ""), "hex").copy(bytes, 17);
    assert.equal(lerTokenDeDescadastro(bytes.toString("base64url")), null, "usuário trocado");

    // token de sessão não é link de descadastro
    const sessao = await createSessionToken({ sub: userId, sv: 0 });
    assert.equal(lerTokenDeDescadastro(sessao), null);

    // assinado com outro segredo não vale aqui
    const segredoAtual = process.env.SESSION_JWT_SECRET;
    process.env.SESSION_JWT_SECRET = "outro-segredo-qualquer";
    const deOutroSegredo = criarTokenDeDescadastro({ tipo: "seguidor", organizationId, userId });
    process.env.SESSION_JWT_SECRET = segredoAtual;
    assert.equal(lerTokenDeDescadastro(deOutroSegredo), null);

    // e o link nunca vale como login
    assert.equal(await resolveSessionUserId(`Bearer ${valido}`), null);

    // a API recusa com mensagem clara (ver e confirmar)
    await assert.rejects(() => descadastro.ver(troca(valido, 10)), { message: LINK_DE_DESCADASTRO_INVALIDO });
    await assert.rejects(() => descadastro.confirmar(troca(valido, 10)), { message: LINK_DE_DESCADASTRO_INVALIDO });
  });

  it("e-mail mascarado na página", () => {
    assert.equal(mascararEmail("fulano@gmail.com"), "fu***@gmail.com");
    assert.equal(mascararEmail(" ab@x.com "), "a***@x.com");
    assert.equal(mascararEmail("sem-arroba"), "seu e-mail");
  });
});

describe("descadastro — e-mails levam o link e o List-Unsubscribe", () => {
  it("campanha: rodapé 'Não quero mais receber' e um clique só com HTTPS; fila antiga sai como antes", () => {
    const base: CrmReactivationPayload = {
      campaignId: "crm-teste",
      organizationId: randomUUID(),
      houseName: "Casa Teste",
      subject: "Volta pra festa",
      message: "Tem rolê novo.",
    };
    const comLink = renderCrmReactivationEmail("cliente@example.com", {
      ...base,
      unsubscribeUrl: "https://borafest.com.br/descadastro/abc",
      unsubscribeOneClickUrl: "https://api.borafest.com.br/v1/public/descadastro/abc",
    });
    assert.deepEqual(comLink.headers, {
      "List-Unsubscribe": "<https://api.borafest.com.br/v1/public/descadastro/abc>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    assert.ok(comLink.html.includes('href="https://borafest.com.br/descadastro/abc"'));
    assert.ok(comLink.html.includes("Não quero mais receber"));
    assert.ok(comLink.text.includes("Não quero mais receber: https://borafest.com.br/descadastro/abc"));

    const emDev = renderCrmReactivationEmail("cliente@example.com", {
      ...base,
      unsubscribeUrl: "http://localhost:3000/descadastro/abc",
      unsubscribeOneClickUrl: "http://localhost:3333/v1/public/descadastro/abc",
    });
    assert.deepEqual(emDev.headers, { "List-Unsubscribe": "<http://localhost:3333/v1/public/descadastro/abc>" });

    const filaAntiga = renderCrmReactivationEmail("cliente@example.com", base);
    assert.equal(filaAntiga.headers, undefined);
    assert.equal(filaAntiga.html.includes("Não quero mais receber"), false);
  });

  it("aviso aos seguidores: escapa nome do evento e da Casa, leva link e cabeçalho", () => {
    const aviso = montarAvisoAosSeguidores({
      to: "seguidor@example.com",
      casa: "Casa <Teste>",
      tituloDoEvento: "Festa <script>x</script>",
      linkDoEvento: "https://borafest.com.br/festa",
      descadastro: {
        pagina: "https://borafest.com.br/descadastro/abc",
        umClique: "https://api.borafest.com.br/v1/public/descadastro/abc",
      },
    });
    assert.equal(aviso.html.includes("<script>"), false);
    assert.ok(aviso.html.includes("Festa &lt;script&gt;"));
    assert.ok(aviso.html.includes("Casa &lt;Teste&gt;"));
    assert.ok(aviso.html.includes('href="https://borafest.com.br/descadastro/abc"'));
    assert.equal(aviso.subject, "Casa <Teste> publicou um novo evento");
    assert.equal(aviso.headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  });

  describe("Resend", () => {
    const fetchOriginal = globalThis.fetch;
    let corpos: Array<Record<string, unknown>> = [];

    beforeEach(() => {
      process.env.RESEND_API_KEY = "re_chave_de_teste";
      process.env.EMAIL_FROM = "BoraFest <ingressos@borafest.com.br>";
      corpos = [];
      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        corpos.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ id: "id-do-resend" }), { status: 200 });
      }) as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = fetchOriginal;
      delete process.env.RESEND_API_KEY;
      delete process.env.EMAIL_FROM;
    });

    it("manda os cabeçalhos válidos e descarta quebra de linha e cabeçalho do próprio envio", async () => {
      assert.deepEqual(
        resendHeaders({
          "List-Unsubscribe": "<https://api.borafest.com.br/v1/public/descadastro/abc>",
          "X-Injetado": "valor\r\nBcc: alguem@example.com",
          From: "golpe@example.com",
          "nome com espaço": "x",
        }),
        { "List-Unsubscribe": "<https://api.borafest.com.br/v1/public/descadastro/abc>" },
      );
      assert.deepEqual(resendHeaders(undefined), {});

      await new ResendEmailSender().send({
        to: "cliente@example.com",
        subject: "Oi",
        html: "<p>oi</p>",
        text: "oi",
        headers: { "List-Unsubscribe": "<https://x.test/a>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      assert.deepEqual(corpos[0].headers, {
        "List-Unsubscribe": "<https://x.test/a>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      });

      await new ResendEmailSender().send({ to: "cliente@example.com", subject: "Oi", html: "<p>oi</p>", text: "oi" });
      assert.equal(corpos[1].headers, undefined, "sem cabeçalhos, o campo nem vai");
    });
  });
});

describe("descadastro — rota pública", () => {
  function respostaFalsa() {
    const registro: { status?: number; headers: Record<string, string>; corpo?: unknown; enviado: boolean } = {
      headers: {},
      enviado: false,
    };
    const reply = {
      code(status: number) {
        registro.status = status;
        return reply;
      },
      header(nome: string, valor: string) {
        registro.headers[nome.toLowerCase()] = valor;
        return reply;
      },
      send(corpo?: unknown) {
        registro.corpo = corpo;
        registro.enviado = true;
        return reply;
      },
    };
    return { reply, registro };
  }

  it("navegador abrindo o List-Unsubscribe vai para a página do site; o GET nunca descadastra", async () => {
    assert.equal(querPagina("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"), true);
    assert.equal(querPagina("application/json"), false);
    assert.equal(querPagina(undefined), false);

    const token = criarTokenDeDescadastro({ tipo: "campanha", notificationId: randomUUID() });
    const controller = new DescadastroController(descadastro);
    const { reply, registro } = respostaFalsa();
    await controller.ver(token, "text/html,*/*", reply as never);
    assert.equal(registro.status, 303);
    assert.equal(registro.headers.location, linksDeDescadastro(token).pagina);
    assert.equal(registro.enviado, true);
  });
});

describe("descadastro — banco", () => {
  it("token válido de campanha descadastra, tira da fila só os e-mails daquela Casa e daquele endereço", async () => {
    const fixture = await createFixtureEvent({ lotCapacity: 5 });
    const outraCasa = randomUUID();
    const criadas: string[] = [];
    const notificacao = async (dados: { recipient: string; template?: string; organizationId: string; status?: "PENDING" | "SENT" }) => {
      const linha = await prisma.notification.create({
        data: {
          channel: "EMAIL",
          recipient: dados.recipient,
          template: dados.template ?? "crm_reactivation",
          status: dados.status ?? "PENDING",
          payload: { campaignId: "crm-teste", organizationId: dados.organizationId, houseName: "Casa", subject: "Oi", message: "Tem rolê novo" },
        },
      });
      criadas.push(linha.id);
      return linha.id;
    };

    try {
      // e-mail com "_": o filtro insensitive do Prisma (ILIKE) casaria "ana_b" com "anaxb"
      const doLink = await notificacao({ recipient: "Ana_B@Example.com", organizationId: fixture.organization.id, status: "SENT" });
      const outraCampanhaDaCasa = await notificacao({ recipient: "ana_b@example.com ", organizationId: fixture.organization.id });
      const outraPessoa = await notificacao({ recipient: "anaxb@example.com", organizationId: fixture.organization.id });
      const outraCasaMesmoEmail = await notificacao({ recipient: "ana_b@example.com", organizationId: outraCasa });

      const token = criarTokenDeDescadastro({ tipo: "campanha", notificationId: doLink });

      const antes = await descadastro.ver(token);
      assert.deepEqual(antes, {
        tipo: "campanha",
        casa: fixture.organization.name,
        email: "an***@example.com",
        jaSaiu: false,
      });

      const primeiro = await descadastro.confirmar(token);
      assert.deepEqual(primeiro, { ok: true, tipo: "campanha", casa: fixture.organization.name, jaTinhaSaido: false });

      const saidas = await prisma.marketingOptOut.findMany({ where: { organizationId: fixture.organization.id } });
      assert.deepEqual(saidas.map((s) => s.emailKey), ["ana_b@example.com"], "chave normalizada (minúsculo, sem espaço)");

      const status = async (id: string) => (await prisma.notification.findUniqueOrThrow({ where: { id } })).status;
      assert.equal(await status(outraCampanhaDaCasa), "FAILED", "campanha da Casa ainda na fila não sai mais");
      assert.equal(
        (await prisma.notification.findUniqueOrThrow({ where: { id: outraCampanhaDaCasa } })).error,
        ERRO_DESCADASTRADO,
      );
      assert.equal(await status(outraPessoa), "PENDING", "outra pessoa continua recebendo");
      assert.equal(await status(outraCasaMesmoEmail), "PENDING", "a saída vale só para AQUELA Casa");
      assert.equal(await status(doLink), "SENT", "o que já saiu não é reescrito");

      // clique duplo / um clique do Gmail + botão do site: não duplica, não dá erro
      const repetido = await descadastro.confirmar(token);
      assert.equal(repetido.jaTinhaSaido, true);
      assert.equal(await prisma.marketingOptOut.count({ where: { organizationId: fixture.organization.id } }), 1);
      assert.equal((await descadastro.ver(token)).jaSaiu, true);

      // notificação que não é de campanha (ex.: código de acesso) não vira link de descadastro
      const otp = await notificacao({ recipient: "ana_b@example.com", organizationId: fixture.organization.id, template: "otp_code" });
      await assert.rejects(
        () => descadastro.confirmar(criarTokenDeDescadastro({ tipo: "campanha", notificationId: otp })),
        { message: LINK_DE_DESCADASTRO_INVALIDO },
      );
      // link de notificação que não existe
      await assert.rejects(
        () => descadastro.ver(criarTokenDeDescadastro({ tipo: "campanha", notificationId: randomUUID() })),
        { message: LINK_DE_DESCADASTRO_INVALIDO },
      );
    } finally {
      await prisma.notification.deleteMany({ where: { id: { in: criadas } } });
      await prisma.marketingOptOut.deleteMany({ where: { organizationId: { in: [fixture.organization.id, outraCasa] } } });
      await cleanupFixtureEvent(fixture.organization.id);
    }
  });

  it("token válido de seguidor deixa de seguir AQUELA Casa (e só ela)", async () => {
    const casaA = await createFixtureEvent({ lotCapacity: 5 });
    const casaB = await createFixtureEvent({ lotCapacity: 5 });
    const pessoa = await prisma.user.create({ data: { email: `seguidor-${sufixo()}@example.com` } });
    const organizations = new OrganizationsService(new OrgAccessService());

    try {
      await organizations.follow(casaA.organization.id, pessoa.id);
      await organizations.follow(casaB.organization.id, pessoa.id);

      const token = criarTokenDeDescadastro({ tipo: "seguidor", organizationId: casaA.organization.id, userId: pessoa.id });
      const antes = await descadastro.ver(token);
      assert.equal(antes.tipo, "seguidor");
      assert.equal(antes.jaSaiu, false);
      assert.equal(antes.email, mascararEmail(pessoa.email!));

      const resultado = await descadastro.confirmar(token);
      assert.equal(resultado.jaTinhaSaido, false);
      assert.equal((await organizations.isFollowing(casaA.organization.id, pessoa.id)).following, false);
      assert.equal((await organizations.isFollowing(casaB.organization.id, pessoa.id)).following, true);

      assert.equal((await descadastro.confirmar(token)).jaTinhaSaido, true, "repetir é seguro");
      assert.equal((await descadastro.ver(token)).jaSaiu, true);
    } finally {
      await prisma.organizationFollow.deleteMany({ where: { userId: pessoa.id } });
      await cleanupFixtureEvent(casaA.organization.id);
      await cleanupFixtureEvent(casaB.organization.id);
      await prisma.user.delete({ where: { id: pessoa.id } }).catch(() => undefined);
    }
  });

  it("aviso de evento novo aos seguidores leva o link, e o link deixa de seguir", async () => {
    const fixture = await createFixtureEvent({ lotCapacity: 5 });
    const seguidor = await prisma.user.create({ data: { email: `aviso-${sufixo()}@example.com` } });
    const dono = await prisma.user.create({ data: { email: `dono-${sufixo()}@example.com` } });
    const organizations = new OrganizationsService(new OrgAccessService());

    try {
      await prisma.organizationMember.create({
        data: { organizationId: fixture.organization.id, userId: dono.id, roleId: fixture.ownerRoleId, status: "ACTIVE" },
      });
      await organizations.follow(fixture.organization.id, seguidor.id);

      const events = new EventsService(new OrgAccessService());
      const rascunho = await events.create(fixture.organization.id, dono.id, {
        title: "Evento Com Descadastro",
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 90_000_000).toISOString(),
        timezone: "America/Sao_Paulo",
      } as never);

      const antes = capturados.length;
      await events.publish(rascunho.id, dono.id);
      // o aviso sai fora do caminho da requisição — espera o envio terminar
      for (let i = 0; i < 50 && !capturados.slice(antes).some((m) => m.to === seguidor.email); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const aviso = capturados.slice(antes).find((m) => m.to === seguidor.email);
      assert.ok(aviso, "o seguidor recebeu o aviso");
      assert.ok(aviso.headers?.["List-Unsubscribe"]?.includes("/v1/public/descadastro/"));
      assert.ok(aviso.text.includes("Não quero mais receber:"));

      const token = codigoDoLink(aviso.text);
      await descadastro.confirmar(token);
      assert.equal((await organizations.isFollowing(fixture.organization.id, seguidor.id)).following, false);
    } finally {
      await prisma.organizationFollow.deleteMany({ where: { organizationId: fixture.organization.id } });
      await prisma.auditLog.deleteMany({ where: { organizationId: fixture.organization.id } });
      await prisma.organizationMember.deleteMany({ where: { organizationId: fixture.organization.id } });
      await cleanupFixtureEvent(fixture.organization.id);
      await prisma.user.deleteMany({ where: { id: { in: [seguidor.id, dono.id] } } });
    }
  });

  it("campanha pula quem saiu: prévia, disparo e auditoria", async () => {
    const fixture = await createFixtureEvent({ lotCapacity: 100, priceCents: 7000, feeCents: 700 });
    const usuarios: string[] = [];
    const reactivation = new CrmReactivationService(
      new CustomerCrmService(new OrgAccessService()),
      new IdempotencyService(),
    );

    const pedidoPago = async (userId: string, email: string, name: string) => {
      const reserva = await prisma.reservation.create({
        data: { eventId: fixture.event.id, userId, status: "CONVERTED", expiresAt: new Date(Date.now() + 60_000) },
      });
      await prisma.order.create({
        data: {
          eventId: fixture.event.id,
          reservationId: reserva.id,
          userId,
          contactEmail: email,
          contactName: name,
          status: "PAID",
          totalCents: 7000,
          paidAt: new Date(),
        },
      });
    };

    try {
      const dono = await prisma.user.create({ data: { email: `crm-dono-${sufixo()}@example.com` } });
      usuarios.push(dono.id);
      await prisma.organizationMember.create({
        data: { organizationId: fixture.organization.id, userId: dono.id, roleId: fixture.ownerRoleId, status: "ACTIVE" },
      });

      const fica = await prisma.user.create({
        data: { email: `crm-fica-${sufixo()}@example.com`, name: "Cliente Fica", notifyEmailOffers: true },
      });
      const sai = await prisma.user.create({
        data: { email: `crm-sai-${sufixo()}@example.com`, name: "Cliente Sai", notifyEmailOffers: true },
      });
      usuarios.push(fica.id, sai.id);
      await pedidoPago(fica.id, fica.email!, fica.name!);
      // e-mail do pedido com maiúsculas: a saída vale pela chave normalizada
      await pedidoPago(sai.id, sai.email!.toUpperCase(), sai.name!);

      // 1ª campanha: os dois recebem, cada um com o próprio link
      const primeira = await reactivation.send(fixture.organization.id, dono.id, `chave-1-${sufixo()}`, {
        segment: "ALL",
        subject: "Volta pra festa",
        message: "Tem rolê novo chegando.",
      });
      assert.equal(primeira.queued, 2);

      const filaDaCasa = () =>
        prisma.notification.findMany({
          where: { template: "crm_reactivation", payload: { path: ["organizationId"], equals: fixture.organization.id } },
        });
      const primeiraFila = await filaDaCasa();
      assert.equal(primeiraFila.length, 2);
      const doSai = primeiraFila.find((n) => n.recipient.toLowerCase() === sai.email!.toLowerCase());
      assert.ok(doSai);
      const payload = doSai.payload as unknown as CrmReactivationPayload;
      assert.ok(payload.unsubscribeUrl?.includes("/descadastro/"));
      assert.ok(payload.unsubscribeOneClickUrl?.includes("/v1/public/descadastro/"));
      // o link aponta para a linha DESTE destinatário
      assert.deepEqual(lerTokenDeDescadastro(codigoDoLink(payload.unsubscribeUrl!)), {
        tipo: "campanha",
        notificationId: doSai.id,
      });
      const renderizado = renderCrmReactivationEmail(doSai.recipient, payload);
      assert.ok(renderizado.headers?.["List-Unsubscribe"]?.includes("/v1/public/descadastro/"));

      // "Cliente Sai" clica em "Não quero mais receber"
      await descadastro.confirmar(codigoDoLink(payload.unsubscribeUrl!));
      const depois = await prisma.notification.findUniqueOrThrow({ where: { id: doSai.id } });
      assert.equal(depois.status, "FAILED", "o e-mail dele que ainda estava na fila não sai mais");

      // prévia: só quem ficou, e a contagem de quem saiu
      const previa = await reactivation.preview(fixture.organization.id, dono.id, { segment: "ALL" });
      assert.equal(previa.eligibleCount, 1);
      assert.equal(previa.optedOutCount, 1);
      assert.equal(previa.sample.some((s) => s.name === "Cliente Sai"), false);

      // 2ª campanha: pula quem saiu
      const segunda = await reactivation.send(fixture.organization.id, dono.id, `chave-2-${sufixo()}`, {
        segment: "ALL",
        subject: "Mais um rolê",
        message: "Outra festa chegando.",
      });
      assert.equal(segunda.queued, 1);
      const novas = (await filaDaCasa()).filter((n) => (n.payload as { campaignId?: string }).campaignId === segunda.campaignId);
      assert.deepEqual(novas.map((n) => n.recipient.toLowerCase()), [fica.email!.toLowerCase()]);

      const auditoria = await prisma.auditLog.findFirstOrThrow({
        where: { organizationId: fixture.organization.id, action: "crm.reactivation.send", entityId: segunda.campaignId },
      });
      assert.equal((auditoria.metadata as { queued?: number }).queued, 1);
      assert.equal((auditoria.metadata as { skippedOptOut?: number }).skippedOptOut, 1);

      // se todo o segmento saiu, o disparo recusa com o motivo certo (e nada entra na fila)
      await descadastro.confirmar(
        codigoDoLink((novas[0].payload as unknown as CrmReactivationPayload).unsubscribeUrl!),
      );
      const antesDaRecusa = (await filaDaCasa()).length;
      await assert.rejects(
        () =>
          reactivation.send(fixture.organization.id, dono.id, `chave-3-${sufixo()}`, {
            segment: "ALL",
            subject: "Ninguém vai receber",
            message: "Esta campanha não deve sair.",
          }),
        /pediram para não receber campanhas desta Casa/,
      );
      assert.equal((await filaDaCasa()).length, antesDaRecusa);
    } finally {
      await prisma.notification.deleteMany({
        where: { template: "crm_reactivation", payload: { path: ["organizationId"], equals: fixture.organization.id } },
      });
      await prisma.marketingOptOut.deleteMany({ where: { organizationId: fixture.organization.id } });
      await prisma.auditLog.deleteMany({ where: { organizationId: fixture.organization.id } });
      await prisma.idempotencyKey.deleteMany({ where: { scope: `crm-reactivation:${fixture.organization.id}` } });
      await prisma.organizationMember.deleteMany({ where: { organizationId: fixture.organization.id } });
      await cleanupFixtureEvent(fixture.organization.id);
      await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
    }
  });
});
