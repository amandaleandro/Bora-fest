# Handoff: BoraFest — Plataforma de Ticketeria (3 superfícies)

## Overview
Protótipos navegáveis de alta fidelidade da BoraFest, ticketeria brasileira com diferencial de checkout sem fricção (sem app obrigatório, sem senha, Pix na própria tela). Três superfícies:

1. **App do Comprador** (`BoraFest - App Comprador.html`) — PWA mobile-first (390×844) onde o consumidor descobre eventos, compra e guarda ingressos.
2. **Painel do Produtor** (`BoraFest - Painel Produtor.html`) — web desktop (1360px, sidebar fixa) onde o organizador cria eventos, acompanha vendas e financeiro.
3. **App de Validação** (`BoraFest - App Validacao.html`) — app mobile de portaria para check-in por QR, com modo offline.

Evento de exemplo em todo o fluxo: **CIA 2026 · Copa Inter Atléticas** (14 mar 2026, Arena Anhembi, São Paulo).

## About the Design Files
Os arquivos deste pacote são **referências de design criadas em HTML** — protótipos que mostram aparência e comportamento pretendidos, NÃO código de produção para copiar. A tarefa é **recriar estas telas no ambiente do codebase alvo** (React/Next, React Native, Flutter, SwiftUI etc.) usando os padrões e bibliotecas do projeto — ou, se ainda não existe codebase, escolher a stack mais adequada (sugestão: web/PWA para o comprador, web para o painel, app nativo/React Native para validação por causa da câmera e offline).

Cada `.html` é autocontido: abra no navegador e navegue clicando. O menu lateral esquerdo (fora da moldura do celular) é **apenas navegação do protótipo** — não faz parte do produto. Botões de alternância de estado ("ver estado vazio", "ver evento encerrado" etc.) também são artefatos de protótipo para inspecionar variações.

## Fidelity
**High-fidelity (hifi).** Cores, tipografia, espaçamentos, raios e copy são finais. Recriar pixel-perfect com os componentes do codebase. Entregue apenas em **light mode** — dark mode ainda não foi produzido.

## Design Tokens

### Cores
| Token | Hex | Uso |
|---|---|---|
| primary | `#6d28d9` | botões primários, links, seleção, marca |
| primary-hover | `#5b21b6` | hover de links/botões |
| primary-gradient | `linear-gradient(135deg,#6d28d9,#9333ea)` | thumbs, heros, cards de marca |
| ink | `#16121f` | texto principal, botões dark |
| ink-soft | `#544e60` | texto secundário forte |
| muted | `#6b6577` | texto secundário |
| muted-2 | `#8b8598` | labels, metadados |
| muted-3 | `#a49eb0` / `#c5bed6` | placeholders, ícones desabilitados |
| bg | `#f6f5fb` | fundo de app/telas |
| bg-dark | `#0b0910` | telas escuras (login validação, scanner) |
| sidebar-dark | `#17131f` | sidebar do painel |
| surface | `#fff` | cards |
| border | `#ece9f2` | bordas de card |
| border-input | `#e0dbec` (1.5px) | bordas de input |
| divider | `#f4f2f8` | linhas de tabela/lista |
| success | `#12a150` | aprovado, válido, publicar |
| warning | `#b45309` fundo `rgba(217,119,6,.1)` | pendente, timer, já utilizado |
| danger | `#e11d48` / `#dc2626` | recusado, inválido, excluir |
| pix | `#17b0a0` (texto `#0f766e`) | tudo relacionado a Pix |
| accent-pink | `#ec4899` | urgência ("últimos ingressos"), gradientes |

### Tipografia
- Família única: **Plus Jakarta Sans** (Google Fonts), pesos 400/500/600/700/800.
- Títulos de tela mobile: 800 22–27px; títulos de seção: 800 15–17px; corpo: 500 13–14px/1.5–1.6; labels de input: 700 11–12px; chips/badges: 700 10–12px.
- Painel: título de página 800 18–26px; tabelas: header 700 11px uppercase letter-spacing .04em, células 600 13px.

