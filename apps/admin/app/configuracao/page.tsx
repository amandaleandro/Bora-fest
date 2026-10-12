"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { dataHora, pedirApi } from "../emails/api";

/** Resposta de GET /v1/admin/config (apps/api/src/admin/admin-config.service.ts). */
interface ItemDeConfiguracao {
  variavel: string;
  rotulo: string;
  valor: string;
  definida: boolean;
  padrao: string | null;
  alerta: string | null;
}

interface GrupoDeConfiguracao {
  titulo: string;
  nota: string | null;
  itens: ItemDeConfiguracao[];
}

interface ConfiguracaoEfetiva {
  geradaEm: string;
  ambiente: string;
  grupos: GrupoDeConfiguracao[];
  exemplosDeTaxa: { metodo: string; valor: string; taxa: string }[];
  avisos: string[];
}

/**
 * Configuração (2026-10-12), só leitura: o que a API está USANDO agora. As
 * variáveis vivem só no EasyPanel e já passaram por cima do código sem
 * ninguém ver (taxa Pix de R$ 2,50 em 14/08). Segredo aparece só como
 * "definida"/"ausente" — o valor nunca sai da API.
 */
function ConfiguracaoContent() {
  const { token } = useAuth();
  const [config, setConfig] = useState<ConfiguracaoEfetiva | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    pedirApi<ConfiguracaoEfetiva>("/v1/admin/config", token)
      .then(setConfig)
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível carregar a configuração"))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main>
      <Nav />
      <div className="flex items-center justify-between">
        <h1 className="mt-6 text-xl font-semibold">Configuração em uso</h1>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="mt-6 rounded-lg border border-slate-700/50 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          Atualizar
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-400">
        Somente leitura: valores que a API está usando agora. Para mudar, altere a variável no EasyPanel e reimplante
        a API — e o worker, quando a variável também for dele.
      </p>

      {loading ? (
        <p className="mt-6 text-gray-400">Carregando...</p>
      ) : error ? (
        <div className="mt-6 rounded-2xl border border-rose-500/30 bg-rose-950/30 p-4 text-sm text-rose-300">
          <p>{error}</p>
          <button type="button" onClick={load} className="mt-2 font-semibold underline">
            Tentar novamente
          </button>
        </div>
      ) : config ? (
        <>
          <p className="mt-4 text-xs text-slate-500">
            Ambiente: <span className="font-mono text-slate-300">{config.ambiente}</span> · lida em{" "}
            {dataHora(config.geradaEm)}
          </p>

          {config.avisos.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-950/30 p-4 text-sm text-amber-200">
              <p className="font-semibold">Pede atenção</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {config.avisos.map((aviso) => (
                  <li key={aviso}>{aviso}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-4 text-sm text-emerald-400">Nada pede atenção na configuração da API.</p>
          )}

          {config.grupos.map((grupo) => (
            <section key={grupo.titulo} className="mt-8">
              <h2 className="text-sm font-semibold text-slate-200">{grupo.titulo}</h2>
              {grupo.nota ? <p className="mt-1 text-xs text-slate-500">{grupo.nota}</p> : null}
              <div className="mt-2 overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/50">
                <table className="w-full text-sm">
                  <tbody>
                    {grupo.itens.map((item) => {
                      const foraDoPadrao = item.definida && item.padrao !== null && item.valor !== item.padrao;
                      const origem = !item.definida
                        ? item.padrao !== null
                          ? "padrão do código"
                          : "não definida"
                        : "definida no ambiente";
                      return (
                        <tr key={item.variavel} className="border-b border-slate-800/50 align-top last:border-0">
                          <td className="w-1/3 p-3">
                            {item.rotulo}
                            <span className="block font-mono text-[11px] text-slate-500">{item.variavel}</span>
                          </td>
                          <td className="p-3">
                            <span className={`font-medium ${item.alerta ? "text-amber-300" : "text-slate-100"}`}>
                              {item.valor}
                            </span>
                            {item.alerta ? <span className="mt-1 block text-xs text-amber-300">{item.alerta}</span> : null}
                          </td>
                          <td className="whitespace-nowrap p-3 text-right text-xs text-slate-500">
                            {foraDoPadrao ? (
                              <span className="text-sky-300">diferente do padrão ({item.padrao})</span>
                            ) : (
                              origem
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {grupo.titulo.startsWith("Taxa") && config.exemplosDeTaxa.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs text-slate-500">
                    Exemplos calculados pela mesma conta que define a taxa dos lotes (casa sem taxa própria):
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {config.exemplosDeTaxa.map((ex) => (
                      <span
                        key={`${ex.metodo}-${ex.valor}`}
                        className="rounded-lg border border-slate-700/50 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300"
                      >
                        {ex.metodo} de {ex.valor} → taxa {ex.taxa}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          ))}
        </>
      ) : null}
    </main>
  );
}

export default function ConfiguracaoPage() {
  return (
    <AuthGuard>
      <ConfiguracaoContent />
    </AuthGuard>
  );
}
