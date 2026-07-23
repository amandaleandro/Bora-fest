import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __borafestPrisma: PrismaClient | undefined;
}

export const prisma = global.__borafestPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__borafestPrisma = prisma;
}

export * from "@prisma/client";
export * from "./inventory-ops";
