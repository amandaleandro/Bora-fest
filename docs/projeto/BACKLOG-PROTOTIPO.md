# BACKLOG — Implementação do protótipo (design_handoff em `docs/design/`)

> Loop: desenvolver → testar → (falhou? corrigir → retestar) → registrar aqui e no REGISTRO → próxima.
> Status: ⬜ pendente · 🔨 em curso · ✅ feito+testado

## Bloco A — Backend crítico (auditoria + exigências do protótipo)

| # | Feature | Teste de aceite | Status |
|---|---|---|---|
| A1 | OTP enviado de verdade via fila de notificações (template `otp_code`) | pedir OTP → notification SENT com o código no adapter | ✅ 2026-07-24 |
| A2 | Corrigir estorno parcial (hoje aplicado como total) | estorno parcial → ledger debita só o valor, ingressos intactos, order PARTIALLY_REFUNDED; total → fluxo atual | ✅ 2026-07-24 |
| A3 | Auth por senha do produtor (protótipo: login/cadastro/recuperar) | register→login→recover por curl; senha errada 401; rate limit | ✅ 2026-07-24 |
| A4 | Cupons (tabela+API: criar, validar no checkout) — tela Ingressos do painel | criar cupom, aplicar no checkout, desconto no total | ✅ 2026-07-24 |
| A5 | Cortesias (emitir ingresso grátis) | emitir → ticket ISSUED sem pagamento, aparece em participantes | ✅ 2026-07-24 |
| A6 | Meia-entrada na reserva (flag por item, preço/2, taxa cheia) | reservar com meia → total correto | ✅ 2026-07-24 |

## Bloco B — App do Comprador (rebuild `apps/checkout`, mobile-first 390px, tokens do handoff)

| # | Tela | Status |
|---|---|---|
| B1 | Base: tokens (cores/tipografia Plus Jakarta Sans/raios/sombras), layout mobile, nav | ✅ 2026-07-24 |
| B2 | Início (busca, chips, destaque, próximos eventos) | ✅ 2026-07-24 |
| B3 | Página do evento (hero, badges, CTA sticky, estado encerrado) | ✅ 2026-07-24 |
| B4 | Seleção (lotes, stepper, meia-entrada, esgotado, resumo sticky) | ✅ 2026-07-24 |
| B5 | Identificação (convidado × OTP 4-6 dígitos, termos) | ✅ 2026-07-24 |
| B6 | Dados do comprador (progresso 3 etapas, participante/CPF) | ✅ 2026-07-24 |
| B7 | Pagamento (timer 10:00, abas Pix/Cartão/Carteira, QR, copiar, recusado, expirado) | ✅ 2026-07-24 |
| B8 | Confirmação (aprovado/pendente) | ✅ 2026-07-24 |
| B9 | Carteira (cartão-ingresso com recorte, QR, transferir, vazio) | ✅ 2026-07-24 |
| B10 | Perfil/Minhas compras/Privacidade&Termos (LGPD: baixar dados, excluir conta, reembolso CDC) | ✅ 2026-07-24 |

## Bloco C — Painel do Produtor (restyle `apps/producer` 1360px sidebar dark)

| # | Tela | Status |
|---|---|---|
| C1 | Auth split-screen (login senha, cadastro, recuperar) | ✅ 2026-07-24 |
| C2 | Onboarding organizador (PF/PJ + dados bancários, banner "vendas não bloqueiam") | ✅ 2026-07-24 |
| C3 | Meus eventos (tabela, vazio) | ⬜ |
| C4 | Criar evento — wizard 3 etapas (dados/ingressos/publicar, modal de ingresso) | ⬜ |
| C5 | Dashboard (KPIs, gráfico, check-in ao vivo, equipe) | ⬜ |
| C6 | Ingressos (lotes/cortesias/cupons) | ✅ 2026-07-24 (na página do evento) |
| C7 | Vendas (pedidos + detalhe + reembolso modal; PDV) | ⬜ |
| C8 | Financeiro (saldo, repasses, dados bancários) | ⬜ |
| C9 | Participantes / Check-in ao vivo / Divulgue / Ajuda | ⬜ |

## Bloco D — App de Validação (restyle `apps/mobile-checkin`, dark)

| # | Tela | Status |
|---|---|---|
| D1 | Login PIN (dots, teclado 3×4, shake) | ⬜ |
| D2 | Evento & portão + priming de câmera | ⬜ |
| D3 | Scanner (mira, scanline, chip conexão, lanterna) | ⬜ |
| D4 | Resultados full-screen (válido/inválido/já usado) | ⬜ |
| D5 | Busca manual / Offline+fila / Resumo com reverter / Privacidade | ⬜ |

> Ordem de execução: A1→A3 (destravam login/entrega) → B inteiro (jornada de compra é o coração) →
> A4–A6 junto com C6/B4 (precisam um do outro) → C → D. Compliance do README (Apple/LGPD/CDC) é
> requisito de aceite das telas correspondentes, não item separado.
