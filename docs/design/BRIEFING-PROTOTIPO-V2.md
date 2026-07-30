# Briefing para o protótipo v2 — o que falta desenhar

> Base: `docs/design/README.md` (handoff v1) + auditoria do código real
> (`docs/projeto/AUDITORIA-V1-2026-07-24.md`, 8 agentes / 405 verificações).
>
> **Aqui só entra o que é lacuna de DESIGN** — tela, estado ou regra que ninguém
> desenhou. Bug de implementação (botão travado, link localhost, layout que não
> responde) não está nesta lista: é código, e eu conserto sem tocar no protótipo.
>
> Prioridade: 🔴 sem isso não vende/não opera · 🟡 fura a experiência · ⚪ polimento

---

## 0. A decisão que muda tudo: como as telas se comportam em desktop

O handoff define o Site Público como "web desktop" e as outras superfícies como
mobile, mas **só a Home e o Hotsite foram desenhados em 1440px**. Seis telas
internas existem apenas em 390px: checkout, confirmação, minha conta, minhas
compras, telas legais e seleção de ingressos.

**O que precisa vir no v2** 🔴
- Cada uma dessas 6 telas em 1440px, indicando: largura máxima do conteúdo, o que
  vira coluna lateral e o que centraliza.
- Especificamente o **checkout desktop**: o handoff cita um "Resumo do pedido"
  lateral que nunca foi desenhado. É a tela onde o dinheiro entra — precisa existir.
- Regra geral de breakpoint (o que muda em ~1024px) para eu aplicar sem adivinhar.

---

## 1. Site Público

| Prioridade | Item | Por quê |
|---|---|---|
| 🔴 | **Consentimento LGPD explícito** — checkbox bloqueante antes de pagar, com versão da política | Hoje só há a frase passiva "ao continuar você concorda". É exigência legal e item do MVP. |
| 🟡 | **Modal de login** (o protótipo tem `loginOpen`, mas nunca desenhou o conteúdo) | Hoje "Entrar" leva para uma página. Definir: é modal ou página? |
| 🟡 | **Header logado** — como fica quando já existe sessão (avatar? nome? "Minha conta"?) | Hoje mostra "Entrar" mesmo com o usuário logado. |
| 🟡 | **Card "Também organiza eventos?"** na Minha Conta | É um dos 4 pontos de entrada de "Produza seu evento" do README §1, sem desenho. |
| 🟡 | **CTA "Baixar app"** na confirmação | O README §1 cita, o protótipo não desenhou. |
| ⚪ | Chips de categoria e busca **no desktop** — e se filtram de verdade ou são decorativos | Hoje existem só no mobile e o filtro é inerte. Decidir: funcional ou remover. |
| ⚪ | Checkout: **2 passos (handoff) × 3 passos (implementado)** | O código tem uma etapa "Dados" extra. Qual é a verdade? |

---

## 2. App do Comprador (PWA)

| Prioridade | Item | Por quê |
|---|---|---|
| 🔴 | **Nome/CPF por ingresso** quando o evento exigir — tela e comportamento | O README cita, mas não há desenho de como se coleta N nomes numa compra de N ingressos. Hoje todo ingresso sai como "Portador". |
| 🔴 | **Onde o comprador vê seus ingressos** depois de fechar o link do pedido | Hoje a carteira só existe dentro de `/pedido/[token]`. Falta desenhar "Meus ingressos" como destino próprio (com estado vazio). |
| 🟡 | **Mapa e line-up** na página do evento | O README §2 pede "hero, mapa, line-up" — só o hero foi desenhado. |
| 🟡 | **Timer de reserva na tela de pagamento** | O timer foi desenhado, mas some justamente na etapa do Pix. Confirmar se aparece e onde. |
| 🟡 | **Preferências de notificação** — o que acontece ao ligar/desligar | Hoje os toggles só gravam no navegador. Definir se viram preferência de conta. |
| ⚪ | **Ícones do PWA** (192/512 PNG, maskable, apple-touch) e splash | Sem isso o ícone fica degradado no iOS — a plataforma da estratégia "PWA primeiro". |
| ⚪ | Estados de **atualização do app** ("nova versão disponível") | PWA precisa disso; não há desenho. |

---

## 3. Painel do Produtor