### Forma e profundidade
- Raios: inputs/botões 12–16px; cards 16–20px; cards grandes/modais 18–26px; chips/pills 999px.
- Sombra de botão primário: `0 12px 24px -8px rgba(109,40,217,.5)` (verde: mesma com rgba(18,161,80,.5)).
- Sombra de card destacado: `0 18px 40px -18px rgba(30,20,60,.25)`.
- Inputs: altura 44–52px (mobile) / 44–50px (painel), borda 1.5px `#e0dbec`, foco na cor primária.
- Alvos de toque mobile: mínimo 44px.

### Espaçamento
Escala prática usada: 4 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 24 / 28 / 32. Padding lateral do mobile: 20–24px. Gaps de lista: 10–14px.

---

## Superfície 1 — App do Comprador (10 telas)

Fluxo principal: **Início → Evento → Seleção → Identificação → Dados → Pagamento → Confirmação → Carteira**. Satélites: **Perfil**, **Minhas compras**, **Privacidade & Termos**, **Sem conexão**.

### 1. Início (home)
- Saudação "Olá, Marina" + localização (pin roxo "São Paulo, SP"); avatar 44px (gradiente rosa→roxo) abre o Perfil.
- Busca (50px, placeholder "Buscar shows, festas, esportes..."), chips de categoria (Todos ativo = fundo `#16121f` branco; demais outline).
- Card destaque "Em alta" 190px: gradiente primário + radial rosa, badge "Últimos ingressos" com dot verde pulsante, preço em pill branca "a partir de R$ 60" → navega ao Evento.
- Lista "Próximos eventos": linhas com bloco de data (56px, gradiente, dia/mês), nome, local, preço à direita em roxo.

### 2. Página do evento
- Hero 430px com imagem (banner do evento), gradiente escuro nas bordas, voltar/favoritar/compartilhar em botões glass (40px, blur), badge urgência, título 27px branco sobre a foto.
- Corpo em card arredondado sobreposto (-22px): chips de categoria, data/hora e local com ícones em tiles 46px, mini-mapa (com pin) + "Ver rotas", "Sobre o evento", line-up em carrossel horizontal (avatares 78px).
- **CTA sticky no rodapé**: "Comprar ingressos · a partir de R$ 60" (56px, roxo) → Seleção.
- **Estado encerrado**: badge vira "Vendas encerradas" (dark glass), CTA vira barra cinza desabilitada + botão outline "Ver outros eventos" → Início.

### 3. Seleção de ingressos
- Header sticky com blur; cards de lote: nome 800 16px, badge "Poucos" (rosa) quando aplicável, preço 800 20px, "+ R$ X taxa de serviço" sempre visível (transparência de taxa é requisito de negócio).
- Stepper −/+ (38px; − outline, + roxo sólido); card selecionado ganha borda roxa 1.5px.
- Checkbox "Meia-entrada (estudante / documento na portaria)" por lote — ao marcar, preço cai pela metade (taxa não muda).
- Lote esgotado: card `#faf9fc` opacity .75, badge "Esgotado", bloco "Indisponível" no lugar do stepper.
- **Resumo sticky no rodapé** (blur): contagem, "inclui taxas", total 800 22px, botão "Continuar" (desabilitado cinza `#d9d2e8` quando carrinho vazio).
- Regra de cálculo: `total = Σ qty × (preçoUnit(meia? preço/2 : preço) + taxa)`.

### 4. Identificação (sem senha)
- Título "Quase lá! Como quer continuar?"; sub: "Sem senha, sem baixar app. Você recebe os ingressos por e-mail e WhatsApp."
- Segmented control: **Como convidado** (e-mail + celular/WhatsApp) | **Entrar com código** (OTP 4 dígitos, caixas 60px, contador "Reenviar código em 0:24", link "Não recebi o código", fallback "Perdeu acesso ao número? Continuar como convidado").
- Botão Continuar; microcopy legal: "Ao continuar, você concorda com os **Termos de Uso** e a **Política de Privacidade**" (links → tela legal).
- Social: Google e **Apple** (obrigatório manter ambos — Guideline 4.8 da Apple).

