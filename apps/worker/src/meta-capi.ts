import { createHash } from "node:crypto";
import { prisma } from "@borafest/database";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "meta-capi" });

const GRAPH_VERSION = process.env.META_CAPI_VERSION ?? "v21.0";

/**
 * API de Conversões da Meta (2026-08-20). O pixel do navegador perde uma fatia
 * grande dos eventos — bloqueador de anúncio, iOS/ITP, Safari, aba fechada
 * antes do script carregar. Aqui a compra sai do NOSSO servidor, onde nada
 * bloqueia, com os dados do comprador hasheados.
 *
 * Dedupe: mandamos o mesmo `event_id` que o navegador manda (o id do pedido).
 * A Meta junta os dois e conta UMA conversão — sem isso o relatório dobra.
 */

/** A Meta exige SHA-256 dos dados pessoais; texto normalizado antes do hash. */
function hash(valor: string | null | undefined): string | undefined {
  if (!valor) return undefined;
  const limpo = valor.trim().toLowerCase();
  if (!limpo) return undefined;
  return createHash("sha256").update(limpo).digest("hex");
}

/** Telefone com DDI e só dígitos (padrão exigido pela Meta). */
function hashTelefone(bruto: string | null | undefined): string | undefined {
  if (!bruto) return undefined;
  let d = bruto.replace(/\D/g, "");
  if (!d) return undefined;
  if (d.length <= 11) d = `55${d}`; // número BR sem DDI
  return createHash("sha256").update(d).digest("hex");
}

export async function sendPurchaseToMeta(orderId: string): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        totalCents: true,
        contactEmail: true,
        contactName: true,
        contactPhone: true,
        paidAt: true,
        createdAt: true,
        event: {
          select: { id: true, slug: true, title: true, pixelSettings: true, metaCapiToken: true },
        },
      },
    });
    if (!order) return;

    const token = order.event.metaCapiToken;
    const pixelId = (order.event.pixelSettings as { metaPixelId?: string } | null)?.metaPixelId;
    // sem pixel ou sem token: o produtor não ativou — silêncio, não é erro
    if (!token || !pixelId) return;

    const [primeiro, ...resto] = (order.contactName ?? "").trim().split(/\s+/);
    const site = process.env.CHECKOUT_PUBLIC_URL ?? "https://borafest.com.br";

    const body = {
      data: [
        {
          event_name: "Purchase",
          event_time: Math.floor((order.paidAt ?? order.createdAt).getTime() / 1000),
          // MESMO id que o navegador usa — é o que impede a conversão dobrada
          event_id: order.id,
          event_source_url: `${site}/${order.event.slug}`,
          action_source: "website",
          user_data: {
            em: hash(order.contactEmail),
            ph: hashTelefone(order.contactPhone),
            fn: hash(primeiro),
            ln: hash(resto.join(" ")),
            country: hash("br"),
          },
          custom_data: {
            currency: "BRL",
            value: order.totalCents / 100,
            content_type: "product",
            content_name: order.event.title,
            content_ids: [order.event.id],
          },
        },
      ],
      ...(process.env.META_CAPI_TEST_CODE ? { test_event_code: process.env.META_CAPI_TEST_CODE } : {}),
    };

    const resposta = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    );

    if (!resposta.ok) {
      const texto = await resposta.text().catch(() => "");
      // não relança: marketing nunca pode derrubar a emissão do ingresso
      log.warn({ orderId, status: resposta.status, corpo: texto.slice(0, 300) }, "Meta CAPI recusou o evento");
      return;
    }
    log.info({ orderId, pixelId }, "compra enviada à API de Conversões da Meta");
  } catch (erro) {
    log.warn({ orderId, erro: (erro as Error).message }, "falha ao enviar compra à Meta (ignorada)");
  }
}
