/**
 * CIFRAR AS CHAVES DOS QR QUE JÁ ESTÃO NO BANCO (2026-10-12).
 *
 * A partir de hoje a chave privada que assina os QR de cada evento é gravada
 * cifrada (AES-256-GCM, chave mestra em TICKET_KEY_ENCRYPTION_KEY) — mas só a
 * dos eventos que ganharem chave DEPOIS do deploy. As que já existem continuam
 * em texto puro no banco (e no backup) até este script passar por elas. A
 * leitura na API e no worker aceita os dois formatos, então dá para rodar com
 * o sistema no ar, sem janela de manutenção.
 *
 * ORDEM — senão a emissão de ingresso para:
 *   1. a MESMA TICKET_KEY_ENCRYPTION_KEY definida na API e no worker, os dois
 *      reiniciados (o log do boot deixa de avisar "TEXTO PURO");
 *   2. este script sem --aplicar (só confere e conta), depois com --aplicar.
 * Rodar antes do passo 1 deixaria o worker com uma chave cifrada que ele não
 * sabe abrir. A chave mestra precisa ser guardada FORA do servidor também:
 * perdida, nenhum evento já cifrado consegue assinar QR novo.
 *
 * Idempotente: só toca linha em texto puro, e grava com condição no valor lido
 * (UPDATE … WHERE private_key_pem = <o que foi lido>) — rodar de novo, ou junto
 * com o worker criando chave de evento novo, não cifra duas vezes nem perde
 * nada. Antes de gravar, decifra de volta e confere que sai o mesmo PEM.
 *
 * Os backups feitos ANTES disto continuam com a chave em texto puro: guarde ou
 * descarte com o mesmo cuidado do banco.
 *
 * Uso (no container da api, a mesma variável já definida nele):
 *   cd apps/api && npx tsx scripts/cifrar-chaves-qr.ts            (só confere)
 *   cd apps/api && npx tsx scripts/cifrar-chaves-qr.ts --aplicar
 */
import { createPrivateKey, createPublicKey } from "crypto";
import { prisma } from "@borafest/database";
import {
  chavePrivadaEstaCifrada,
  cifrarChavePrivada,
  decifrarChavePrivada,
  lerChaveMestra,
  VARIAVEL_CHAVE_MESTRA,
} from "@borafest/tickets";

/** A chave privada é mesmo a par da pública gravada? (só informativo) */
function bateComAPublica(privateKeyPem: string, publicKeyPem: string): boolean {
  try {
    const publica = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "pem" });
    return publica.toString().trim() === publicKeyPem.trim();
  } catch {
    return false;
  }
}

async function main() {
  const aplicar = process.argv.includes("--aplicar");

  const chaveMestra = lerChaveMestra(); // mal formada já lança com a explicação
  if (!chaveMestra) {
    console.error(
      `${VARIAVEL_CHAVE_MESTRA} não está definida neste ambiente — nada foi feito.\n` +
        "Defina aqui a MESMA chave da API e do worker e rode de novo.",
    );
    process.exitCode = 1;
    return;
  }

  const chaves = await prisma.eventSigningKey.findMany({
    select: { id: true, eventId: true, publicKeyPem: true, privateKeyPem: true },
    orderBy: { createdAt: "asc" },
  });

  let jaCifradas = 0;
  let cifradasAgora = 0;
  let aCifrar = 0;
  let mudaramNoMeio = 0;
  let deOutraChave = 0;
  let parNaoBate = 0;

  for (const k of chaves) {
    if (chavePrivadaEstaCifrada(k.privateKeyPem)) {
      // já cifrada: confere que abre com a chave mestra DESTE ambiente
      try {
        decifrarChavePrivada(k.privateKeyPem, chaveMestra);
        jaCifradas++;
      } catch {
        deOutraChave++;
        console.error(`  evento ${k.eventId}: cifrada, mas NÃO abre com a ${VARIAVEL_CHAVE_MESTRA} atual`);
      }
      continue;
    }

    if (!bateComAPublica(k.privateKeyPem, k.publicKeyPem)) {
      // problema anterior a este script: cifra igual (não muda nada no uso),
      // só deixa registrado para alguém olhar
      parNaoBate++;
      console.warn(`  evento ${k.eventId}: a chave privada não bate com a pública gravada (já era assim)`);
    }

    if (!aplicar) {
      aCifrar++;
      continue;
    }

    const cifrada = cifrarChavePrivada(k.privateKeyPem, chaveMestra);
    if (decifrarChavePrivada(cifrada, chaveMestra) !== k.privateKeyPem) {
      throw new Error(`evento ${k.eventId}: a volta da cifra não deu o mesmo PEM — nada gravado para ele`);
    }
    const r = await prisma.eventSigningKey.updateMany({
      where: { id: k.id, privateKeyPem: k.privateKeyPem },
      data: { privateKeyPem: cifrada },
    });
    if (r.count === 1) cifradasAgora++;
    else mudaramNoMeio++; // alguém mexeu na linha entre ler e gravar — fica para a próxima rodada
  }

  console.log(`${aplicar ? "APLICADO" : "SÓ CONFERÊNCIA"}: ${chaves.length} chaves de evento no banco`);
  console.log(`  já cifradas (abrem com a chave atual): ${jaCifradas}`);
  if (aplicar) {
    console.log(`  cifradas agora: ${cifradasAgora}`);
    if (mudaramNoMeio > 0) console.log(`  mudaram durante a execução (rode de novo): ${mudaramNoMeio}`);
  } else {
    console.log(`  em texto puro, a cifrar: ${aCifrar}`);
  }
  if (parNaoBate > 0) console.log(`  privada que não bate com a pública (já era assim): ${parNaoBate}`);
  if (deOutraChave > 0) {
    console.error(
      `  ATENÇÃO: ${deOutraChave} chave(s) cifrada(s) com OUTRA chave mestra — a API e o worker ` +
        `não conseguem assinar QR desses eventos. Confira se a ${VARIAVEL_CHAVE_MESTRA} é a mesma em todos os serviços.`,
    );
    process.exitCode = 1;
  }
  if (!aplicar) console.log("\nrode com --aplicar para gravar");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
