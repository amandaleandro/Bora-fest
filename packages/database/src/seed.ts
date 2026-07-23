import { prisma } from "./index";

const BASE_ROLES = [
  { key: "owner", name: "Dono da organização" },
  { key: "admin", name: "Administrador" },
  { key: "operator", name: "Operador de portaria" },
  { key: "finance", name: "Financeiro" },
];

async function main() {
  for (const role of BASE_ROLES) {
    await prisma.role.upsert({
      where: { key: role.key },
      update: {},
      create: role,
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
