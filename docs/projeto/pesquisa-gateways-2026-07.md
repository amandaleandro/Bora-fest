# Pesquisa de gateways/adquirentes — julho/2026

> Pesquisa multi-agente com verificação adversarial de fontes (12 provedores + taxas de concorrentes de ticketeria + piso de custo Pix/cartão). Fontes oficiais acessadas em 2026-07-23. **Decisão final registrada no REGISTRO.md.**

## Recomendação

### Primário
PRIMÁRIO: Pagar.me (Grupo Stone), como subadquirente/PSP. Vence no critério nº1 (o decisivo): implementa a liberação condicional de repasse de forma NATIVA e sem gambiarra via status do recebedor — em 'registration'/'affiliation' o produtor TRANSACIONA mas NÃO SACA; só saca quando 'active' (KYC aprovado); 'refused/suspended/blocked' = nada. Isso é exatamente o hold-até-KYC que a BoraFest precisa. O recebedor NÃO precisa ter conta Pagar.me e só o marketplace acessa/controla o saldo de cada produtor — logo NÃO há o teto regulatório de onboarding que trava a Asaas (10 subcontas / R$2.000 por subconta / até 60 dias). Split nativo por percentage ou flat na criação da transação (type/amount/recipient_id), com a margem da BoraFest retida direto (ex.: retém X%, repassa o resto). Tudo verificado com CONFIANÇA ALTA em doc oficial (pagar.me/ofertas e docs.pagar.me, acesso 2026-07-23): Pix 1,19% (confirmação em segundos por webhook), crédito à vista 4,39% (Plano À Vista), boleto R$3,49. DX 4/5: tokenizecard.js (reduz PCI), sandbox com simuladores (Pix/cartão/débito/boleto/voucher), webhooks com retentativa+idempotência, estorno via API, taxas negociáveis no Plano Customizado por volume.

### Fallback
FALLBACK: Asaas (Instituição de Pagamento). Também tem liberação condicional NATIVA (subconta com avaliação regulatória/KYC atrelada; split sobre netValue com o excedente creditado automaticamente ao emissor = margem da BoraFest sai natural) e ganha em CUSTO: Pix de tarifa FIXA R$0,99 (promo 3 meses) / R$1,99 (imbatível em ticket alto, >~R$167) e cartão à vista 2,99% + R$0,49 (mais barato que os 4,39% da Pagar.me), com antecipação via API já disponível (1,25%/mês). É o segundo adapter e também o roteamento preferencial para eventos de TICKET ALTO e produtores CNPJ. Ressalvas que o tiram do 1º lugar: onboarding travado pela avaliação regulatória (até 60 dias corridos) + limites iniciais (máx. 10 subcontas de titulares distintos e R$2.000 de cobrança por subconta) — ruim para escalar muitos produtores no lançamento; subconta SÓ para CNPJ (produtor PF fica de fora); cartão liquida em ~D+32; relatos de terceiros (Runzos 2026) de bloqueios de conta e suporte lento. Tudo verificado com CONFIANÇA ALTA em fonte oficial.

## Teto competitivo (o que as ticketeiras cobram)
Teto a bater (taxa TOTAL cobrada do produtor pelas ticketeiras, 2025-2026, com fontes): Sympla ~12-12,5% (10% serviço + 2-2,5% processamento; mín. R$3,99 p/ ingressos ≤R$39,90; assento marcado a partir de 15%) — o mais caro e líder; Even3 10% (mín. R$2,50); Ingresse ~10% online (não oficial/incerto); Eventbrite BR 6,99% (Essentials) / 9,99% (Professional); challengers Bilheto ~7,99% e Lets.events a partir de 7,99%; E-inscrição 6,9%. Faixa geral do setor: 10-20%. Ponto de corte competitivo: os incumbentes-alvo (Sympla, Even3, Ingresse) ancoram em ~10-12%; os challengers atacam em ~7-8%. Para vencer TODOS com folga, o custo total ao produtor da BoraFest deve ficar em ≤~7% blended. RESSALVA JURÍDICA (Festivalando 2024): STJ considera a taxa de conveniência legal, mas o Procon-SP entende que taxa em PERCENTUAL puro é abusiva e que só valor FIXO estaria em conformidade com o CDC — favorece estrutura fixa ou híbrida.

