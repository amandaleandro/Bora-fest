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
