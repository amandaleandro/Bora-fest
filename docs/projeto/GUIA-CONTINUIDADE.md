# BoraFest — Guia de continuidade técnica

> Documento permanente para qualquer pessoa que vá desenvolver, revisar, operar ou dar manutenção no BoraFest.
>
> Última revisão estrutural: 17/09/2026.

## 1. Objetivo deste documento

Este arquivo existe para evitar que uma pessoa nova precise descobrir o projeto por tentativa e erro. Antes de alterar qualquer fluxo crítico, leia este documento e os registros de mudanças em `docs/projeto/`.

O BoraFest não é apenas um checkout de ingressos. O produto cobre descoberta pública, compra, pagamento, emissão, promoters, listas, portaria, venda presencial, VIP, financeiro e operação do produtor.

## 2. Mapa do monorepo

### Aplicações

- `apps/checkout` — site público, descoberta, páginas de evento, compra, perfil e jornadas do comprador.
- `apps/producer` — painel do produtor/organização.
- `apps/admin` — operações administrativas da plataforma.
- `apps/api` — API principal, regras de negócio e autorização.
- `apps/worker` — processamento assíncrono: emissão, notificações, filas e tarefas de retaguarda.
- `apps/mobile-checkin` — experiência móvel da portaria/check-in.
- `apps/mobile-producer` — experiência móvel do produtor.
- `apps/mobile-public` — experiência móvel pública.

### Pacotes

- `packages/contracts` — schemas e contratos compartilhados. Validações estruturais devem nascer aqui quando são reutilizadas entre cliente e servidor.
- `packages/database` — Prisma, schema, migrations e seed.
- `packages/payments` — regras compartilhadas ligadas a pagamentos.
- demais `packages/*` — bibliotecas compartilhadas do monorepo.

## 3. Regra principal de arquitetura

A UI nunca deve ser a única barreira para uma regra de negócio.

Exemplos:
- evento encerrado não pode vender: a UI deve esconder o CTA, mas a API também precisa recusar;
- lote exclusivo de PDV não pode ser comprado online: bloquear no backend;
- permissões não podem depender apenas de menu escondido;
- idempotência de pagamento não pode depender de botão desabilitado no navegador.

Sempre que uma regra proteger dinheiro, estoque, acesso, dados pessoais ou permissão, ela deve existir no servidor.

## 4. Fluxo crítico do comprador

O caminho crítico é:

`descoberta → evento → seleção de ingresso → reserva → pedido/pagamento → confirmação → emissão → ingresso/QR → portaria`

Uma alteração em qualquer etapa deve ser revisada considerando as etapas seguintes.

### Pontos que não podem quebrar

- estoque e concorrência;
- expiração da reserva;
- idempotência;
- aprovação de Pix/pagamento;
- emissão do ingresso depois do pagamento;
- QR único;
- reenvio/acesso ao ingresso;
- validação na portaria;
- cancelamento e reembolso.

## 5. Estados de evento e vendas

Não use `status === PUBLISHED` isoladamente como sinônimo absoluto de “pode vender”.

O estado comercial depende também de tempo e contexto.

Regras atuais/importantes:
- evento não publicado não vende;
- evento com `endsAt <= agora` não aceita nova reserva;
- publicação e republicação devem recusar evento já encerrado;
- evento cancelado não vende;
- evento pausado não vende;
- catálogo público deve priorizar eventos futuros/ativos;
- um evento encerrado pode continuar com URL histórica, mas sem CTA de compra.

Ao criar novos estados ou labels públicos, centralize a regra para evitar divergência entre home, página do evento, checkout e painel.

## 6. Cadastro e qualidade dos dados

### Local

- UF deve ser uma sigla brasileira válida.
- Cidade, endereço e nome do local devem ser normalizados.
- Evite aceitar dados que gerem combinações incoerentes como “Uberlândia/MA”.
- `mapsUrl` deve ser URL válida.

### Datas

- `endsAt` precisa ser posterior a `startsAt`.
- Toda regra temporal precisa considerar o timezone do evento.
- Nunca assuma timezone do navegador para decisão de negócio no backend.

### Conteúdo de teste

Dados de homologação/teste não devem aparecer no catálogo público, sitemap, SEO ou vitrines.

A solução preferida é separar ambientes/organizações de homologação. Não dependa somente do nome do evento conter “teste”.

