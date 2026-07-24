# BoraFest — Handoff v1 (Design → Código)

## Intenção do produto (leia primeiro)
Esta é a **v1 de lançamento** da BoraFest, ticketeria brasileira. Diferencial competitivo: **a compra mais simples do mercado** — sem senha, sem app obrigatório, Pix com QR e status em tempo real na própria tela (nunca redirecionar). Concorrência de referência (estrutura, não visual): Ingresso.live, Cheers, Sympla.

**Estratégia de plataforma da v1:**
- **PWA primeiro.** O App do Comprador e o App de Validação serão lançados como **PWA mobile-first** (instaláveis, offline-capable via service worker). React Native fica para a v2 — as telas aqui já foram desenhadas em proporção nativa (390×844) para essa migração ser 1:1.
- **Conta única BoraFest**: o mesmo login (e-mail/OTP/social, sem senha) vale no Site Público, no PWA do comprador e futuramente no app nativo. Um usuário pode ativar o papel de **produtor** na mesma conta.
- **4 superfícies, 1 design system** (tokens abaixo).

## As 4 superfícies e seus arquivos
| Superfície | Arquivo | Plataforma v1 |
|---|---|---|
| Site Público (descoberta + venda online desktop) | `BoraFest - Site Publico.html` | Web responsivo |
| App do Comprador | `BoraFest - App Comprador.html` | PWA mobile (390×844) |
| Painel do Produtor | `BoraFest - Painel Produtor.html` | Web desktop (sidebar fixa) |
| App de Validação (portaria) | `BoraFest - App Validacao.html` | PWA mobile, offline-first |

Cada `.html` é um protótipo standalone e **100% navegável por clique** — abra no navegador. O menu lateral esquerdo fora da "moldura" é artefato de protótipo (atalho para telas), NÃO faz parte do produto. Botões "ver estado X" são alternadores de estado para inspeção.

**Os HTML são referência de design, não código de produção.** Recrie as telas na stack escolhida (sugestão v1: Next.js/React para site+painel, PWA React para comprador+validação), lendo os valores exatos (cores, raios, espaçamentos) do HTML quando precisar.

---

## FLUXOS (mapa de navegação clicável)

### 1) Site Público — `borafest.com`
```
HOME (hero CIA + categorias + grid de eventos + faixa "Produza seu evento")
 ├─ clique em evento ────────────► HOTSITE DO EVENTO (/cia2026)
 │                                  ├─ seleção de ingressos (lateral sticky:
 │                                  │   steppers, meia-entrada, taxa visível, esgotado)
 │                                  └─ "Continuar para pagamento" ─► CHECKOUT
 │                                       ├─ Passo 1 Identificação (sem senha:
 │                                       │   e-mail+celular | Google | Apple)
 │                                       │   → desbloqueia Passo 2
 │                                       ├─ Passo 2 Pagamento: PIX (QR + copiar +
 │                                       │   aguardando→aprovado em tempo real)
 │                                       │   ou CARTÃO (parcelado) · cupom BORA10
 │                                       │   · timer de reserva 10:00
 │                                       └─ aprovado ─► CONFIRMAÇÃO (/pedido/BF-51930)
 │                                            ├─ "Ver meus ingressos" ─► MINHA CONTA
 │                                            └─ "Baixar app" ─► PWA Comprador
 ├─ "Entrar" (header) ─► modal login por código ─► MINHA CONTA
 │    MINHA CONTA: ingressos c/ QR, Wallet, WhatsApp, Transferir,
 │    menu (compras, dados, LGPD, sair) + card "Também organiza eventos?"
 ├─ "Produza seu evento" (header/faixa/conta/footer) ─► PAINEL #cadastro
 ├─ footer "Painel do organizador" ─► PAINEL #login
 ├─ footer "Taxas e repasses" ─► PAINEL #financeiro
 └─ footer/checkout Termos·Privacidade ─► telas legais (LGPD)
```

### 2) App do Comprador (PWA)
```
INÍCIO (busca + categorias + destaque + próximos eventos)
 ├─ avatar ─► PERFIL ──► Meus ingressos / MINHAS COMPRAS (reembolso CDC art.49)
 │            │          / Privacidade & Termos / Baixar meus dados (LGPD)
 │            └─ EXCLUIR CONTA (bottom-sheet de confirmação — Apple 5.1.1)
 ├─ evento ─► PÁGINA DO EVENTO (hero, mapa, line-up; estado "vendas encerradas")
 │             └─ "Comprar ingressos" ─► SELEÇÃO (steppers, meia, esgotado,
 │                resumo sticky) ─► IDENTIFICAÇÃO (convidado | OTP 4 dígitos
 │                | Google/Apple; consentimento LGPD) ─► DADOS (nome/CPF por
 │                ingresso só se o evento exigir) ─► PAGAMENTO
 │                  ├─ Pix: QR + copiar + status ao vivo (aguardando→aprovado)
 │                  ├─ Cartão (estado recusado) · Carteira digital
 │                  ├─ timer 10:00 ─ expira ─► TEMPO ESGOTADO ─► volta à Seleção
 │                  └─ aprovado ─► CONFIRMAÇÃO (aprovado ⇄ pendente-Pix)
 │                       └─ "Ver meus ingressos" ─► CARTEIRA
 ├─ CARTEIRA: cartão c/ QR grande, Wallet/WhatsApp/Transferir; estado VAZIO
 └─ SEM CONEXÃO: fallback offline ("ingressos salvos" continuam abrindo)
Hash-routes p/ links externos: #legal #terms #wallet
```

