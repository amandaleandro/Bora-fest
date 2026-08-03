import path from "node:path";

/** Diretório local de uploads (montado como volume persistente em produção). */
export const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