## 7. Home pública

Arquivo principal: `apps/checkout/app/HomeClient.tsx`.

Princípios:
- mostrar somente conteúdo real;
- “Em alta” só com evidência real de vendas/procura;
- não inventar urgência;
- não criar hero forte para um evento fraco apenas porque é o primeiro da lista;
- quando não houver destaque real, usar hero institucional;
- não renderizar prateleiras vazias;
- cidade escolhida deve continuar persistida;
- favoritos devem continuar funcionando;
- busca e filtros não podem destruir a experiência de descoberta.

Antes de alterar a home, teste:
- zero eventos;
- um evento;
- vários eventos sem vendas;
- vários eventos com vendas;
- cidade filtrada;
- categoria filtrada;
- busca;
- mobile e desktop.

## 8. Página pública do evento

Arquivo central: `apps/checkout/app/[slug]/EventPageClient.tsx`.

Deve comunicar:
- nome;
- produtor/casa;
- data e hora;
- local;
- status real das vendas;
- preço/lotes;
- taxas;
- atrações;
- itens inclusos;
- classificação etária;
- políticas relevantes;
- como o ingresso chega;
- como funciona o QR;
- como funciona a entrada;
- mapa quando disponível.

Não escreva sobre o flyer quando o próprio flyer já contém a informação visual. O projeto já adota o princípio de manter a arte limpa.

## 9. Reservas e estoque

Regra de ouro: reservar estoque é operação de backend.

Em `apps/api/src/reservations/`:
- confirme que o evento pode vender;
- valide que os lotes pertencem ao evento;
- rejeite lote `pdvOnly` no online;
- valide meia-entrada quando aplicável;
- agregue quantidade por lote antes de aplicar limite;
- preserve atomicidade/transação;
- preserve expiração da reserva.

Toda alteração aqui exige testes de concorrência e estoque.

## 10. Pagamentos

Cuidados obrigatórios:
- idempotência;
- webhook duplicado;
- Pix expirado;
- pagamento aprovado sem ingresso;
- ingresso emitido sem pedido válido;
- reembolso parcial;
- reembolso total;
- diferenças entre online e PDV.

Nunca vincule lógica financeira apenas a mensagens ou estados visuais.

## 11. PDV de porta

O PDV é uma operação diferente da venda online.

Regras já adotadas:
- Pix e dinheiro;
- venda feita no evento;
- entrada imediata;
- idempotência separada por método;
- lote exclusivo de balcão não entra no site público;
- dinheiro pode ter tratamento de taxa diferente;
- venda de porta pode ter regras próprias de reembolso.

Ao alterar PDV, valide fechamento, operador, horário e duplicidade.

## 12. Portaria e check-in

A portaria precisa funcionar sob condições ruins de conectividade.

Fluxos relevantes:
- QR;
- nome;
- CPF;
- código;
- lista;
- ingresso;
- uso duplicado;
- cancelado;
- evento errado;
- fila offline;
- sincronização posterior;
- reversão auditada.

Nunca transforme falha de rede em “ingresso inválido”.

## 13. Promoters e listas

São diferenciais importantes do produto.

Métricas não devem misturar:
- vendas;
- convidados cadastrados;
- convidados que realmente entraram;
- ingressos vendidos e posteriormente validados.

Ao mexer em relatórios, mantenha “cadastrado” e “compareceu” como conceitos distintos.

## 14. VIP

VIP/reservas têm inventário e pagamento próprios.

Antes de expandir:
- preserve concorrência de inventário;
- sinal/saldo;
- reserva pública;
- status;
- cancelamento;
- vínculo com evento;
- testes já existentes.

## 15. Financeiro e ledger

Todo dinheiro deve ser rastreável.

Idealmente:
`evento → pedido → pagamento → ingresso → ledger → repasse`

Mudanças financeiras precisam considerar:
- bruto;
- taxa;
- líquido;
- Pix;
- dinheiro;
- reembolso;
- taxa devolvida;
- saldo;
- repasse.

Não faça cálculo financeiro duplicado em várias telas. Prefira fonte canônica no backend.

## 16. Autorização

O BoraFest é multi-organização.

Antes de qualquer `find/update/delete` sensível, confirme organização/permissão.