### 3) Painel do Produtor (web desktop)
```
LOGIN ─ "Entrar" ─► MEUS EVENTOS (lista)
 ├─ "Criar conta de produtor" ─► CADASTRO (aceite LGPD) ─► ONBOARDING
 │    (dados PF/PJ + dados bancários; banner "venda NÃO bloqueia
 │     aguardando verificação" — diferencial) ─► MEUS EVENTOS (vazio)
 ├─ "Esqueci minha senha" ─► RECUPERAR (link por e-mail, 30min)
 └─ MEUS EVENTOS ─ "Criar novo evento" ─► WIZARD
      Etapa 1 Dados+Local+Descrição+Aparência ─► Etapa 2 Ingressos
      (modal "Novo ingresso": preço+taxa=preço final; quem paga a taxa)
      ─► Etapa 3 Revisão & Publicar (URL hotsite, rascunho | PUBLICAR)
      ─► DASHBOARD (KPIs, gráfico de vendas, check-in ao vivo, equipe;
                    estado sem vendas)
Sidebar: Geral · Ingressos (lotes/cortesias/cupons) · Divulgue (QR, pixel)
 · Vendas (pedidos, detalhe c/ REEMBOLSO em modal destrutivo, PDV portaria)
 · Financeiro (saldo, saques, repasses D+2, comprovantes, conta bancária)
 · Participantes (busca, filtros, CSV) · Check-in (portões, PINs, ao vivo)
 · Ajuda · Sair ─► LOGIN
Hash-routes: #signup #login #finance
```

### 4) App de Validação (PWA portaria, offline-first)
```
LOGIN POR PIN (teclado numérico; erro PIN inválido c/ shake)
 └─► SELECIONAR EVENTO & PORTÃO ─ "Iniciar validação"
      └─► PERMISSÃO DE CÂMERA (priming; "Agora não" ─► Busca manual)
           └─► SCANNER (mira animada, chip online/offline, contador,
                lanterna; toque simula leitura)
                ├─► RESULTADO full-screen: ✅ VÁLIDO (verde) |
                │    ⛔ INVÁLIDO (vermelho, motivo) |
                │    ⚠️ JÁ UTILIZADO (âmbar, hora+portão do 1º uso)
                │    └─ "Próximo" ─► volta ao Scanner
                ├─► BUSCA MANUAL (nome/CPF; sem resultados; check-in direto)
                ├─► MODO OFFLINE (fila de sync pendente + Sincronizar)
                └─► RESUMO DE PORTARIA (presentes, por portão, REVERTER check-in)
Privacidade da operação (LGPD operador) acessível no login · Sair
```

---

## Design tokens (usar como theme)
- **Primária** `#6d28d9` (hover `#5b21b6`; gradiente `#6d28d9→#9333ea`) · **Pix** `#17b0a0` · **Sucesso** `#12a150` · **Alerta** `#b45309` · **Erro** `#e11d48`/`#dc2626` · **Urgência** `#ec4899`
- **Texto**: `#16121f` (principal), `#544e60`, `#6b6577`, `#8b8598` (meta), `#a49eb0` (placeholder)
- **Fundos**: app `#f6f5fb` · dark `#0b0910` · sidebar `#17131f` · cards `#fff` · bordas `#ece9f2` (cards) e `#e0dbec` 1.5px (inputs)
- **Fonte**: Plus Jakarta Sans 400–800 (única família)
- **Raios**: inputs/botões 12–16 · cards 16–22 · modais 20–26 · pills 999
- **Sombra CTA**: `0 12px 24px -8px rgba(109,40,217,.5)` · Hit target mobile ≥44px · Contraste WCAG AA
- Animações: `pop` (sucesso), `shake` (erro), `pulseDot` (ao vivo), spinner border-top

## Regras de negócio embutidas no design
1. Taxa de serviço **sempre visível** ao lado do preço; total = Σ qty × (preço[meia?/2] + taxa).
2. Pix é o método default; confirmação por polling na própria tela.
3. Reserva de 10:00 no checkout; expirou → estoque devolvido → refazer seleção.
4. Meia-entrada (Lei 12.933/2013): 50% do preço, taxa integral, validação na portaria.
5. Reembolso: CDC art. 49 (7 dias, até 48h antes do evento).
6. Venda do produtor **não bloqueia** aguardando verificação (verificação em 2º plano).
7. Check-in offline: fila local criptografada, sync quando conexão voltar, reversão possível.

## Compliance já refletido nas telas
Exclusão de conta in-app + LGPD (30 dias) · Sign in with Apple junto ao Google · priming de câmera · consentimento Termos/Privacidade no checkout · DPO privacidade@borafest.com. Pendências de submissão (fora do design): App Privacy labels, ATT se houver pixel/tracking, URLs públicas de política, conta demo de review.

## Fora de escopo desta v1 (design ainda não produzido)
- **Dark mode** (todas as superfícies) — planejado, não desenhado.
- Tela própria de "Transferir ingresso" e integração real Wallet (botões presentes; em produção chamam APIs nativas/PassKit).
- Busca com resultados reais, filtros de categoria funcionais (chips são visuais).

## Como usar com Claude Code
1. Descompacte esta pasta no repositório (ex.: `design_handoff_borafest/`).
2. `claude` no terminal e peça, por superfície:
   - *"Implemente o Site Público como Next.js seguindo design_handoff_borafest/README.md — comece pela Home e Hotsite, recriando pixel-perfect o HTML de referência."*
   - *"Implemente o App do Comprador como PWA (manifest + service worker) seguindo o fluxo do README."*
3. Ordem recomendada: **Site Público → App Comprador (PWA) → Painel → Validação**.
4. Valide cada tela lado a lado com o HTML aberto no navegador.