## Estrutura de taxa sugerida para a BoraFest
Estrutura HÍBRIDA (percentual + piso fixo) diferenciada por método, que (a) bate todos os concorrentes, (b) cobre custo do gateway + margem e (c) reduz risco Procon ao ter componente fixo. Custo de gateway (Pagar.me primário, verificado): Pix 1,19%; crédito à vista 4,39%. TAXA BORAFEST AO PRODUTOR: Pix 4,99% (piso R$2,49); Cartão à vista 6,99%; Cartão parcelado 6,99% COM os juros de parcelamento repassados ao COMPRADOR (a BoraFest não absorve o custo do parcelado, que no Plano À Vista é caríssimo — 12x 25,29%); Boleto R$3,49 fixo repassado ao comprador. Todos com piso mínimo de R$2,49/ingresso. MARGENS (all-in, Pagar.me): Pix 4,99% − 1,19% = +3,80 pp; cartão à vista 6,99% − 4,39% = +2,60 pp. Blended num mix típico 70% Pix / 30% cartão: receita 0,7×4,99 + 0,3×6,99 = 5,59% ao produtor, contra custo blended ~2,15% → MARGEM BRUTA ~3,44 pp. Resultado: 5,59% blended é MENOS DA METADE da Sympla (~12%), abaixo de Even3/Ingresse (10%), abaixo de Eventbrite (6,99-9,99%) e do Pix (4,99%) até abaixo dos challengers Bilheto/Lets (7,99%). Headline de marketing: 'a partir de 4,99% no Pix, teto de 6,99%'. Com Asaas (fallback) em eventos de ticket alto, o custo de cartão cai para 2,99% e o Pix para R$1,99 fixo, ampliando a margem sem mexer no preço ao produtor. ALAVANCA: negociar Plano Customizado por volume (Pix e crédito) permite baixar ainda mais a taxa cheia mantendo margem — o BC estuda teto de intercâmbio do crédito (jul/2025), que seria upside futuro.

## Ranking completo

### 1. Pagar.me (Grupo Stone)
- **Pix:** 1,19% (confirmado oficial 2026-07-23; segundos via webhook). Não é o mais barato, mas previsível e negociável no Plano Customizado.
- **Cartão:** Crédito à vista 4,39% (Plano À Vista) / 5,59% (Plano Parcelado 1x); parcelado caro no à vista (6x 14,99%, 12x 25,29%); boleto R$3,49; débito sob consulta.
- **Split/marketplace:** NATIVO e o melhor fit: split por %/flat na criação; liberação condicional via status do recebedor (só saca em 'active'/pós-KYC); recebedor não precisa de conta própria; só o marketplace controla o saldo. Sem teto de onboarding.
- **Liquidação:** Pix rápido (mesmo dia/D+1); crédito D+30 padrão; antecipação (RAV) por parcela exige ~60d de histórico + aprovação — atenção ao fluxo de caixa inicial.
- **Veredito:** PRIMÁRIO. Melhor equilíbrio entre hold-até-KYC nativo limpo, verificação de alta confiança, robustez Stone e DX. Negociar Pix/crédito por volume é essencial.