### 5. Dados do comprador
- Barra de progresso 3 etapas (Identificação ✓, Dados ativo, Pagamento cinza).
- Form: Nome, E-mail, Celular. Card "Participante · Camarote Open Bar" com Nome no ingresso + CPF **somente se o evento exigir** (nota explicativa).

### 6. Pagamento
- Header: timer de reserva em chip âmbar (contagem regressiva real de 10:00; ao zerar → tela "Tempo de reserva esgotado" com botão "Escolher ingressos novamente" que restaura a seleção).
- Abas (pills, ativa = `#16121f`): **Pix** (default) | Cartão | Carteira.
- **Pix**: chip de status ("Aguardando pagamento" âmbar com spinner → "Pagamento aprovado" verde), QR 200px, botão "Copiar código Pix" (outline teal, vira "Código copiado!"), total, botão teal "Já fiz o pagamento" → simula polling 2.4s → overlay verde de aprovado → botão verde "Ver confirmação do pedido". **Nunca redirecionar para fora.**
- **Cartão**: número/validade/CVV/parcelamento (3x sem juros); estado **recusado**: banner vermelho "Pagamento recusado" mantendo a reserva.
- **Carteira**: Apple Pay (preto), Google Pay (branco), Mercado Pago (azul `#009ee3`).
- Campo cupom (borda tracejada) + botão Aplicar.

### 7. Confirmação
- **Aprovado**: fundo degradê verde-claro, check verde 92px animado (pop), "Pagamento aprovado!", resumo do pedido #BF-2026-48213 com itens/taxa/total, chip "Pagamento confirmado", CTA "Ver meus ingressos".
- **Pendente (aguardando Pix)**: relógio âmbar, "Aguardando pagamento", chip "Aguardando Pix" — mesma estrutura.

### 8. Carteira (Meus ingressos)
- Cartão de ingresso: topo gradiente com nome/data/local, recorte de ticket (círculos nas laterais + linha tracejada), QR 184px, nome do portador, chip do tipo; ações: "Adicionar à Apple Wallet" (preto), WhatsApp, Transferir.
- Segundo pedido colapsado ("2 ingressos · toque para ver os QR codes").
- **Vazio**: ilustração ticket cinza, "Você ainda não tem ingressos", CTA "Explorar eventos" → Início.

### 9. Perfil / Minha conta
- Card do usuário (avatar, nome, e-mail, telefone, Editar).
- Conta: Meus ingressos, **Minhas compras**, toggles "Avisos por WhatsApp" (on) e "Ofertas por e-mail" (off, opt-in).
- Privacidade e dados (LGPD): Política de Privacidade, Termos de Uso, **Baixar meus dados**.
- Sair da conta; **Excluir minha conta** (vermelho) → bottom sheet de confirmação: "remoção em até 30 dias (LGPD), ingressos futuros cancelados sem reembolso" + botão destrutivo. *(Exigência Apple 5.1.1(v).)*
- Rodapé "BoraFest v1.0.0".

### 10. Minhas compras + telas satélites
- **Minhas compras**: pedido atual (status, itens, total, "Reenviar ingressos", "Solicitar reembolso" → banner verde CDC art. 49, 5 dias úteis) + pedido antigo ("Evento encerrado", opacity .8).
- **Privacidade & Termos**: abas segmented; 6 seções em cards por aba (coleta, uso, compartilhamento, direitos LGPD Lei 13.709/2018, exclusão em 30 dias, segurança / serviço, taxas, reembolso CDC, meia-entrada Lei 12.933/2013, transferência, fraude). Rodapé: DPO privacidade@borafest.com.
- **Sem conexão**: wifi-off, "Tentar novamente", "Ver ingressos salvos" (carteira funciona offline).

---

## Superfície 2 — Painel do Produtor (15 telas/estados)

Desktop 1360×848, sidebar fixa 244px `#17131f`. Fluxo de primeiro uso: **Login → Cadastro → Onboarding → Meus eventos (vazio) → Criar evento (3 etapas) → Dashboard**.

