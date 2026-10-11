import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { registerEmailSender } from "@borafest/notifications";
import type { EmailMessage } from "@borafest/notifications";
import { createFixtureEvent, cleanupFixtureEvent } from "../../../api/src/__tests__/helpers";
import { montarLinkDoResgate, sendExpiredRescueEmails } from "../abandoned-cart";
import type { AtribuicaoDoPedido } from "../abandoned-cart";

// "Ainda dá tempo" (2026-10-11): o link do resgate leva a etiqueta que o
// PEDIDO gravou (vendedor > promoter > atlética, igual ao servidor), aponta
// direto para /{slug} e pedido com lote de convidado por link não recebe nada.
// O e-mail é capturado aqui — nada sai para caixa de verdade.

const enviados: EmailMessage[] = [];
registerEmailSender({
  provider: "captura-resgate",
  async send(mensagem) {
    enviados.push(mensagem);
  },
});
process.env.EMAIL_PROVIDER = "captura-resgate";
process.env.CHECKOUT_BASE_URL = "https://borafest.com.br";

after(async () => {
  await prisma.$disconnect();
});

const rand = () => Math.random().toString(36).slice(2, 10);
const BASE = "https://borafest.com.br";

const semCanal: AtribuicaoDoPedido = { promoterSeller: null, promoterLink: null, salesPartner: null };

test("link do resgate: vai direto para /{slug}, sem passar por /evento/", () => {
  assert.equal(montarLinkDoResgate(BASE, "festa-x", semCanal), `${BASE}/festa-x`);
  assert.equal(montarLinkDoResgate(`${BASE}/`, "festa-x", semCanal), `${BASE}/festa-x`, "barra no fim da base não duplica");
  assert.ok(!montarLinkDoResgate(BASE, "festa-x", semCanal).includes("/evento/"));
});

test("link do resgate: etiqueta na mesma prioridade do servidor (vendedor > promoter > atlética)", () => {
  const completo: AtribuicaoDoPedido = {
    promoterSeller: { slug: "vd-bia", status: "ACTIVE", promoterLink: { status: "ACTIVE" } },
    promoterLink: { slug: "pr-joao", status: "ACTIVE" },
    salesPartner: { slug: "atletica-x", active: true },
  };
  assert.equal(montarLinkDoResgate(BASE, "festa-x", completo), `${BASE}/festa-x?vd=vd-bia`, "vendedor vence");

  const vendedorRemovido: AtribuicaoDoPedido = {
    ...completo,
    promoterSeller: { slug: "vd-bia", status: "REMOVED", promoterLink: { status: "ACTIVE" } },
  };
  assert.equal(
    montarLinkDoResgate(BASE, "festa-x", vendedorRemovido),
    `${BASE}/festa-x?pr=pr-joao`,
    "vendedor desligado: a venda volta para o promoter dele",
  );

  const promoterRemovido: AtribuicaoDoPedido = {
    promoterSeller: { slug: "vd-bia", status: "ACTIVE", promoterLink: { status: "REMOVED" } },
    promoterLink: { slug: "pr-joao", status: "REMOVED" },
    salesPartner: { slug: "atletica-x", active: true },
  };
  assert.equal(
    montarLinkDoResgate(BASE, "festa-x", promoterRemovido),
    `${BASE}/festa-x?p=atletica-x`,
    "promoter desligado: nem ?vd= nem ?pr= (o servidor ignoraria)",
  );

  assert.equal(
    montarLinkDoResgate(BASE, "festa-x", { ...semCanal, salesPartner: { slug: "atletica-x", active: false } }),
    `${BASE}/festa-x`,
    "atlética inativa: sem etiqueta",
  );
  assert.equal(
    montarLinkDoResgate(BASE, "festa-x", { ...semCanal, promoterLink: { slug: "pr joão&cia", status: "ACTIVE" } }),
    `${BASE}/festa-x?pr=pr%20jo%C3%A3o%26cia`,
    "slug vai codificado: não quebra o link",
  );
});