### 2. Asaas
- **Pix:** FIXO R$0,99 (promo 3m) / R$1,99 — mais barato em ticket alto (>~R$167); segundos via webhook.
- **Cartão:** À vista 2,99% + R$0,49 (mais barato que Pagar.me); parcelado 2-6x 3,49% / 7-12x 3,99% / 13-21x 4,29% + R$0,49; débito 1,89% + R$0,35.
- **Split/marketplace:** NATIVO sobre netValue (%/fixo), emissor fica com o excedente automaticamente; liberação condicional via avaliação/KYC da subconta. Limitações: só CNPJ; teto inicial 10 subcontas / R$2.000 por até 60 dias.
- **Liquidação:** Crédito ~D+32; antecipação via API imediata (1,25%/mês à vista, 1,70%/mês parcelado).
- **Veredito:** FALLBACK e roteamento preferencial para ticket alto / CNPJ. Menor custo blended, mas onboarding travado no início e sem PF.

### 3. Iugu
- **Pix:** ~0,99% NÃO CONFIRMADO (número vem de blog HeroSpark de ABR/2023, não 2025); site oficial não publica — sob consulta.
- **Cartão:** ~3,34% à vista NÃO CONFIRMADO/provavelmente defasado (2023); sinais de 2026 apontam faixas maiores.
- **Split/marketplace:** NATIVO Conta Mestre + Subcontas; liberação condicional REAL (subconta 'verified' obrigatória p/ transacionar/sacar) + gatilhos KYC (referrals.verification). Arquitetura confirmada em doc oficial 2026.
- **Liquidação:** Pix saque D+1; cartão modelo com antecipação embutida (D+1); verificação de subconta 2-5 dias úteis.
- **Veredito:** Fit estrutural forte, MAS taxas não confirmadas e split exige plano pago (~R$649/mês, a reconfirmar). Exigir cotação oficial antes de considerar.

### 4. Celcoin (cel_cash / Galax Pay + Conta Escrow)
- **Pix:** Pix estático GRÁTIS; Pix Cobrança (QR dinâmico) R$1,50 FIXO (âncora pública confirmada); instantâneo por webhook.
- **Cartão:** Âncora 3,49% + R$0,69 à vista (modelo operadora, sem mensalidade); parcelado 1-12x sob tabela; débito sob consulta.
- **Split/marketplace:** Subcredenciamento (Galax Pay IP) + Conta Escrow com deposit-retention (% / período / teto) + onboarding-KYC por webhook. Melhor aderência a 'reter até KYC', mas é COMBINAÇÃO de mecanismos (orquestração pela plataforma), não toggle único.
- **Liquidação:** Crédito D+30 por parcela; antecipação com taxa variável mensal.
- **Veredito:** Forte candidato de escrow com Pix fixo barato; ponto fraco: D+30 e engenharia de orquestração KYC+retenção+split.

### 5. Mercado Pago (Split 1:1)
- **Pix:** 0,99% sem piso (o mais barato entre os viáveis); segundos por webhook.
- **Cartão:** À vista 4,98% (D0) a 3,98% (~30d); parcelamento e carteiras (Apple/Google Pay).
- **Split/marketplace:** Split 1:1 nativo, MAS o repasse cai AUTOMÁTICO e DIRETO na conta MP do vendedor (via OAuth) — a BoraFest NÃO retém em custódia até um KYC próprio. Mismatch com o requisito nº1.
- **Liquidação:** Pix em segundos; cartão D0/14/30d; antecipação disponível.
- **Veredito:** Pix baratíssimo e marca forte, mas falha no critério decisivo (sem custódia/hold próprio). Só serviria como trilho de Pix se o hold fosse resolvido fora do split.

### 6. Zoop
- **Pix:** Sob consulta (D+1). Faixa 0,99-1,89% é referência de mercado, NÃO preço da Zoop. taxasConfirmadas=false.
- **Cartão:** Sob consulta por MCC/contrato; crédito D+30 (Standard) / D+1 (PRO).
- **Split/marketplace:** Robusto (%/absoluto, a priori/a posteriori, até 20 recebedores) + KYC de seller (status Active). PORÉM escrow-até-KYC é FRÁGIL para Pix: janela do split a posteriori fecha em ~D+1, insuficiente se o KYC leva até 3 dias úteis.
- **Liquidação:** Pix D+1; antecipação não cobre CNP/online automaticamente.
- **Veredito:** Funcional forte, mas preços 100% opacos e hold-para-Pix frágil. Cotação formal obrigatória.

