# Pesquisa de gateways — 2ª rodada (27/07/2026), foco em CUSTO

> Motivação: Arthur considerou a taxa de TABELA do cartão da Pagar.me cara
> demais. 1ª rodada (escolha original): `PESQUISA-GATEWAYS-2026-07.md`.
> Esta rodada: 8 provedores com fonte oficial de 27/07/2026; os 6 aderentes
> passaram por verificação adversarial (busca ativa de tarifa escondida).
> Requisitos duros do modelo BoraFest: split + custódia até KYC + KYC pelo
> PSP + estorno via API + Pix e cartão online.

## Tabela-resumo (taxas PÚBLICAS em 27/07/2026 — negociação muda tudo)

| Provedor | Cartão online 1x | Pix | Custódia | KYC pelo PSP | Pegadinha confirmada |
|---|---|---|---|---|---|
| **Asaas** | **2,99% + R$ 0,49 (D+32)** | R$ 1,99 FIXO | ✅ Conta Escrow, liberação manual via API | ✅ compliance Asaas | 30 transferências Pix PJ grátis/mês, depois R$ 2; antecipação 1,25% a.m. se quiser antes de D+32 |
| Pagar.me (atual) | 4,39–5,59% (D+15); split só no plano customizado sob consulta | 1,19% | ✅ transfer_enabled=false | ✅ biometria própria | **R$ 3,67 por saque do recebedor**; antifraude não devolvido em estorno |
| PagBank | 3,99% + R$ 0,40 (D+30) / 4,99% (D+14) | teto 1,89%, real sob conta | ✅ custody.apply por recebedor, até 365d | ✅ | Estorno EXIGE saldo do recebedor; MDR todo no primário |
| Iugu | sob consulta (histórico ~2,51%) | sob consulta (~0,99%) | ✅ (travar saque da subconta) | ✅ | R$ 2/saque; contrato contradiz doc sobre devolver taxa em estorno |
| Zoop | 100% sob consulta (custo base + markup) | sob consulta | ✅ conta gráfica | ✅ (SLA minutos) | Contrato: credenciamento + fixo/transação + tarifas de saque, nada público |
| Stripe Connect | 3,99% + R$ 0,39 (D+30) | 1,19% "invite only" | ⚠️ payout automático diário no BR; custódia só no saldo da plataforma | ✅ | R$ 6/mês por conta conectada + 0,25% + R$ 0,67 por repasse; **R$ 55 por chargeback** |
| Mercado Pago | 3,98% (D+30) | 0,99% | ❌ **SEM custódia** — split cai direto na conta do vendedor | parcial (OAuth) | Eliminado: fere a espinha do modelo |
| Woovi/OpenPix (Pix-first) | não tem cartão | **R$ 0,85 fixo ou 0,80% (mín 0,50/máx 5,00)**, split grátis | ✅ saque de subconta só pela API da plataforma | ⚠️ **NÃO** — KYC documental ficaria conosco | Perna Pix de futura estratégia híbrida; lacuna regulatória/KYC seria nossa |

## Custo real num ingresso de R$ 100 (taxa BoraFest paga pelo comprador)

**Pix** (comprador paga R$ 104,99; nossa receita bruta R$ 4,99):
- Pagar.me 1,19% → custo R$ 1,25 → sobra R$ 3,74
- Asaas R$ 1,99 fixo → sobra R$ 3,00 (fixo: ruim em ingresso barato, ótimo acima de ~R$ 170)
- Woovi 0,80% → custo R$ 0,84 → sobra R$ 4,15 (mas KYC vira nosso)

**Cartão 1x** (comprador paga R$ 106,99; nossa receita bruta R$ 6,99):
- Pagar.me tabela 4,39% → custo R$ 4,70 → sobra R$ 2,29
- **Asaas 2,99% + R$ 0,49 → custo R$ 3,69 → sobra R$ 3,30 (+44% de margem)**
- PagBank D+30 3,99% + R$ 0,40 → custo R$ 4,67 → sobra R$ 2,32

## Decisão recomendada (aguardando OK do Arthur)

1. **Construir o adapter Asaas** (1–2 dias; a arquitetura já é multi-gateway).
   Melhor tabela pública COM o nosso modelo exato (escrow + KYC no PSP + split
   + estorno API). D+32 no cartão não dói: o produtor saca depois mesmo.
2. **Negociar com a Pagar.me em paralelo**, com esta tabela na mão: pedir
   cartão ≤ 3%, Pix ≤ 1% e isenção da taxa de saque de R$ 3,67. A integração
   pronta vira alavanca ("ficar custa zero, sair custa 2 dias").
3. Lançar com quem estiver melhor no dia; manter os dois adapters vivos.
4. **Fase 2 (volume)**: avaliar Woovi na perna Pix (R$ 0,85/0,80%) — exige
   assumirmos o KYC documental dos produtores; só com assessoria/compliance.
