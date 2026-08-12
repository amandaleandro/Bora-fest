import { prisma } from "./index";

const BASE_ROLES = [
  { key: "owner", name: "Dono da organização" },
  { key: "admin", name: "Administrador" },
  { key: "operator", name: "Operador de portaria" },
  { key: "finance", name: "Financeiro" },
  { key: "seller", name: "Vendedor" },
];

/**
 * Acesso ao backoffice (2026-08-11): `platformRole` só existia no banco — não
 * havia tela, endpoint nem script para conceder, então o dono do sistema não
 * tinha como entrar em admin.borafest.com.br sem rodar SQL na mão.
 *
 * Bootstrap por variável de ambiente (padrão de mercado): os e-mails listados
 * em PLATFORM_ADMIN_EMAILS (separados por vírgula) viram ADMIN no boot. É
 * idempotente e NÃO rebaixa ninguém — quem já é ADMIN continua ADMIN, e tirar
 * o e-mail da lista não remove o acesso (remoção é ato deliberado, não efeito
 * colateral de editar env). O login continua sendo por OTP no e-mail: quem não
 * recebe o código não entra, mesmo constando aqui.
 */
async function concederBackoffice(): Promise<void> {
  const lista = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.includes("@"));

  for (const email of lista) {
    const usuario = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email },
      select: { id: true, platformRole: true },
    });

    if (usuario.platformRole === "ADMIN") continue;

    await prisma.user.update({
      where: { id: usuario.id },
      data: { platformRole: "ADMIN" },
    });
    console.log(`[seed] acesso ADMIN ao backoffice concedido a ${email}`);
  }
}

async function main() {
  for (const role of BASE_ROLES) {
    await prisma.role.upsert({
      where: { key: role.key },
      update: {},
      create: role,
    });
  }

  await concederBackoffice();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
