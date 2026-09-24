# BF-022 — Check-in Facial

> Fundação criada em 23/09/2026.
>
> Estado: **arquitetura e modelo de dados preparados; reconhecimento facial/liveness ainda não integrado**.

## 1. Objetivo

Permitir entrada opcional por verificação facial 1:1 ligada ao próprio ingresso.

Fluxo desejado:

1. titular possui ingresso válido;
2. titular escolhe cadastrar o rosto para aquele ingresso;
3. BoraFest apresenta finalidade e consentimento/aviso destacado conforme base legal aplicável;
4. captura passa por liveness + enrolamento no provedor biométrico;
5. BoraFest armazena apenas uma referência opaca ao template no provedor;
6. na portaria, o operador seleciona/verifica o ingresso e executa a comparação 1:1;
7. se aprovado, o check-in usa o mesmo motor transacional do QR;
8. se falhar ou o titular não aderir, QR/documento continuam disponíveis.

## 2. O que NÃO será feito

Não implementar:
- reconhecimento em massa da fila;
- varredura de câmera procurando rostos sem ação do titular;
- busca 1:N em uma base global de pessoas;
- inferência de raça, idade, gênero, emoção, saúde ou qualquer atributo;
- retenção permanente de fotografia facial;
- bloqueio de entrada exclusivamente porque o facial falhou.

O facial é um método opcional de autenticação do ingresso, não vigilância.

## 3. LGPD e minimização

Biometria vinculada a uma pessoa é dado pessoal sensível.

Regras do produto:
- finalidade específica: controle de acesso/autenticação do ingresso;
- transparência destacada antes do enrolamento;
- adesão opcional enquanto houver fallback equivalente;
- retenção curta;
- revogação;
- exclusão do vínculo/template após expiração/revogação;
- trilha de auditoria;
- acesso restrito;
- nenhuma imagem crua persistida no banco principal do BoraFest.

Antes de produção, validar RIPD/DPIA, termos, operador/controlador, suboperador biométrico, localização dos dados, SLA de exclusão e contrato com o fornecedor.

## 4. Modelo criado

### Event

- `faceCheckinEnabled: Boolean = false`
- `faceRetentionHours: Int = 24`
- constraint atual: 1 a 168 horas após o fim do evento.

### TicketFaceEnrollment

Vinculado a um único `Ticket`:

- `ticketId` único;
- `status`: PENDING / ACTIVE / REVOKED / EXPIRED;
- `provider`;
- `providerReference` opaca;
- `consentVersion`;
- `consentedAt`;
- `revokedAt`;
- `expiresAt`.

Não existe campo para imagem ou embedding facial bruto.

### Checkin

Novo campo:

`method: QR | FACE | MANUAL`

`source` continua representando conectividade:

`ONLINE | OFFLINE_SYNC`

Não misturar método com origem.

## 5. Arquitetura da verificação

### Recomendado

**1:1 verification**:

`ticketId + captura ao vivo -> comparar contra enrollment daquele ticket`

Não usar identificação 1:N.

### Contrato futuro do provider

O backend deve abstrair o fornecedor:

- `createEnrollment(ticketId, capture)`
- `verify(providerReference, liveCapture)`
- `deleteEnrollment(providerReference)`
- `health()`

Resposta mínima de verificação:
- verified boolean;
- providerRequestId;
- confidence/score somente para auditoria técnica restrita;
- livenessPassed;
- reasonCode.

O frontend nunca decide sozinho que uma pessoa entrou.

## 6. Liveness

Obrigatório para produção.

Evitar aceitar:
- fotografia impressa;
- foto em outra tela;
- vídeo reproduzido;
- captura estática sem prova de presença.

Threshold deve ser configurado no backend e versionado.

## 7. Portaria

Facial precisa reutilizar as mesmas regras do QR:

- ingresso pertence ao evento;
- status válido;
- não cancelado/reembolsado;
- não utilizado;
- operação idempotente;
- concorrência protegida;
- check-in registrado;
- reversão auditável.

Resultado facial positivo não ignora regra de ingresso.

## 8. Offline

Primeira versão recomendada: **facial somente online**.

Motivo:
- template biométrico não deve ser distribuído para todos os aparelhos da portaria;
- revogação precisa valer imediatamente;
- proteção da biometria é mais crítica que conveniência offline.

Se não houver rede:
- QR offline continua funcionando;
- facial mostra “temporariamente indisponível”;
- operador usa QR/documento.

## 9. Transferência de ingresso

Ao transferir um ingresso:
- enrollment facial existente deve ser revogado/excluído;
- novo titular precisa fazer novo enrollment;
- nunca transferir biometria junto com o ingresso.

## 10. Reembolso/cancelamento

Ao reembolsar/cancelar:
- enrollment deve ser revogado;
- job de exclusão solicita remoção ao provider;
- check-in facial não pode mais aceitar o ticket.

## 11. Expiração

Após o evento:
- `expiresAt = event.endsAt + faceRetentionHours`;
- worker marca EXPIRED;
- solicita exclusão ao provider;
- limpa `providerReference` após confirmação quando a estratégia escolhida permitir.

## 12. Observabilidade

Métricas futuras:
- enrollments ativos;
- enrollments expirados pendentes de exclusão;
- tentativas FACE;
- aprovações;
- rejeições;
- liveness failures;
- provider errors;
- latência p95;
- fallback para QR.

Nunca colocar imagem, embedding ou dados biométricos em log.

## 13. Interface do comprador

Carteira do ingresso:
- “Ativar entrada por reconhecimento facial”;
- explicação simples da finalidade;
- prazo de retenção;
- link de privacidade;
- botão “Remover reconhecimento facial”;
- status: Não cadastrado / Ativo / Revogado / Expirado.

## 14. Interface da portaria

Após configurar evento:
- botão QR;
- botão Facial apenas se habilitado;
- câmera abre somente após ação do operador/titular;
- resultado: validado / não correspondente / liveness falhou / indisponível;
- sempre oferecer “Usar QR”.

## 15. Próximas etapas

1. escolher/implementar `FaceVerificationProvider`;
2. endpoint de consentimento/enrollment;
3. endpoint de revogação;
4. endpoint de verificação 1:1 autenticado por validator device;
5. liveness;
6. worker de expiração/exclusão;
7. UI da carteira;
8. UI da portaria;
9. testes de replay/concorrência;
10. RIPD/DPIA + revisão jurídica e de privacidade antes de habilitar em produção.

## 16. Critério de pronto

BF-022 só pode ser marcado como PRONTO quando:
- enrollment real;
- liveness;
- verificação 1:1;
- revogação;
- expiração/exclusão;
- fallback QR;
- trilha de auditoria;
- observabilidade;
- testes;
- documentação de privacidade;
- smoke test real na portaria

estiverem concluídos.

Até lá, `faceCheckinEnabled` deve permanecer `false` em produção.