| Prioridade | Item | Por quê |
|---|---|---|
| 🔴 | **"Quem paga a taxa"** — produtor absorve × comprador paga | Regra de negócio citada no §3 do handoff, sem tela e sem definição do efeito no preço. Não existe em nenhuma camada. |
| 🔴 | **Editar evento** (título, data, descrição, local) depois de criado | Só é possível criar e publicar. É item do MVP §17. |
| 🔴 | **Solicitar saque** pelo produtor | Hoje o repasse só sai se um admin nosso criar à mão. |
| 🔴 | **Local do evento** no wizard (CEP → endereço) e **upload real de banner** | O wizard não tem campo de local, e "banner" hoje é colar uma URL. Ambos aparecem no protótipo como se existissem. |
| 🟡 | **Sidebar persistente** com as 9 entradas e estado ativo | Estrutural do §3; hoje a navegação é por links soltos. |
| 🟡 | **Equipe** — listar, convidar por e-mail com papel, remover | Citado no dashboard, sem desenho. A API de convite já existe. |
| 🟡 | **Divulgue** — QR do hotsite e campo de pixel (Meta/GA) | Item explícito do §3, nenhuma tela. ⚠️ pixel implica ATT no iOS. |
| 🟡 | **Repasse D+2 e comprovantes** — onde aparece a data de disponibilidade e como se baixa o comprovante | O handoff cita D+2; não existe regra nem tela. |
| 🟡 | **Gráfico de vendas ao longo do tempo** | O handoff mostra série temporal; o que existe é ocupação por lote. Confirmar qual é. |
| ⚪ | **Modal "Novo ingresso"** — o conteúdo existe, mas inline | Decidir se vira modal mesmo. |
| ⚪ | **Fluxo pós-login**: o handoff vai direto para "Meus eventos"; o código passa por "Suas organizações" | Definir se a tela de organizações existe (multi-produtora) ou some. |

---

## 4. App de Validação (portaria) — **a superfície mais crítica e a menos desenhada**

Esta é a única parte do sistema que roda **sem chance de rollback** no dia do
evento. Hoje, sem rede, o app aprova em verde **qualquer** leitura.

| Prioridade | Item | Por quê |
|---|---|---|
| 🔴 | **Estado "não consigo verificar agora"** — sem rede e sem manifesto | Não existe no desenho. Sem ele, "sem rede" vira "válido" — que é o bug atual. |
| 🔴 | **Ingresso cancelado/estornado** lido na portaria | Que cor, que texto, que ação? Não foi desenhado. |
| 🔴 | **Aparelho bloqueado remotamente / sessão expirada** | O produtor bloqueia o aparelho e o operador precisa ver isso. Hoje cai no mesmo caminho do offline e libera todo mundo. |
| 🔴 | **Motivo no resultado INVÁLIDO** — QR de outro evento? assinatura falsa? não existe? | A portaria precisa saber o que dizer ao portador. |
| 🔴 | **iOS**: o scanner por câmera não funciona em Safari | Decidir: entrar com biblioteca de leitura alternativa, exigir Android, ou desenhar o fluxo assumindo digitação manual. |
| 🟡 | **Busca manual por nome/CPF** (o desenho pede; hoje só por código) | Precisa decidir se nome/CPF ficam no aparelho — tem peso de LGPD. |
| 🟡 | **"Já utilizado" com o PORTÃO do 1º uso** (não só o aparelho) | O desenho pede hora + portão; a informação de portão não é exibida. |
| 🟡 | **Resumo de portaria**: total do evento e quebra por portão | Hoje o contador é só do próprio aparelho e nunca zera entre eventos. |
| 🟡 | **Priming de câmera com saída "Agora não"** e o que acontece se a permissão for negada | Desenhado no fluxo, ausente na prática. |
| 🟡 | **Privacidade da operação (LGPD do operador)** como tela própria | Hoje o operador é mandado para a política do comprador. |
| ⚪ | Lanterna, mira animada (scanline) | Feedback de "está lendo" e uso noturno. |

---

## 5. Decisões de produto que o desenho precisa cravar

Estas não são telas — são regras que mudam várias telas de uma vez:

1. **Conta única** — o README diz que o mesmo login vale para comprador e produtor,
   mas hoje o comprador entra por código e o produtor por senha. Como é a transição
   de "sou comprador" para "também organizo"? Vira o mesmo cadastro?
2. **Prazo de repasse** — o handoff cita D+2, mas não existe regra implementada.
   Qual é a real (D+2 do evento? da venda? condicionada ao KYC)?
3. **Qual é o app de validação da v1** — PWA (como o handoff define) ou o React
   Native que já existe? Hoje há dois pela metade, e o PWA é justamente o mais
   fraco no requisito que o define: offline.
4. **Portaria no mesmo domínio do comprador?** Hoje `/portaria` é público no site
   do comprador, protegido só pelo PIN. Vale um subdomínio próprio.
5. **Dark mode** — o README marca como fora de escopo, mas o app de portaria é
   noturno por natureza e já nasceu escuro. Confirmar se fica só nele.

---

## 6. Já declarado fora de escopo no v1 (não precisa desenhar agora)

Só listando para não haver dúvida: dark mode geral, apps nativos (v2), tela
própria de transferir ingresso, integração real com Apple/Google Wallet, login
social (Google/Apple) e busca com filtros reais.

---

## Como isso me ajuda a implementar rápido

Se o v2 vier com **(a)** as 6 telas internas em desktop, **(b)** os 4 estados
vermelhos da portaria e **(c)** as 3 telas 🔴 do painel (quem paga a taxa, editar
evento, solicitar saque), eu fecho o grosso do que falta de UI sem precisar
adivinhar nada. O resto é bug e infraestrutura, que corro em paralelo.