Cuidados:
- IDOR entre organizações;
- venue de outra organização;
- evento de outra organização;
- acesso a financeiro;
- token/segredo retornado ao frontend;
- papéis de portaria/vendedor não devem receber campos sensíveis.

## 17. Dados sensíveis

Evite logar:
- CPF completo;
- tokens;
- credenciais;
- chaves;
- segredos de gateway;
- Meta CAPI token;
- dados pessoais desnecessários.

Campos secretos não devem ser devolvidos ao painel só porque existem no model.

## 18. Imagens e uploads

Uploads devem:
- validar conteúdo real, não confiar só em MIME declarado;
- limitar tamanho e pixels;
- normalizar/comprimir;
- evitar apagar arquivo que pertence a outra entidade/organização;
- usar nomes controlados pelo servidor.

## 19. Frontend e design

Princípios:
- mobile primeiro sem abandonar desktop;
- CTA primário claro;
- não duplicar informação do flyer;
- estados vazios úteis;
- mensagens de erro específicas;
- sem urgência falsa;
- sem prova social inventada;
- componentes reutilizáveis para cards, confiança, estados e navegação.

## 20. SEO público

Para páginas públicas:
- metadata correta;
- canonical;
- Open Graph;
- JSON-LD de evento quando aplicável;
- evento encerrado não deve fingir venda ativa;
- conteúdo de teste não pode ser indexado;
- filtros infinitos não devem criar páginas indexáveis sem necessidade.

## 21. Observabilidade

Fluxos que merecem métrica/alerta:
- criação de reserva;
- falha de reserva;
- pagamento;
- webhook;
- emissão;
- fila;
- envio de ingresso;
- check-in;
- sincronização offline;
- duplicidade;
- reembolso;
- worker parado.

Prioridade alta: detectar “pagamento aprovado sem ingresso”.

## 22. Como fazer uma alteração com segurança

1. Identifique o fluxo afetado.
2. Procure regra equivalente no backend e frontend.
3. Veja se há contrato compartilhado.
4. Veja se existe teste.
5. Faça a regra no backend primeiro quando for regra crítica.
6. Ajuste a UI para refletir o mesmo estado.
7. Teste estados de sucesso e erro.
8. Teste mobile e desktop se houver UI pública.
9. Atualize documentação.
10. Abra PR com motivação e critérios de aceite.

## 23. Checklist mínimo de PR

- [ ] regra de negócio protegida no servidor quando necessário;
- [ ] nenhuma informação sensível nova na resposta da API;
- [ ] validação de input revisada;
- [ ] estados de erro tratados;
- [ ] loading/empty state revisado;
- [ ] mobile revisado;
- [ ] desktop revisado;
- [ ] lint/typecheck;
- [ ] testes unitários relevantes;
- [ ] testes de integração relevantes;
- [ ] build;
- [ ] migrations revisadas, se houver;
- [ ] documentação atualizada;
- [ ] smoke test após deploy.

## 24. Definition of Done

Uma mudança só está concluída quando:
- código está implementado;
- regras críticas existem no backend;
- UI representa o estado correto;
- testes relevantes passam;
- build passa;
- documentação explica a mudança;
- deploy foi validado;
- o fluxo crítico relacionado foi testado ponta a ponta.

## 25. Documentos que devem ser consultados

- `docs/projeto/REGISTRO-MELHORIAS-2026-09-17.md` — registro detalhado da rodada de produção/vitrine iniciada em 17/09/2026.
- `docs/projeto/API-REFERENCE.md` — referência de API.
- `docs/projeto/DEPLOY.md` — instruções de deploy.
- `docs/projeto/COMO-RODAR.md` — execução local.
- `docs/projeto/FLUXO-FINANCEIRO.md` — conceitos e fluxo financeiro.
- auditorias em `docs/projeto/AUDITORIA*.md` — histórico de riscos e decisões.

## 26. Regra de documentação daqui para frente

Toda mudança relevante deve responder cinco perguntas no PR ou no registro da sprint:

1. O que mudou?
2. Por que mudou?
3. Onde mudou?
4. Como validar?
5. O que ainda falta?

Se uma decisão alterar regra de negócio importante, registrar também o motivo para que uma pessoa futura não “simplifique” e reintroduza um bug antigo.

## 27. Estado da rodada 17/09/2026