### Auth (Login / Cadastro / Recuperar senha)
- Split screen: painel esquerdo dark (gradiente `#17131f→#2b1157`) com logo, headline "A ticketeria que não trava as suas vendas." e 3 bullets verdes (venda liberada sem verificação, tempo real, Pix embutido); rodapé com links Termos/Privacidade (LGPD).
- Forms à direita (370px): Login (e-mail/senha, "Esqueci minha senha", Google, "Criar conta de produtor"); Cadastro (nome/e-mail/senha com regra mín. 8, aceite LGPD, → Onboarding); Recuperar (e-mail → banner verde "link enviado, validade 30 min").

### Onboarding do organizador
- Banner verde-destaque: **"Suas vendas NÃO ficam bloqueadas"** — verificação roda em segundo plano (diferencial vs. concorrência 24h) + chip âmbar "Verificação pendente" pulsando.
- Dois cards lado a lado: **Dados do organizador** (toggle PF/PJ que troca labels Nome/CPF ↔ Razão social/CNPJ; Realização, nascimento, e-mail, telefone, CEP com botão Buscar, endereço) e **Dados de pagamento** (banco select, favorecido, agência, conta, dígito, documento).
- "Salvar dados" → Meus eventos (vazio).

### Meus eventos
- Busca + filtro "Próximos eventos" + botão "Criar novo evento".
- Tabela: Evento (thumb gradiente + nome + local) | Início | Status (chips: Publicado verde, Rascunho cinza, Encerrado) | Cidade | Vendidos ("694 de 1000" + barra) | ações (⋮). Linha clicável → Dashboard.
- **Vazio**: "Crie seu primeiro evento — publique em minutos... sem espera de aprovação."

### Criar evento — wizard 3 etapas (stepper: Dados → Ingressos → Publicar)
- **Etapa 1**: Dados do evento (nome, subtítulo, classificação 18 anos, início/término, upload de banner 300px), Local (CEP + Buscar → autopreenche rua/bairro/cidade/UF) ao lado de Mapa, Descrição (editor rico: B/I/U, listas, link), Definições (Público/Privado cards, Categoria) + Aparência do hotsite (4 temas, check no ativo), aceite dos termos, Voltar/Continuar.
- **Etapa 2**: tabela de ingressos (Tipo, Status, Quantidade, Preço, Taxa, Ações) + "Novo ingresso" abre **modal "Cadastrando novo ingresso"** (560px: tipo, toggle Disponível, quantidade, preço, taxa calculada, **Preço final auto em verde**, "Início por data"/"Início por lote", janela de venda, Opções avançadas). Card "Quem paga pela taxa de serviço?" (Comprador = preço+taxa | Organizador = desconto no repasse). Voltar/Continuar.
- **Etapa 3 (Publicar)**: Revisão (dados + ingressos), card Publicação (URL borafest.com/cia2026 editável, toggle "Publicar agora"), aviso verde "venda começa imediatamente...", botões Voltar / Salvar rascunho / **Publicar evento** (verde) → Dashboard sem vendas.

### Dashboard (Geral)
- 4 KPIs com ícones coloridos: Valor a receber, Acessos na página, Total vendido, Vendas aprovadas (+delta verde).
- **Gráfico de vendas** (área roxa, 30/7 dias) + **Check-in ao vivo** (dot verde pulsante, 398/694, barras por portão).
- Detalhes do evento (data, local, URL copiável, **toggle publicar/despublicar**) + Equipe & logins (avatares, papel, chip de acesso, + Adicionar).
- **Estado sem vendas**: KPIs zerados, gráfico vira empty state "Nenhuma venda ainda — compartilhe o link do hotsite".

### Ingressos
- Abas Tipos & lotes / Cortesias / Cupons; tabela com **virada de lote** ("80% vendido", "após 1º lote", data); cards Cortesias (42/60, "Emitir cortesia") e Cupons (ATLETICA10, LEVE3, "Criar cupom"). Mesmo modal da Etapa 2.