### 7. PagBank (PagSeguro)
- **Pix:** 1,89% tabela (progressivo por volume); mesmo dia / na hora.
- **Cartão:** Crédito 3,99% + R$0,40 (30d) / 4,99% (14d); débito 2,39%.
- **Split/marketplace:** Nativo via Connect + KYC (Receita Federal), MAS o valor cai na subconta PagBank do PRÓPRIO produtor (bloqueio por KYC do PagBank, não escrow da BoraFest). Menos controle de liberação pela plataforma.
- **Liquidação:** Pix mesmo dia; cartão D+14/D+30; antecipação avulsa/programada.
- **Veredito:** Full-stack robusto e negociável, mas modelo de retenção menos controlável e atrito relatado em sandbox/webhooks.

### 8. Efí (ex-Gerencianet)
- **Pix:** 1,19% (liquidação imediata, webhook em segundos).
- **Cartão:** À vista 3,49%; 2-6x 3,99%; 7-12x 4,39%; boleto R$3,45.
- **Split/marketplace:** Nativo (Pix/boleto/cartão) MAS só ENTRE CONTAS EFÍ (todo produtor precisa abrir conta) e SEM escrow/liberação condicional nativa (repasse imediato). Exige orquestração manual do hold.
- **Liquidação:** Pix imediato; crédito ~D+31; antecipação 1,29%/parcela.
- **Veredito:** Custo competitivo, mas não atende o hold-até-KYC nativamente e onboarding de conta Efí por produtor gera fricção.

### 9. Stripe (Connect)
- **Pix:** 1,19% e 'invite only' para contas BR (disponibilidade não garantida).
- **Cartão:** 3,99% + R$0,39 (+2% internacional); PARCELAMENTO BR não suportado nativamente (só México) — lacuna grave para ticketeria.
- **Split/marketplace:** Connect purpose-built (application fees, payouts bloqueados até verificação KYC) — encaixe conceitual perfeito.
- **Liquidação:** Cartão doméstico D+30 SEM antecipação nos moldes BR; custos Connect empilham (R$6/conta ativa + 0,25% + R$0,67/payout + 0,25%).
- **Veredito:** Melhor DX do mercado e ótimo para vendas INTERNACIONAIS, mas fraco como adquirente PRINCIPAL doméstico (sem parcelamento, Pix invite-only, caro).

### 10. Adyen
- **Pix:** Sob consulta (por volume); Pix Open Finance sem redirecionamento (FIDO2) p/ grandes empresas.
- **Cartão:** Interchange++ (US$0,13 + ~0,60% markup, cai com volume); sob consulta no BR.
- **Split/marketplace:** Enterprise (Adyen for Platforms): balance accounts com payout CONDICIONADO a KYC — fit direto ao reter/repassar.
- **Liquidação:** Cartão ~T+2/parcela; antecipação via BS2.
- **Veredito:** Excelente alvo de MIGRAÇÃO em escala. No lançamento: mínimo ~€1.000/mês em taxas + onboarding enterprise = caro/complexo demais.

### 11. Barte
- **Pix:** Sob consulta. Posicionamento PREMIUM: declara NÃO competir por fração de taxa.
- **Cartão:** Sob consulta; parcelamento até 21x.
- **Split/marketplace:** Nativo pós-transação (até 10 sellers, %/fixo); hold-até-KYC não documentado publicamente.
- **Liquidação:** Promessa D+2; antecipação integrada.
- **Veredito:** Tecnicamente ok, mas o posicionamento premium conflita frontalmente com a meta de subcotar Sympla/Ingresse. Descartar para o objetivo de preço.