test("resgate: e-mail leva ?vd=/?pr=/?p= do pedido e pula pedido com lote de convidado", async () => {
  const fx = await createFixtureEvent({ lotCapacity: 50, priceCents: 5000, feeCents: 0 });
  const usuarios: string[] = [];
  try {
    const promoter = await prisma.user.create({ data: { email: `resgate-pr-${rand()}@borafest.dev` } });
    const vendedor = await prisma.user.create({ data: { email: `resgate-vd-${rand()}@borafest.dev` } });
    usuarios.push(promoter.id, vendedor.id);
    const link = await prisma.promoterLink.create({
      data: {
        organizationId: fx.organization.id,
        promoterUserId: promoter.id,
        status: "ACTIVE",
        commissionType: "NONE",
        slug: `pr-${rand()}`,
      },
    });
    const seller = await prisma.promoterSeller.create({
      data: { promoterLinkId: link.id, sellerUserId: vendedor.id, status: "ACTIVE", slug: `vd-${rand()}` },
    });
    const atletica = await prisma.salesPartner.create({
      data: { organizationId: fx.organization.id, name: `Atlética ${rand()}`, slug: `atl-${rand()}` },
    });
    const loteConvidado = await prisma.ticketLot.create({
      data: {
        ticketTypeId: fx.ticketType.id,
        name: "Convidados",
        priceCents: 5000,
        feeCents: 0,
        capacity: 10,
        status: "ACTIVE",
        inviteMode: "LINK",
        inviteToken: `convite-${rand()}${rand()}`,
      },
    });

    // pedido expirado há 2h: dentro da janela do resgate (1h a 6h)
    const expirado = async (
      email: string,
      atribuicao: { promoterLinkId?: string; promoterSellerId?: string; salesPartnerId?: string },
      lotes: string[],
    ) => {
      const reserva = await prisma.reservation.create({
        data: { eventId: fx.event.id, status: "CONVERTED", expiresAt: new Date(Date.now() - 150 * 60_000) },
      });
      return prisma.order.create({
        data: {
          eventId: fx.event.id,
          reservationId: reserva.id,
          ...atribuicao,
          contactEmail: email,
          contactName: "Teste Resgate",
          status: "EXPIRED",
          totalCents: 5000 * lotes.length,
          createdAt: new Date(Date.now() - 150 * 60_000),
          expiresAt: new Date(Date.now() - 120 * 60_000),
          items: {
            create: lotes.map((ticketLotId) => ({ ticketLotId, quantity: 1, priceCents: 5000, feeCents: 0 })),
          },
        },
      });
    };

    const emailVd = `resgate-vd-${rand()}@borafest.dev`;
    const emailPr = `resgate-pr-${rand()}@borafest.dev`;
    const emailP = `resgate-p-${rand()}@borafest.dev`;
    const emailConvidado = `resgate-convidado-${rand()}@borafest.dev`;
    await expirado(emailVd, { promoterLinkId: link.id, promoterSellerId: seller.id }, [fx.lot.id]);
    await expirado(emailPr, { promoterLinkId: link.id }, [fx.lot.id]);
    await expirado(emailP, { salesPartnerId: atletica.id }, [fx.lot.id]);
    // lote aberto + lote de convidado no mesmo pedido: basta um item restrito para pular
    const pedidoConvidado = await expirado(emailConvidado, { promoterLinkId: link.id }, [fx.lot.id, loteConvidado.id]);

    await sendExpiredRescueEmails();

    const doEmail = (para: string) => enviados.filter((m) => m.to === para);
    const pagina = `${BASE}/${fx.event.slug}`;
    const casos: Array<[string, string]> = [
      [emailVd, `${pagina}?vd=${seller.slug}`],
      [emailPr, `${pagina}?pr=${link.slug}`],
      [emailP, `${pagina}?p=${atletica.slug}`],
    ];
    for (const [para, esperado] of casos) {
      const recebidos = doEmail(para);
      assert.equal(recebidos.length, 1, `um resgate para ${para}`);
      assert.ok(recebidos[0]!.html.includes(`href="${esperado}"`), `botão aponta para ${esperado}`);
      assert.ok(recebidos[0]!.text.includes(esperado), `texto leva ${esperado}`);
      assert.ok(!recebidos[0]!.html.includes("/evento/"), "sem o redirecionamento antigo");
    }

    assert.equal(doEmail(emailConvidado).length, 0, "pedido com lote de convidado não recebe resgate");
    const marcado = await prisma.order.findUniqueOrThrow({
      where: { id: pedidoConvidado.id },
      select: { rescueReminderSentAt: true },
    });
    assert.ok(marcado.rescueReminderSentAt, "mas fica marcado como tratado");

    const antes = enviados.length;
    await sendExpiredRescueEmails();
    const repetidos = enviados
      .slice(antes)
      .filter((m) => [emailVd, emailPr, emailP, emailConvidado].includes(m.to));
    assert.equal(repetidos.length, 0, "segunda varredura não repete nem reavalia o convidado");
  } finally {
    // vendedor cai junto com o vínculo do promoter; pedido só perde a referência
    await prisma.promoterLink.deleteMany({ where: { organizationId: fx.organization.id } });
    await prisma.salesPartner.deleteMany({ where: { organizationId: fx.organization.id } });
    await cleanupFixtureEvent(fx.organization.id);
    for (const id of usuarios) await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
});