A branch `feat/producao-vitrine-publica` trabalha na frente “Confiança de Produção + Vitrine Pública”.

Já cobre:
- bloqueio de reserva depois do fim;
- UI de vendas encerradas;
- validação de UF;
- validação de datas;
- landing para produtores;
- sinais de confiança na home/evento;
- documentação da rodada.

Concluído nesta rodada:
- impedir publicação/republicação vencida;
- hero institucional de fallback;
- busca pública ampliada na primeira etapa;
- FAQ/políticas.

Ainda pendente:
- separar homologação/testes;
- ampliar busca via API para produtor/Casa/atrações;
- CI;
- smoke test de produção.

Atualize este bloco quando o estado mudar.


## 28. Decisões adicionadas em 18/09/2026

### Hero público
Um evento futuro não é automaticamente um destaque. A home usa `sections.highlights` como fonte de destaque comercial. Sem evidência real, renderiza comunicação institucional.

### Busca
A etapa client-side atual cobre apenas os campos de `EventListItem`: título, venue, cidade, UF e categoria. Não anuncie essa busca como pesquisa global por line-up ou produtor até o endpoint suportar esses dados.

### Datas em PATCH
Ao editar apenas `startsAt` ou apenas `endsAt`, compare o novo valor com a contraparte persistida no banco antes do update.

### Publicar/republicar
Mesmo que a tela desabilite um botão, `publish()` e `republish()` precisam validar `endsAt` no servidor.

### Políticas na página de evento
A UI pode explicar funcionamento técnico comprovado e apontar para documentos legais. Evite inventar regras específicas de reembolso, meia-entrada ou responsabilidade fora dos documentos oficiais e do modelo do evento.


## 29. Homologação e catálogo público

A estratégia atual de isolamento está documentada em:

`docs/projeto/HOMOLOGACAO-CATALOGO-E-BUSCA.md`

Resumo:
- não inferir teste pelo título;
- usar `PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS`;
- aplicar exclusão em lista, home, cidades, detalhe e disponibilidade;
- manter operação autenticada da organização funcionando;
- ao criar nova organização de homologação, atualizar também a configuração do ambiente público.

## 30. Busca pública no backend

A busca pública usa `GET /v1/public/events?q=...`.

Campos de descoberta atuais:
- evento;
- line-up;
- local;
- cidade;
- organização/Casa;
- nome comercial.

Ao expandir a busca:
- não indexar dados pessoais;
- preservar paginação;
- incluir parâmetros no cache;
- adicionar testes para qualquer novo campo;
- não anunciar fuzzy/autocomplete enquanto isso não existir tecnicamente.


## 31. Como interpretar falha de CI

Não trate toda conclusão `failure` do GitHub Actions como regressão de código.

Verifique:
1. o runner foi atribuído?;
2. existem steps no job?;
3. qual foi a primeira etapa que falhou?;
4. build/test realmente chegaram a executar?

Se o job encerrar com `runner_id = 0` e `steps = []`, nenhum comando do repositório rodou. Registre como falha de infraestrutura/provisionamento e mantenha a validação como pendente.


## 32. Pré-publicação no painel

Consulte `docs/projeto/PRE-PUBLICACAO-E-PAGINA-PUBLICA.md`.

Princípios:
- regra crítica deve existir no backend;
- UI pode antecipar o erro;
- recomendações não viram bloqueio sem decisão de produto;
- lote `pdvOnly` não conta como ingresso online;
- checklist deve explicar claramente o que falta e por quê.

## 33. Layouts dinâmicos no checkout

Antes de adicionar conteúdo a `app/[slug]/layout.tsx`, revise todas as rotas filhas.

Hoje existem, entre outras:
- página principal do evento;
- `/[slug]/ingressos`;
- `/[slug]/vip`.

Conteúdo exclusivo do hotsite deve ser renderizado pela página/componente do hotsite, não por um layout compartilhado.


## 34. Inventário oficial

Antes de propor uma feature nova, consulte:

`docs/projeto/INVENTARIO-FEATURES-E-LACUNAS.md`

Especialmente não duplicar CRM, fidelidade, financeiro, promoters, VIP, check-in, add-ons ou Casa pública.

## 35. Auditoria segura de catálogo

Para inspecionar dados antes de limpeza:

`pnpm --filter @borafest/database auditoria-catalogo`

O comando deve permanecer somente leitura. Correções destrutivas ou atualizações em massa devem ser revisadas separadamente e nunca misturadas ao relatório.


## 36. Loja da Casa e Ticket Studio

Consulte:
`docs/projeto/LOJA-E-TICKET-STUDIO.md`

### Loja
- `EventAddOn` continua sendo adicional de evento;
- produto permanente usa `StoreProduct/StoreProductVariant`;
- não usar evento oculto para venda da loja;
- estoque total nunca pode ser menor que vendido + reservado;
- publicação do produto exige variação ativa;
- lookup público por slug deve combinar igualdade + exclusão de homologação sem sobrescrever a igualdade.

### Ticket Studio
- tema é exclusivamente visual;
- QR, código, assinatura, status e validade são autoridade do backend;
- QR e código nunca podem ficar opcionais;
- reset de JSON opcional usa DB NULL;
- PNG/PDF/Wallet não devem ser anunciados até existirem de fato.

### Imagens
- não abrir `remotePatterns: **` no Next para acomodar produto externo;
- imagem externa da Loja não deve transformar `/_next/image` em proxy arbitrário;
- preferir upload gerenciado pela plataforma quando a mídia da Loja evoluir.


## 37. Mídia visual e privacidade da carteira

A rota de carteira usa `/pedido/{publicToken}`. Não carregar imagem arbitrária de terceiro nessa tela.

Ticket Studio:
- validar HTTPS;
- validar host BoraFest no backend;
- preferir banner/logo já gerenciados;
- nunca abrir `next/image` para hostname `**` como atalho.

Loja pública:
- imagem externa pode ser exibida diretamente no navegador com `no-referrer`;
- não usar o servidor Next como proxy universal;
- HTTP externo deve ser recusado para evitar mixed content.

Erros de unicidade de SKU/nome devem ser traduzidos para mensagem de negócio, não expor erro Prisma.


## 36. Regra de migration incremental

Migration compartilhada não deve ser reescrita para adicionar uma nova invariável.

Se a regra mudou:
1. preservar o SQL antigo;
2. criar nova migration;
3. cobrir a nova regra com teste;
4. documentar o motivo.

A Loja usa esse padrão para a constraint:
`stock_total >= reserved_count + sold_count`.

## 37. Ticket Studio deve ser consistente

Toda superfície que renderiza o ingresso deve respeitar o mesmo `ticketTheme`.

Hoje isso vale para:
- carteira pelo pedido;
- carteira logada em `/perfil`.

QR, código e status continuam obrigatórios e nunca são escondidos pelo tema.


## 38. Lotes: janela, esgotamento e acesso exclusivo

Regras obrigatórias no backend:
- reserva só aceita lote `ACTIVE`;
- `startsAt` futuro bloqueia reserva;
- `endsAt` vencido bloqueia reserva;
- `pdvOnly` nunca entra na reserva pública;
- `promoterOnly` exige promoter ou vendedor válido da mesma Casa/evento;
- a conversão da reserva em pedido repete a exigência de atribuição para lote `promoterOnly`.

O catálogo pode mostrar `SOLD_OUT` para informar “Esgotado”, mas reserva continua aceitando apenas `ACTIVE`.

Última venda que ocupa a capacidade marca o lote `SOLD_OUT`. Reembolso que devolve unidade reabre somente lote auto-esgotado; `CLOSED` manual não reabre automaticamente.

Comportamentos que não podem voltar:
- usar `startsAt/endsAt` só como texto/contagem regressiva;
- aceitar UUID de lote exclusivo sem prova de promoter;
- permitir reservar lote exclusivo e retirar a atribuição na criação do pedido;
- esconder o lote depois de esgotar e perder o estado “Esgotado”.

## 39. Reembolso e estoque

Reembolsos parciais acumulados que atingem 100% do ingresso são equivalentes a reembolso total para estoque:
- pedido -> `REFUNDED`;
- pagamento -> `REFUNDED`;
- ingresso revogado/refundado;
- `sold_count` precisa voltar.

A regra é coberta em `refund-async-accounting.test.ts`.

## 40. Loja: invariantes adicionais