### Vendas
- Abas **Pedidos** | **PDV / Portaria**.
- Pedidos: tabela (Pedido, Comprador, Valor, Método, Status Aprovado/Pendente/Recusado) + coluna direita: card dark "Conta de recebimento" (R$ 48.720, Solicitar saque) e **detalhe do pedido** (itens, total, "Reenviar ingresso", "Reembolsar" → **modal de confirmação destrutiva**: valor, prazo 5 dias úteis, irreversível, Cancelar/Confirmar vermelho).
- PDV: lista de lotes com stepper, resumo, forma de pagamento (Pix/Cartão/Dinheiro), "Cobrar e emitir" verde.

### Financeiro
- Card dark Saldo disponível (R$ 48.720 + conta + Solicitar saque), Próximo repasse (D+2 pós-evento), Total repassado.
- Tabela de repasses (Data, Valor, Conta, Status Pago/Agendado, "Baixar PDF") + card Dados bancários com "Alterar conta" → Onboarding.

### Participantes
- Busca por nome/CPF, filtro por lote, **Exportar CSV**; tabela: Participante (avatar), E-mail, Ingresso, Pedido, Check-in (chip Confirmado/Não usado).

### Check-in
- 3 KPIs (Presentes agora, Válidos, Recusados vermelho); **painel ao vivo por portão** (validadores, contagem, taxa +N/min, barra); cards Portões (PIN próprio por portão, "Configurar portões") e Equipe de validação (status online = dot verde, "Gerar novo PIN de acesso").

### Divulgue + Ajuda
- Divulgue: QR do hotsite, link copiável, botões WhatsApp/Facebook/Instagram, campos Meta Pixel ID e GA Measurement ID.
- Ajuda: FAQs + card gradiente "Falar com especialista no WhatsApp". Sidebar tem "Sair" → Login.

---

## Superfície 3 — App de Validação (9 telas)

Fluxo: **Login PIN → Evento & portão → Permissão de câmera → Scanner → Resultado → (Busca manual | Offline | Resumo)**. Telas de scanner/login em fundo `#0b0910` (uso noturno).

### 1. Login da equipe
- Fundo dark, logo, "Digite o PIN de acesso fornecido pelo produtor", 6 dots de PIN (preenchido = roxo), teclado numérico 3×4 (teclas 64px, `rgba(255,255,255,.08)`), botão Entrar (ativo ≥4 dígitos).
- **PIN inválido**: dots tremem (shake .45s) + mensagem vermelha "PIN inválido. Confira o código com o produtor." (limpa ao digitar).
- Link "política de privacidade" no rodapé.

### 2. Selecionar evento & portão
- Lista de eventos ativos (selecionado = borda roxa + check); radio de portões (A/B/VIP com descrição); "Iniciar validação"; botão "Sair" no topo.

### 3. Permissão de câmera (priming)
- Dark: ícone câmera, "Permitir acesso à câmera", "Usamos a câmera apenas para ler o QR code... nada é gravado ou enviado", **Permitir acesso** / **Agora não — usar busca manual**. Só aparece na primeira vez.

### 4. Scanner
- Câmera full-screen (simulada), mira com cantos roxos `#a78bfa` + linha de varredura animada (2.6s), chip de conexão no topo (Online verde pulsante / Offline âmbar), lanterna, card inferior glass: contador de entradas + "Busca manual". Tocar na mira simula leitura → Resultado válido.

### 5. Resultado (full-screen, alto contraste)
- **Válido**: fundo verde `#12a150→#0f8a45`, círculo branco 108px com check (pop), "Válido" 800 34px, card glass com Portador/Ingresso/Pedido, botão branco "Próximo" (58px) → scanner.
- **Inválido**: fundo vermelho, X (shake), motivo "QR não reconhecido", ação sugerida busca manual.
- **Já utilizado**: fundo âmbar `#f59e0b→#d97706`, relógio, mostra **hora e portão do 1º uso**.

### 6. Busca manual
- Campo com cursor piscando ("Marina"), contagem de resultados; linhas: avatar, nome, tipo+pedido, botão "Check-in" verde (ou "Já usado" cinza/âmbar) → Resultado.
- **Sem resultados**: lupa cinza, "Nenhum resultado" + dica.

