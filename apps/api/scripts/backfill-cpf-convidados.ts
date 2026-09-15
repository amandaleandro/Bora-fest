/**
 * BACKFILL: CPF dos convidados que já estavam na lista (2026-09-15).
 *
 * Até hoje o `guestDocument` era gravado em guest_list_entries e MORRIA ali —
 * o ingresso saía com attendeeCpf null e a portaria não tinha hash para
 * conferir. O conserto no serviço vale só para cadastros NOVOS; quem já estava
 * na lista aparecia na porta como "sem CPF" tendo CPF no banco, e entrava só
 * pelo nome — o buraco que a mudança existe para fechar.
 *
 * O worker é idempotente por (orderItemId, seq) e nunca reescreve ticket, então
 * criar OrderAttendee agora não resolve pedido já emitido: este script escreve
 * o CPF direto no ticket. Pelo CLIENTE Prisma, de propósito — `@updatedAt` é
 * aplicado pelo Prisma, não pelo Postgres; um UPDATE em SQL cru deixaria
 * updated_at parado e o delta do manifesto (updatedAt > since) nunca levaria o
 * hash aos aparelhos já sincronizados.
 *
 * Só CPF válido (dígito verificador): gravar "RG 1234" faria o manifesto descer
 * um hash impossível de casar e empurraria o operador para "liberar mesmo
 * assim" — pior que o "sem CPF" honesto de hoje.
 *
 * Uso:  npx tsx scripts/backfill-cpf-convidados.ts            (dry-run)
 *       npx tsx scripts/backfill-cpf-convidados.ts --aplicar
 */
import { prisma } from "@borafest/database";
import { ehCpfValido, normalizarCpf } from "@borafest/contracts";

async function main() {
  const aplicar = process.argv.includes("--aplicar");

  const entradas = await prisma.guestListEntry.findMany({
    where: { guestDocument: { not: null }, status: { not: "CANCELED" }, orderId: { not: null } },
    select: {
      id: true, guestName: true, guestDocument: true, orderId: true, ticketLotId: true,
      order: { select: { tickets: { select: { id: true, attendeeCpf: true } }, attendees: { select: { id: true } } } },
    },
  });

  let ticketsAtualizados = 0, attendeesCriados = 0, invalidos = 0, jaTinham = 0;
  for (const e of entradas) {
    const cpf = normalizarCpf(e.guestDocument);
    if (!ehCpfValido(cpf)) { invalidos++; continue; }
    const semCpf = (e.order?.tickets ?? []).filter((t) => !t.attendeeCpf);
    if (!semCpf.length && (e.order?.attendees.length ?? 0) > 0) { jaTinham++; continue; }

    if (aplicar) {
      for (const t of semCpf) {
        await prisma.ticket.update({ where: { id: t.id }, data: { attendeeCpf: cpf } }); // @updatedAt → delta leva
      }
      if ((e.order?.attendees.length ?? 0) === 0 && e.orderId) {
        await prisma.orderAttendee.create({
          data: { orderId: e.orderId, ticketLotId: e.ticketLotId, name: e.guestName, cpf },
        });
        attendeesCriados++;
      }
    } else if ((e.order?.attendees.length ?? 0) === 0) {
      attendeesCriados++;
    }
    ticketsAtualizados += semCpf.length;
  }

  console.log(`${aplicar ? "APLICADO" : "DRY-RUN"}: ${entradas.length} entradas com documento`);
  console.log(`  tickets ${aplicar ? "atualizados" : "a atualizar"}: ${ticketsAtualizados}`);
  console.log(`  attendees ${aplicar ? "criados" : "a criar"}: ${attendeesCriados}`);
  console.log(`  já completos: ${jaTinham}`);
  console.log(`  documento inválido (pulados, ficam "sem CPF"): ${invalidos}`);
  if (!aplicar) console.log("\nrode com --aplicar para gravar");
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
