/**
 * SEGUNDO FATOR (2026-10-12): as ações de dinheiro do backoffice pedem o
 * código do app autenticador. A API troca o código por uma confirmação de 10
 * minutos; ela fica guardada aqui até vencer, para não pedir o código a cada
 * clique. O Sair (lib/auth.tsx) apaga.
 *
 * O modal (components/Confirmacao2faModal.tsx) se registra aqui; lib/api.ts
 * chama pedirConfirmacao2fa quando a API responde que falta a confirmação.
 */
const STORAGE_KEY = "borafest-admin-2fa";
/** não manda uma confirmação que vence no caminho até a API */
const MARGEM_MS = 15_000;

export function lerConfirmacao2fa(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const guardada = JSON.parse(raw) as { confirmacao?: string; expiraEm?: string };
    const expiraMs = guardada.expiraEm ? new Date(guardada.expiraEm).getTime() : 0;
    if (!guardada.confirmacao || !(expiraMs - MARGEM_MS > Date.now())) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return guardada.confirmacao;
  } catch {
    return null;
  }
}

export function guardarConfirmacao2fa(confirmacao: string, expiraEm: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ confirmacao, expiraEm }));
  } catch {
    // sem armazenamento (aba anônima bloqueada): o código é pedido de novo na próxima ação
  }
}

export function limparConfirmacao2fa(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nada a limpar
  }
}

/** recebe o token da sessão e devolve a confirmação, ou null se a pessoa cancelou */
type PedidoDeCodigo = (sessionToken: string) => Promise<string | null>;

let pedirCodigo: PedidoDeCodigo | null = null;
let pedidoEmAndamento: Promise<string | null> | null = null;

export function registrarPedidoDeCodigo2fa(pedido: PedidoDeCodigo): () => void {
  pedirCodigo = pedido;
  return () => {
    if (pedirCodigo === pedido) pedirCodigo = null;
  };
}

/** Abre o modal UMA vez, mesmo com duas ações disparadas juntas. */
export function pedirConfirmacao2fa(sessionToken: string): Promise<string | null> {
  if (!pedirCodigo) return Promise.resolve(null);
  if (!pedidoEmAndamento) {
    pedidoEmAndamento = pedirCodigo(sessionToken).finally(() => {
      pedidoEmAndamento = null;
    });
  }
  return pedidoEmAndamento;
}