### 12. Malga (orquestrador)
- **Pix:** Sem taxa própria — depende do subadquirente roteado (Zoop/Pagar.me v5 p/ split de Pix).
- **Cartão:** MDR do adquirente roteado + fee de orquestração + SaaS mensal.
- **Split/marketplace:** Agnóstico com platform-fee, MAS custódia e liberação condicional são do provedor por baixo, não da Malga.
- **Liquidação:** Definida pelo provedor subjacente.
- **Veredito:** Overkill no início (sem volume p/ justificar multi-adquirente). Faz sentido em escala, para failover e renegociação agressiva de MDR.

### 13. Dock
- **Pix:** Sob consulta (white-label).
- **Cartão:** Sob consulta; você define o MDR na camada comercial.
- **Split/marketplace:** Disponível, mas escrow/liberação por KYC não é turnkey (exige engenharia).
- **Liquidação:** Configurável; antecipação disponível.
- **Veredito:** Infra enterprise para quando a BoraFest quiser virar sua própria subadquirente em escala. Pesado demais para começar.

## Riscos e mitigação

- Pix da Pagar.me (1,19%) não é o mais barato do mercado (MP 0,99%, Asaas fixo). Se não negociar o Plano Customizado por volume, a margem no Pix aperta — negociação de volume é PRÉ-REQUISITO para sustentar a taxa agressiva.
- Crédito à vista da Pagar.me 4,39% é alto e o parcelado no Plano À Vista é caríssimo (6x 14,99%, 12x 25,29%). Mitigação obrigatória: repassar os juros do parcelamento ao COMPRADOR (a BoraFest nunca absorve o parcelado).
- Liquidação de cartão D+30 na Pagar.me + antecipação (RAV) exige ~60 dias de histórico e aprovação do suporte: no LANÇAMENTO o repasse do produtor em vendas de cartão fica preso ao ciclo de liquidação (o hold-até-KYC casa bem com isso, mas há risco de fluxo de caixa e de expectativa do produtor). Comunicar prazo de repasse de cartão claramente.
- Débito na Pagar.me está sob consulta (sem número público) e Apple Pay não aparece na doc oficial (só Google Pay) — validar ambos com o comercial antes de prometer.
- Assinatura de webhook (X-Hub-Signature / HMAC sha256) só foi confirmada em fonte terceira; confirmar a string exata no painel/doc oficial e implementar idempotência por id de evento antes de produção.
- Fallback Asaas: avaliação regulatória de até 60 dias + teto inicial (10 subcontas de titulares distintos, R$2.000/subconta) travam o onboarding em escala no começo; subconta SÓ para CNPJ (produtor PF fica de fora); relatos de bloqueio de conta e suporte lento (Runzos 2026). Não depender só da Asaas para escalar produtores rápido.
- Risco regulatório (Procon-SP): taxa de conveniência em percentual PURO é vista como abusiva — por isso a estrutura sugerida inclui piso fixo (R$2,49) e componente por método; validar com jurídico. STJ, porém, reconhece a legalidade da taxa como ressarcimento de intermediação.
- AML/compliance: o hold-até-KYC deve ser SEMPRE imposto pelo status do gateway (recebedor não-'active' não saca), nunca por workaround manual de reter 100% e transferir por fora do split — isso reintroduz risco regulatório e de custódia.
- Meta comercial: eventos Pix-heavy sustentam facilmente ~4,99-6,99%; eventos cartão-heavy comprimem a margem (custo 4,39% na Pagar.me). Monitorar o mix real por evento e empurrar Pix (desconto/checkout) para proteger a margem blended.