- produto `ACTIVE` sempre mantém pelo menos uma variação ativa;
- banco garante `stock_total >= sold_count + reserved_count`;
- concorrência de criação/rename não deve transformar colisão de slug em erro 500;
- slug amigável é conveniência; a constraint do banco continua autoridade.


## 41. Atribuição de promoter é congelada na reserva

Quando a reserva nasce com `promoterSlug` ou `sellerSlug` válido:
- a API resolve os IDs reais;
- grava `promoterLinkId` / `promoterSellerId` em `Reservation`;
- o pedido herda esse vínculo;
- slugs/códigos enviados depois não podem trocar a atribuição;
- se o vínculo congelado deixar de estar ativo antes da conversão, o pedido falha e a reserva deve ser refeita.

Motivo: lote `promoterOnly` não pode ser usado para abrir acesso com A e redirecionar comissão para B depois.

Migration:
`20260923102000_reservation_promoter_attribution`.

## 42. Preço do comprador

A reserva expõe `buyerTotalCents` calculado no backend.

Esse valor:
- respeita `feeMode=PRODUCER`;
- evita somar taxa absorvida pela Casa;
- é usado pelo app mobile e como fallback no checkout web enquanto o catálogo carrega;
- deve bater com o `order.totalCents` antes de cupom/add-ons/proteção adicionais.

Não recalcular preço financeiro crítico apenas pela UI quando a API já possui a regra autoritativa.

## 43. Preview do produtor

A prévia diferencia:
- lotes públicos disponíveis agora;
- lotes exclusivos por promoter;
- PDV;
- janela temporal do lote.

Nunca rotular `promoterOnly` como “público” para todos.


## 44. Checkout falha fechado sem metadados do lote

O checkout usa `buyerTotalCents` para manter o preço correto mesmo antes do catálogo carregar.

Porém, metadados como:
- nominal;
- CPF obrigatório;
- `feeMode`;
- add-ons do evento;

não podem ser inventados.

Se o catálogo não carregar ou não contiver todos os lotes da reserva:
- preço base continua vindo da reserva;
- criação do pedido é bloqueada;
- o usuário recebe instrução para atualizar a página.

Comportamento proibido: seguir para pagamento assumindo que lote desconhecido não é nominal ou que a taxa é do comprador.


## 45. Transferência: corrida, reembolso e revogação de QR

### Troca de titular é atômica

A transferência usa compare-and-swap em `ownerUserId`.

Se duas transferências do mesmo ingresso acontecerem ao mesmo tempo:
- apenas uma altera o titular;
- a perdedora falha;
- auditoria e notificação são gravadas só pela vencedora.

### Reembolso self-service com ingresso transferido

O comprador não pode usar:
- pedido de reembolso self-service;
- proteção de reembolso self-service;

enquanto houver ingresso ativo do pedido em posse de outra conta.

Motivo: o comprador original não pode transferir o ingresso e depois revogá-lo da carteira do presenteado por uma ação self-service.

Reembolso administrativo/cancelamento operacional continua separado e pode atingir o pedido inteiro quando a operação realmente exige.

### QR antigo após transferência

Reassinar o QR não basta: a assinatura antiga continua matematicamente válida.

Regras atuais:
- check-in online compara o token escaneado com `Ticket.qrToken` atual;
- manifesto offline leva apenas `SHA-256(qrToken)`, nunca o token bruto;
- app compara o hash antes de aceitar offline;
- fila offline envia o hash do QR efetivamente escaneado;
- no sync, o servidor compara esse hash com o QR atual antes de confirmar.

Assim, QR antigo/reemitido vira `INVALID`.

Limitação de compatibilidade: versões antigas do app que não enviam `qrHash` continuam aceitas durante rollout. Após atualizar os dispositivos de portaria, essa lacuna deixa de existir no fluxo novo.


## 46. Transferência revoga todas as credenciais antigas do ingresso

Ao transferir um ingresso:
- `ownerUserId` muda atomicamente;
- `qrToken` é reassinado;
- `code` curto também é regenerado;
- audit log registra código anterior e novo;
- notificação ao novo titular usa o código novo.

Motivo: o código curto também é uma credencial de entrada. Revogar apenas o QR deixaria o antigo titular capaz de tentar entrar pela busca/manual da portaria.

Teste de regressão:
`ticket-transfer.test.ts` confirma que QR antigo e código antigo retornam inválido após a transferência.