5. Mercado Pago segue eliminado (sem custódia). Stripe eliminado no BR
   (custo por conta conectada + R$ 55/chargeback em vertical de evento).

Dossiê completo com fontes e datas: workflow `pesquisa-gateways-2026`
(14 agentes, 27/07/2026).

---

## Adendo (27/07/2026): Cakto e InfinitePay, a pedido do Arthur

Mesma conta (taxa BoraFest 5% + piso R$ 2,49; pior caso 1 ingresso/pedido):

**Pix — sobra por ingresso** (R$ 20 / 50 / 100 / 200):
- Asaas (R$ 1,99/venda): 0,50 / 0,51 / 3,01 / 8,01
- Cakto ("0%" + R$ 2,49/venda): **0,00** / 0,01 / 2,51 / 7,51
- InfinitePay (0% real, sem fixo): 2,49 / 2,50 / 5,00 / 10,00

**Cartão 1x — sobra por ingresso**:
- Asaas (2,99% + R$ 0,49): 1,33 / 0,44 / 1,37 / 3,23
- Cakto (tabela 4,99% + R$ 2,49): **−1,12 / −2,61 / −2,73 / −2,97 (PREJUÍZO em tudo)**
- InfinitePay (4,20% base → 2,29% c/ volume): 1,55 / 0,30 / 0,59 / 1,18

**Vereditos (verificação adversarial):**
- **InfinitePay: FRACO para marketplace.** Pix 0% é real e sem asterisco, mas
  reprova em 4/5 requisitos: sem split, sem custódia, sem KYC de terceiros,
  sem estorno via API; checkout hospedado com redirect (marca deles). Pegadinha
  de contrato: retenção de repasses até 180 dias em apuração — Reclame Aqui
  documenta congelamento recorrente no perfil "pico de venda + entrega futura"
  (= ticketeria). Radar apenas como lojista direto de produto próprio.
- **Cakto: FRACO/sob consulta.** Verificador achou uma Split API não
  documentada (workspace Postman oficial, api.pay.cakto.com.br) — existe
  produto de marketplace escondido. Mas: reserva de segurança sobre TODOS
  (10% Pix / 20% cartão por ~35 dias), cartão D+15, R$ 4,59/saque, estorno só
  total, DNA infoproduto sem material para eventos. Tabela de cartão
  inviabiliza taxa de 5%.

**Conclusão: mantida a recomendação Asaas** (única com margem positiva em
todos os cenários E os 5 requisitos estruturais atendidos com doc pública).

---

## Adendo 2 (28/07/2026): caça a uma opção superior ao Asaas

Frentes ainda não exploradas, verificadas direto na fonte:

| Provedor | O que tem | Por que NÃO supera o Asaas hoje |
|---|---|---|
| **Braspag/Cielo Split** | Subadquirência p/ marketplace madura; exemplo na doc: facilitador 2% + R$ 0,30 (abaixo do Asaas no cartão); KYC de subordinados; agenda financeira | Preço real é negociado em contrato (o 2% é exemplo ilustrativo); liquidação vai DIRETO ao subordinado pela agenda — "sem retenção de valores", ou seja, sem a nossa custódia; Pix no split não confirmado; contrato enterprise Cielo, não self-service |
| **Getnet Split** | Produto de marketplace (Santander), liquidação via CIP | Sem preço público, contrato comercial, sem evidência de custódia controlada pela plataforma |
| **Adyen for Platforms** | O padrão-ouro mundial (custódia + KYC + ticketing como segmento-alvo) | Enterprise puro: sem preço público BR, foco em plataformas grandes — inacessível em pré-lançamento |
| **Safe2Pay** | API real de subcontas/split documentada; exemplos na doc: Pix 1,99%, cartão 3,30% | Preço oficial "sob consulta" (exemplos ≠ tabela); custódia e KYC das subcontas não documentados publicamente; cliente do vertical eventos opera a 4,99% |
| **Vindi/Barte/Malga** | — | Barte é B2B (produto errado); Malga é orquestrador (não resolve custódia/KYC — ainda precisa de adquirente); Vindi marketplace sob consulta, sem evidência de superar o benchmark |
| **Asaas negociado** | Página oficial admite "condições do seu contrato" ≠ tabela | Sem faixas públicas — o caminho é abrir conta, gerar volume e negociar de dentro |

**Conclusão: nenhuma opção verificável supera o Asaas HOJE para uma startup em
pré-lançamento.** A "opção superior" não é um provedor, é um ESTÁGIO: com
R$ 300k–1M+/mês de volume, as rotas enterprise (Braspag, Getnet, Adyen,
Pagar.me custom, Asaas negociado) derrubam qualquer tabela. Estratégia:
lançar no Asaas → volume → renegociar com as propostas enterprise na mesa.
(Obs.: workflow de 7 agentes caiu no limite de sessão; análise concluída
manualmente nas fontes oficiais em 28/07/2026.)