## Plano de integração (Fase 4)
Encaixe na interface PaymentGateway (Fase 4) com dois adapters + roteador. (A) Contrato comum da interface: createCharge(metodo, valor, splitRules), onboardReceiver(dadosKYC), getReceiverStatus() -> {PENDING_KYC | ACTIVE | REFUSED}, createSplit(recebedores[], %/flat), handleWebhook(evento) [idempotente por id de evento + verificação de assinatura], refund(chargeId), anticipate(). Modelo de domínio compartilhado: Produtor = Recebedor/Subconta; máquina de estados PENDING_KYC -> ACTIVE que faz o GATING de saque/repasse (o adapter nunca libera saque de produtor não-ACTIVE). (B) PagarmeAdapter (PRIMÁRIO): mapeia Produtor -> recebedor (status registration/affiliation -> active); split no objeto payments (type=percentage/flat, recipient_id); repasse bloqueado nativamente até status 'active' (KYC); webhooks com retentativa+idempotência e verificação HMAC; tokenizecard.js no front (PCI reduzido); estorno via API. Requer conta PSP. (C) AsaasAdapter (FALLBACK / rota de ticket alto e CNPJ): Produtor -> subconta (walletId); split sobre netValue (fixo/%) com o excedente indo ao emissor (margem BoraFest automática); liberação condicional pela avaliação/KYC da subconta; webhook autenticado por token no header 'asaas-access-token' (não usar API Key), idempotência por id de evento; antecipação via API. Atenção: tokenização Asaas NÃO é client-side (1ª captura passa pelo servidor -> exige SAQ-D) — se o escopo PCI for crítico, capturar cartão só via adapter Pagar.me. (D) Roteador: default = Pagar.me; selecionar Asaas por regra de negócio (ticket médio alto do evento, produtor CNPJ elegível a subconta, ou custo blended alvo) e como failover em indisponibilidade. Ambos os adapters emitem o mesmo evento de domínio 'RepasseLiberado' apenas quando o recebedor/subconta está ACTIVE, preservando o invariante hold-até-KYC independente do provedor. Fase futura: manter Adyen/Celcoin/Dock como adapters candidatos de migração em escala, e Stripe como adapter dedicado a vendas INTERNACIONAIS.

## Justificativa
Aplicando os critérios NA ORDEM pedida: (1) Split + liberação condicional — Pagar.me e Asaas são os únicos que entregam hold-até-KYC NATIVO e VERIFICADO em fonte oficial com alta confiança (MP, PagBank e Efí falham: dinheiro cai direto na conta do vendedor ou repasse é imediato). Entre os dois, Pagar.me é mais limpo: o gating por status do recebedor ('active' após KYC) não impõe o teto de onboarding da Asaas (10 subcontas / R$2.000 / até 60 dias), o recebedor não precisa de conta própria e atende também produtores sem CNPJ próprio de subconta — desempate a favor da Pagar.me já no critério nº1. (2) Pix — empate técnico: Asaas fixo é mais barato acima de ~R$167, Pagar.me 1,19% é mais barato abaixo; ambos com webhook em segundos. (3) Cartão — Asaas (2,99%) vence Pagar.me (4,39%), o que mantém a Asaas fortíssima como fallback e como rota preferencial de ticket alto. (4) DX — ambos 4/5. (5) Liquidação/antecipação — leve vantagem Asaas (antecipação via API imediata) vs Pagar.me (exige ~60d de histórico). (6) Negociabilidade — ambos negociáveis. Como o critério nº1 é o decisivo e é onde a Pagar.me diferencia com o menor atrito operacional e a maior robustez (Stone), ela é PRIMÁRIA; a Asaas cobre o flanco de custo como FALLBACK. Como a Fase 4 já prevê a interface PaymentGateway com adapters, manter os dois é não só suportável como estratégico: roteamento por segmento (Asaas para ticket alto/CNPJ, Pagar.me como default e para produtores sem subconta CNPJ) e failover. IMPORTANTE de framing: o custo de gateway (1,19% Pix / 4,39% cartão) é COMPONENTE da taxa da BoraFest, não a taxa final — comparar 1,19% com os 12% da Sympla é maçã-com-laranja; o gateway barato é o que ABRE espaço para a taxa competitiva.