### 7. Modo offline
- Banner âmbar "Sem conexão — validação usa a lista salva no aparelho"; card **Fila de sincronização** ("4 pendentes", linhas com hora/portão); botão "Sincronizar agora" (spinner durante sync).

### 8. Resumo de portaria
- Card gradiente: total presentes 398/694 + barra; contagem por portão; "Últimas entradas" com botão **Reverter** (vermelho suave) por linha.

### 9. Privacidade da operação
- 4 cards: acesso por PIN (dados do validador), dados dos participantes (BoraFest = operadora LGPD em nome do produtor), modo offline (lista criptografada, apagada pós-evento), contato DPO.

---

## Interactions & Behavior (regras transversais)
- Navegação por clique real em CTAs; voltar (chevron) segue a ordem do fluxo.
- Timer de reserva: 10:00 regressivo; expira → tela de expiração → recomeça na Seleção.
- Pix: aguardando (spinner âmbar) → aprovado (verde) por polling; botão copia payload para o clipboard.
- Toggles de estado do protótipo (vazio/cheio, aprovado/pendente, com/sem vendas, encerrado) mostram as variações exigidas — em produção são estados de dado.
- Animações usadas: `pop` (scale .5→1, .4–.5s) para sucesso; `shake` (.45–.5s) para erro; `pulseDot`/`livedot` (1.4s) para "ao vivo"; `scanline` (2.6s) no scanner; spinners border-top.
- Acessibilidade: contraste AA, alvos ≥44px, textos mínimos 11px (protótipo) — em produção seguir Dynamic Type/sp.

## State Management (mínimo por superfície)
- **Comprador**: carrinho {loteId: qty, meia}, etapaCheckout, método/statusPagamento, timerReserva, pedido(s), sessão (guest|otp), consentimentos (marketing opt-in), conexão.
- **Painel**: sessão, organizador (PF/PJ, verificação pendente|ok), eventos[], wizardDraft, ingressos[], pedidos[], repasses[], equipe[], estado de publicação.
- **Validação**: sessão por PIN, evento/portão ativos, permissão de câmera, fila offline de check-ins pendentes, contadores ao vivo, resultado da última leitura.

## Compliance (já refletido no design — manter na implementação)
- Exclusão de conta in-app + confirmação (Apple 5.1.1(v)); Sign in with Apple ao lado do Google (4.8); priming de câmera; política de privacidade acessível e consentimento no aceite; pagamento externo permitido por serem bens/serviços físicos (3.1.5 — sem IAP); LGPD: direitos do titular, DPO, retenção 30 dias; CDC art. 49 para reembolso; Lei 12.933/2013 para meia-entrada.
- Pendências de submissão (fora do design): App Privacy labels, prompt ATT se houver tracking, URLs públicas de política/suporte, conta demo para review.

## Assets
- Fonte: Plus Jakarta Sans (Google Fonts).
- Ícones: SVG inline stroke 1.8–2.2 (estilo outline arredondado) — mapear para a lib do codebase (ex.: Lucide/Phosphor).
- Banner do evento: placeholder drag-and-drop no protótipo — usar imagem real do evento em produção.
- QR codes: gerados proceduralmente no protótipo — usar lib real (ex.: qrcode) em produção.

## Files
- `BoraFest - App Comprador.html` — protótipo standalone do app do comprador
- `BoraFest - Painel Produtor.html` — protótipo standalone do painel
- `BoraFest - App Validacao.html` — protótipo standalone da validação
Abra qualquer um no navegador; use o menu lateral esquerdo (artefato de protótipo) para pular entre telas.

## Como usar com Claude Code
1. Descompacte esta pasta dentro do seu repositório (ex.: `design_handoff_borafest/`).
2. No terminal do projeto, rode `claude` e peça: *"Implemente o App do Comprador seguindo design_handoff_borafest/README.md, recriando as telas do HTML de referência na stack do projeto."*
3. Itere superfície por superfície (comprador → painel → validação).
