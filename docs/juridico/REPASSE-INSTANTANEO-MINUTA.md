# Minuta — Aditivo de Repasse Instantâneo (casas de confiança)

> **MINUTA para revisão de advogado antes de qualquer assinatura.**
> Contexto (decisão Arthur, 2026-07-28): casas consolidadas da cidade recebem
> repasse instantâneo para facilitar a entrada da BoraFest no mercado; em
> contrapartida, assumem contratualmente a responsabilidade pelos reembolsos.

## Objeto

Aditivo ao Termo de Uso do Organizador que altera o regime de repasse da
organização **[NOME DA CASA]**, CNPJ **[CNPJ]**, de PADRÃO para
**INSTANTÂNEO**.

## Cláusulas essenciais

**1. Regime padrão (referência).** No regime PADRÃO, os valores de cada venda
permanecem em custódia e só se tornam sacáveis após o término da janela de
reembolso de **7 (sete) dias corridos** contados do pagamento (CDC, art. 49),
sendo a BoraFest a executora operacional dos reembolsos com débito no saldo
em custódia do Organizador.

**2. Regime instantâneo.** No regime INSTANTÂNEO, o saldo integral das vendas
torna-se sacável imediatamente após a confirmação do pagamento, sem aguardar
a janela de reembolso, mediante:

a) **Taxa de antecipação** de **1,25% ao mês, pró-rata dia**, incidente
   exclusivamente sobre a parcela do saque que ainda estiver dentro da janela
   de reembolso, debitada do saldo no ato do repasse;

b) **Transferência da responsabilidade pelo reembolso**: o Organizador assume
   integralmente, perante o consumidor e perante a BoraFest, a obrigação de
   restituir valores de (i) desistências no prazo legal de 7 dias,
   (ii) cancelamento, adiamento ou alteração substancial do evento, e
   (iii) estornos e contestações (chargebacks) de qualquer natureza
   relacionados aos seus eventos;

c) **Recomposição**: verificado reembolso/estorno/chargeback sem saldo em
   custódia suficiente, o Organizador obriga-se a recompor o valor em até
   **2 (dois) dias úteis** da notificação, autorizando desde já a compensação
   com quaisquer créditos futuros na plataforma;

d) **Garantia reputacional**: a BoraFest pode reverter o regime a PADRÃO, a
   seu exclusivo critério e sem aviso prévio, em caso de indícios de fraude,
   elevação anormal de contestações ou inadimplemento da recomposição.

**3. Transparência ao consumidor.** A Política de Privacidade e os Termos de
Compra continuam indicando a BoraFest como operadora da plataforma; a
responsabilidade final pelo reembolso do evento é do Organizador, conforme
já previsto nos Termos do Organizador — este aditivo reforça e antecipa essa
alocação no regime instantâneo.

**4. Vigência.** A partir da assinatura, aplicando-se a vendas futuras.
Vendas anteriores permanecem no regime em que foram realizadas.

---

## Operacional interno (não vai no contrato)

- Ligar o regime: Backoffice → Organizações → [casa] → Repasse →
  INSTANTÂNEO (auditado). Só após aditivo assinado.
- `refundHoldDays` por organização (padrão 7) e taxa de antecipação
  (`ANTICIPATION_FEE_BPS_MONTHLY`, padrão 125 bps/mês) são configuráveis.
- Repasse automático (autoPayout) é independente do regime: PADRÃO repassa o
  que venceu a janela; INSTANTÂNEO repassa tudo com a taxa da cláusula 2(a).
