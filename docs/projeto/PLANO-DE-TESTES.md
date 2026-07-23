# PLANO DE TESTES — BoraFest

> Rascunho para revisão (Arthur + Amanda). Base: testes bloqueantes da
> arquitetura (§22) + o que já foi validado nas sessões de 2026-07-23.
> Marcar ✅ com data/executor quando cada item passar; um item reprovado
> vira bug no diário do REGISTRO e bloqueia o lançamento até resolver.

Legenda de status: ✅ passou · 🟡 parcial · ⬜ pendente
Ambiente: **local** (docker dev) · **homolog** (compose de produção) · **celular**

---

## 1. Compra e pagamentos (§22 itens 1–6)

| # | Cenário | Como testar | Status |
|---|---|---|---|
| 1.1 | Concorrência no último ingresso (N compradores, 1 vaga) | script com N reservas simultâneas; exatamente `capacidade` criadas | ✅ 2026-07-23 (10 → lote de 3, zero overselling; + regressão automatizada em `apps/api/src/__tests__` e carga HTTP via `load-test`) |
| 1.2 | Webhook duplicado | reenviar o mesmo evento assinado; 2ª resposta `duplicate`, sem ingresso extra | ✅ 2026-07-23 |
| 1.3 | Webhook fora de ordem | mandar `payment.paid` depois de `refunded`; status monetário não regride | 🟡 coberto por `applyGatewayStatus` (guardas), falta caso explícito |
| 1.4 | Pagamento aprovado após pedido expirar | expirar pedido, mandar PAID atrasado → estorno automático | ✅ 2026-07-23 (bug achado e corrigido) |
| 1.5 | Timeout durante emissão / reprocesso do outbox | matar worker no meio da emissão e religar; nenhum ingresso duplicado | 🟡 garantido por unique (order_item, seq); falta ensaio de queda real |
| 1.6 | Reembolso total (backoffice) | estornar pedido FULFILLED; pagamento REFUNDED, ingressos revogados, ledger zerado, estoque devolvido | ✅ 2026-07-23 (fase 9) |
| 1.7 | Reembolso parcial | — | ⬜ recurso ainda não implementado (V1) |
| 1.8 | Idempotency-Key: replay e payload divergente | mesma key 2× (mesma resposta) / payload diferente (422) | ✅ 2026-07-23 |
| 1.9 | **Pagar.me sandbox real** (Pix + cartão de teste + webhook Basic) | quando a conta PSP existir; refazer 1.2–1.4 contra o sandbox | ⬜ trava: conta PSP (comercial) |

## 2. Ingresso e QR (§22 itens 7)

| # | Cenário | Como testar | Status |
|---|---|---|---|
| 2.1 | QR adulterado rejeitado (servidor) | alterar bytes do token; `POST /v1/checkins` → INVALID | ✅ 2026-07-23 |
| 2.2 | QR adulterado rejeitado (app, offline) | mesma alteração no app sem rede | 🟡 verificação Ed25519 no app implementada + teste cruzado no CI; falta rodar NO celular |
| 2.3 | Reenvio sem criar novo ingresso | reenviar por e-mail/WhatsApp; mesmo ticket, sem duplicata | ✅ 2026-07-23 (com rate-limit) |

## 3. Check-in e portaria (§22 itens 8–11)

| # | Cenário | Como testar | Status |
|---|---|---|---|
| 3.1 | Vários aparelhos validando o mesmo ingresso ao mesmo tempo | 2+ devices, mesmo QR; exatamente 1 VALID, demais ALREADY_USED com origem | ✅ 2026-07-23 (nível API) · ⬜ com 2 celulares reais |
| 3.2 | Aparelhos offline usando o mesmo ingresso | 2 devices offline → sync; 1º CONFIRMED, 2º CONFLICT auditado | ✅ 2026-07-23 (nível API) · ⬜ com celulares |
| 3.3 | Sincronização interrompida e retomada | reenviar lote com mesmo batchKey; resultado idêntico, sem duplicar | ✅ 2026-07-23 (nível API) |
| 3.4 | Cancelamento de ingresso já baixado offline | bloquear ingresso no backoffice após device baixar manifesto; sync/scan acusa | ⬜ |
| 3.5 | Bloqueio remoto de aparelho | bloquear no painel; próximo scan 401 | ✅ 2026-07-23 (nível API) |
| 3.6 | Reversão de check-in com auditoria | reverter no painel; ingresso volta a ACTIVE + audit_log | ✅ 2026-07-23 |
| 3.7 | **App no celular**: câmera, luz baixa, permissão negada, pouca bateria | Expo Go em Android físico (dev build depois) | ⬜ trava: celular |
| 3.8 | Perda de rede durante download do manifesto | derrubar rede no meio do sync; app não corrompe cache | ⬜ celular |

## 4. Frontends web

| # | Cenário | Como testar | Status |
|---|---|---|---|
| 4.1 | Compra completa clicada (evento → Pix → carteira) | navegador real | ✅ 2026-07-23 |
| 4.2 | Painel do produtor completo (OTP, dashboard, portaria, financeiro) | navegador real | ✅ 2026-07-23 |
| 4.3 | Backoffice completo (ADMIN, pedidos, filas, auditoria) | navegador real | ✅ 2026-07-23 |
| 4.4 | Ações POST sem corpo (estorno, bloqueio, marcar pago) pós-fix | clicar em cada uma no navegador | 🟡 reenvio validado; estorno/bloqueio/marcar-pago via curl — falta clicar |
| 4.5 | Mobile responsivo do checkout (viewport de celular) | devtools/celular real | ⬜ |
| 4.6 | Sessão expirada no painel/admin (token inválido → login) | forçar token vencido | ⬜ |

## 5. Homologação (compose de produção) — pré-piloto

| # | Cenário | Como testar | Status |
|---|---|---|---|
| 5.1 | Sobe do zero num host limpo (migrate → api → worker → fronts → HTTPS) | seguir DEPLOY.md à risca num VPS | ⬜ |
| 5.2 | Restauração de backup + retomada das filas (§22) | restaurar dump noutro container; conferir consistência | ⬜ |
| 5.3 | Atualização de versão sem derrubar venda | `up -d --build` durante compras simuladas | ⬜ |
| 5.4 | Carga de checkout (centenas de reservas/min) e de scanner (pico de entrada) | k6/artillery contra homolog | 🟡 estoque sob carga HTTP real já coberto local (`pnpm --filter @borafest/api load-test`, Amanda); falta em homolog + scanner |

## 6. Segurança/LGPD mínimos do piloto (§15)

| # | Cenário | Status |
|---|---|---|
| 6.1 | Rate limit em OTP e checkout | ✅ 2026-07-23 (Amanda — RateLimitGuard global + limites por destino/IP) |
| 6.2 | Enumeração de pedido/ingresso (tokens UUID não sequenciais) | ✅ por construção; conferir superfícies novas |
| 6.3 | Consentimento LGPD no checkout | ⬜ (item MVP §17 ainda sem UI) |
| 6.4 | Acesso restrito a CPF/documentos | 🟡 revisar quando KYC real entrar |

---

## Ordem sugerida de execução

1. **Agora (sem depender de nada)**: 1.3, 1.5, 3.4, 4.4–4.6 — dá para automatizar/clicar local.
2. **Com o celular do Arthur**: 2.2, 3.1–3.2 (com 2 aparelhos se possível), 3.7, 3.8.
3. **Com VPS**: bloco 5 inteiro.
4. **Com conta Pagar.me**: 1.9 (refaz o bloco 1 contra sandbox real).
5. **Pré-lançamento**: repetir §22 completo em homolog e congelar.
