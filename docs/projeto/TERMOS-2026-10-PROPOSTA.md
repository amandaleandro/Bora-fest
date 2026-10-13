# Termos de Uso e Política de Privacidade — proposta v2026-10

> **Status: PROPOSTA, não publicada.** Publicar depende da revisão do advogado (decisão do Arthur). Até lá o site
> continua com a v2026-07 em `apps/checkout/app/legal/page.tsx`, que **não foi alterado**.
>
> **Base:** código em `c22a7f0` mais as frentes da rodada de 12/10 (telas finais aprovadas no protótipo). Cada
> afirmação do texto foi conferida no código; o anexo no fim liga cada uma ao arquivo que a sustenta.
>
> **Escrito em:** 12/10/2026, a partir do item "Termos e Política de Privacidade são um rascunho de julho que
> promete o que o sistema não faz" do levantamento de pendências.

## Como usar este documento

1. O advogado lê as **Partes 1 e 2** (o texto exato que vai ao ar) e a **Parte 4** (o que ele precisa conferir).
2. O Arthur preenche os 4 campos entre colchetes (`[RAZÃO SOCIAL]`, `[CNPJ]`, `[ENDEREÇO]`, `[NOME DO ENCARREGADO]`)
   e decide os itens da **Parte 5**.
3. Antes de publicar, tudo da **Parte 6** precisa estar verdadeiro em produção. Se algum item não estiver, a frase
   correspondente sai do texto (a Parte 6 diz qual).
4. Publicar é colar o bloco da **Parte 7** em `apps/checkout/app/legal/page.tsx` e trocar a versão também no
   checkout e no perfil (Parte 6).

O texto foi escrito para quem compra ingresso: frases curtas, sem juridiquês e sem prometer o que o sistema não
faz. Onde a regra depende de uma pessoa (por exemplo, a análise de um reembolso), o texto diz isso.

---

## Parte 1 — Política de Privacidade (texto proposto, v2026-10)

### 1. Quem cuida dos seus dados

A BoraFest ([RAZÃO SOCIAL], CNPJ [CNPJ], [ENDEREÇO]) é a controladora dos dados de quem usa o site borafest.com.br, o painel do produtor e a portaria. O produtor do evento (a Casa) recebe os dados de quem compra para os eventos dele e também responde pelo uso que faz deles. Encarregado de dados: [NOME DO ENCARREGADO], pelo e-mail privacidade@borafest.com.br.

### 2. O que coletamos na compra

Nome, e-mail e CPF (obrigatórios na compra pelo site) e celular (opcional). Em ingresso nominal, o nome de cada participante e, quando o evento exige, o CPF dele. Do pedido, guardamos evento, ingressos, valores, forma de pagamento, cupom, itens adicionais, se houve proteção de reembolso e, se você chegou pelo link ou pelo código de um promoter, quem indicou. No cartão, número, validade, código de segurança, CPF do titular, CEP e número do endereço passam pelo nosso servidor só para chegar ao processador de pagamento, junto com o endereço IP da compra; não guardamos esses dados do cartão.

### 3. Por que pedimos o CPF

Para emitir o pagamento: o processador pode exigir o CPF de quem paga. Para identificar você na entrada: o ingresso sai no seu nome e CPF, e a equipe da porta pode encontrá-lo pelo CPF. Para garantir o limite por pessoa: em lote com limite de ingressos por CPF, o CPF fica guardado no pedido. Para transferências: só recebe ingresso pelo CPF uma conta com CPF e e-mail confirmado. O CPF também fica na sua conta (definido uma vez; para trocar, fale com o suporte) e no registro do pagamento. Não enviamos CPF a parceiros de anúncio, e o link do pedido não mostra o CPF.

### 4. Meia-entrada, porta, lista e convite

Meia-entrada: não pedimos nem guardamos o seu documento; ele é conferido na entrada pela equipe do evento. O ingresso fica marcado como meia, e o produtor recebe o relatório dos ingressos de meia (com o nome do participante) que a lei pede. Compra na porta: nome e e-mail são opcionais, e o CPF só é pedido quando o processador do Pix exige. Lista de convidados: quem coloca você na lista (o produtor ou um promoter) informa seu nome e, se o evento pedir, CPF e celular. Convite por e-mail: o produtor nos passa o seu e-mail para mandarmos o link pessoal.

### 5. Como usamos

Para emitir e entregar seus ingressos, criar e manter sua conta, mostrar seus pedidos, conferir sua entrada, processar pagamentos, reembolsos, cancelamentos e transferências, aplicar limites por pessoa, prevenir fraude, somar pontos quando a Casa tem programa de fidelidade, cumprir obrigações legais (fiscais, de consumo e o relatório de meia-entrada) e falar com você sobre seus pedidos. Não usamos WhatsApp nem SMS para falar com você.

### 6. Base legal

Execução do contrato da compra: emitir, entregar, validar, reembolsar e transferir ingressos. Cumprimento de obrigação legal ou regulatória: registros fiscais e de consumo e relatório de meia-entrada. Legítimo interesse: prevenção a fraude, segurança, programa de fidelidade da Casa e medição das campanhas do produtor. Consentimento: ofertas e campanhas por e-mail, que você liga e desliga no perfil.

### 7. O que o produtor vê

O produtor do evento e as pessoas da equipe dele com permissão financeira veem os pedidos dos eventos da Casa: nome, e-mail, celular, ingressos, valores, se você já entrou, quanto gastou na Casa, se você a segue, por qual promoter comprou e marcações como “cliente frequente” ou “não compareceu”. Também baixam planilhas de pedidos, participantes e meia-entrada e, se a Casa tem fidelidade, veem seus pontos e resgates. A equipe da porta vê nome e tipo de ingresso; o CPF não aparece na tela, porque a busca por CPF compara um código embaralhado. Promoters veem só os convidados que eles mesmos puseram na lista. O produtor só pode usar esses dados para o evento e para as comunicações que você aceitou.

### 8. Prestadores de serviço

Mercado Pago e Asaas processam os pagamentos e recebem o necessário para cobrar: nome, CPF e, conforme o meio de pagamento, e-mail, celular, dados do cartão e o endereço IP da compra. A Resend envia nossos e-mails: recebe seu e-mail e o conteúdo da mensagem e nos avisa se ela foi entregue, voltou ou foi marcada como spam. Nossos servidores ficam em um provedor contratado na Europa. Esses prestadores tratam os dados para a BoraFest; parte deles fica fora do Brasil, o que é uma transferência internacional de dados.

### 9. Parceiros de anúncio (pixel e API de Conversões)

Quando o produtor ativa no evento o pixel da Meta, do Google (GA4) ou do TikTok, as páginas do evento, do checkout e do pedido carregam o código desse parceiro, que registra a visita, o início da compra e a compra com o valor, e pode usar cookies e dados do seu navegador conforme a política dele. Se o produtor ativar também a API de Conversões da Meta, nosso servidor envia à Meta o início da compra (ao criar o pedido) e a compra (ao pagar), com o valor e com seu nome, e-mail e telefone embaralhados (hash SHA-256). Não enviamos CPF. Pedidos grátis não são enviados como compra. Só a Meta recebe esse envio do servidor; Google e TikTok recebem apenas o que o pixel registra no navegador.

### 10. Comunicações

Avisos do seu pedido (ingresso, código de acesso, transferência e cancelamento) chegam sempre por e-mail. Se você começar uma compra e não pagar, mandamos até dois lembretes. Se você seguir uma Casa, recebe um e-mail quando ela publicar um evento; para parar, deixe de seguir. Campanhas de uma Casa onde você já comprou só chegam se “Ofertas por e-mail” estiver ligado no seu perfil; desligue a mesma opção para parar de receber de todas as Casas.

### 11. Por quanto tempo guardamos

Sua conta fica guardada enquanto existir. Pedidos, ingressos, pagamentos, entradas, o registro do aceite destes termos e a trilha de auditoria continuam guardados depois do evento, porque provam a compra e servem para reembolsos, contestações e obrigações fiscais e de consumo. Hoje esses registros não são apagados automaticamente depois de um prazo. As cópias de segurança do banco de dados são substituídas em até 30 dias.

### 12. Exclusão de conta

Você pede em Perfil → “Excluir minha conta”. Na hora, apagamos da conta o nome, o e-mail, o celular, o CPF e a senha, encerramos todas as sessões e tiramos o CPF dos pedidos feitos com essa conta (e dos feitos sem login com o mesmo e-mail). Continuam guardados, pelos motivos do item anterior: nos pedidos, o nome, o e-mail e o celular informados na compra; nos ingressos, o nome, o e-mail e o CPF de quem usa; no pagamento, o CPF de quem pagou; os pontos de fidelidade (ligados ao e-mail) e o aceite dos termos. Ingressos já emitidos continuam valendo pelo QR que você recebeu por e-mail, mas deixam de aparecer no site. Para pedir a exclusão do restante, escreva para privacidade@borafest.com.br.

### 13. Seus direitos (LGPD, Lei 13.709/2018)

Você pode confirmar se tratamos seus dados e acessá-los, corrigi-los, pedir portabilidade, anonimização, bloqueio ou eliminação do que for desnecessário, saber com quem compartilhamos, retirar o consentimento e pedir revisão de decisões automatizadas. No perfil, “Baixar meus dados” entrega seu cadastro, seus pedidos e seus ingressos; o nome você corrige ali; e “Ofertas por e-mail” liga e desliga as campanhas. Para o restante (CPF, e-mail, celular, pontos, histórico de mensagens), escreva para privacidade@borafest.com.br; respondemos em até 15 dias. Você também pode reclamar à ANPD (gov.br/anpd).

### 14. Segurança

Site, painel e API usam conexão cifrada (HTTPS). Você entra com um código enviado ao seu e-mail, sem senha, e excluir a conta derruba todas as sessões abertas. No painel do produtor, cada pessoa tem um papel, e as listas com dados de compradores exigem permissão financeira. Na equipe da BoraFest, as ações que movem dinheiro exigem segundo fator (app autenticador). O QR de cada ingresso é assinado digitalmente, e a chave que o assina fica guardada cifrada. Estornos, cancelamentos, transferências, exclusões de conta, mudanças em eventos e lotes e entradas liberadas sem conferir o CPF ficam registrados numa trilha de auditoria. Se um incidente puder causar risco ou dano relevante a você, avisaremos você e a ANPD.

### 15. Cookies e dados no navegador

O site guarda no seu navegador (armazenamento local, não cookies) a sua sessão, o link de promoter pelo qual você chegou (por 7 dias, para a comissão ir a quem indicou), favoritos, a cidade escolhida e o e-mail digitado no checkout. A BoraFest não usa cookies de publicidade próprios; os pixels de parceiros, quando o produtor os ativa, podem gravar cookies deles. Você apaga tudo isso nas configurações do navegador.

### 16. Dados de outras pessoas

Ao informar o nome e o CPF de participantes, ou ao transferir um ingresso, você confirma que essas pessoas sabem disso e que você pode nos passar os dados delas. Esses dados são usados para emitir, transferir e validar o ingresso e aparecem para o produtor do evento como os seus.

### 17. Produtores, equipes e promoters

Para usar o painel, guardamos nome, e-mail e senha (e celular, se informado); da organização, o CPF ou CNPJ, os dados bancários e a chave Pix do repasse; do promoter, as vendas e comissões. Usamos esses dados para dar acesso, pagar repasses e comissões, prevenir fraude e cumprir obrigações fiscais. As ações feitas no painel ficam na trilha de auditoria.

### 18. Mudanças nesta política

A versão que você aceitou fica registrada em cada pedido. Quando esta política mudar, a nova versão aparece aqui, com outro número, e passa a valer para as compras feitas depois dela.

---

## Parte 2 — Termos de Uso (texto proposto, v2026-10)

### 1. O que é a BoraFest

A BoraFest é uma plataforma que vende ingressos em nome dos produtores de eventos (as Casas). O produtor, identificado na página do evento, é quem organiza e realiza o evento: data, local, atrações, segurança, acessibilidade, idade mínima e regras de entrada. A BoraFest cuida da venda, do pagamento, da emissão, da transferência e da validação dos ingressos. Ao comprar, você aceita estes termos e a Política de Privacidade.

### 2. Sua conta

A conta nasce na sua primeira compra, com os dados dela, ou na primeira vez que você entra. Você entra com um código enviado ao seu e-mail, sem senha. Para ver o primeiro ingresso, confirme o e-mail pelo link que mandamos. Use dados verdadeiros e um e-mail que seja seu: é para ele que vão o ingresso e os avisos. O CPF fica na conta depois de definido; para trocá-lo, fale com o suporte.

### 3. Compra e pagamento

Os ingressos escolhidos ficam reservados por 10 minutos enquanto você preenche os dados; criado o pedido, você tem 30 minutos para pagar. Sem pagamento nesse prazo, o pedido expira e os ingressos voltam à venda. O pagamento é por Pix ou cartão de crédito (parcelado sem juros, quando oferecido), processado pelo Mercado Pago ou pela Asaas. O ingresso é emitido quando o pagamento é confirmado. Cada lote tem um limite de ingressos por pedido.

### 4. Taxa de serviço e valores

Cada ingresso mostra o preço e a taxa de serviço da BoraFest antes de você escolher; em alguns eventos o produtor paga a taxa por você, e isso aparece na escolha do ingresso. O total do pedido aparece antes do pagamento. Itens adicionais (como copo ou camiseta) e a proteção de reembolso são opcionais e aparecem separados no resumo; os itens são entregues pelo produtor no evento. Ingresso grátis não tem taxa. Na meia-entrada, o preço do ingresso cai pela metade e a taxa de serviço é cobrada inteira.

### 5. Desistência e reembolso (CDC, art. 49)

Na compra pela internet, você pode desistir em até 7 dias da compra. Peça em “Minhas compras” → “Solicitar reembolso”, dizendo o motivo. O pedido é analisado por quem cuida do repasse do evento (o produtor ou a BoraFest) e, aprovado, o valor pago volta pelo mesmo meio de pagamento e os ingressos do pedido deixam de valer. Depois dos 7 dias, você ainda pode pedir, mas a aprovação depende da análise. Ingresso grátis e compra na porta não têm reembolso pela plataforma.

### 6. Proteção de reembolso

Opcional, R$ 1,50 por pedido, oferecida no checkout de ingressos pagos. Com ela, você mesmo pede o reembolso na página do pedido (“Pedir reembolso do ingresso”) até o início do evento, sem análise e por qualquer motivo: devolvemos tudo o que você pagou, menos os R$ 1,50 da proteção, e os ingressos do pedido deixam de valer na hora. Só quem fez a compra, entrando na própria conta, pode pedir. Se o evento for cancelado, você recebe tudo de volta, inclusive a proteção.

### 7. Cancelamento ou mudança do evento

Se o produtor cancelar o evento, você não precisa pedir: devolvemos tudo o que você pagou online (ingresso, taxa de serviço, itens adicionais e proteção) pelo mesmo meio de pagamento e avisamos por e-mail, com o motivo informado pelo produtor. No Pix o dinheiro costuma voltar em minutos; no cartão, o estorno aparece na fatura no prazo do seu banco. Ingressos grátis do evento cancelado deixam de valer, e você recebe um aviso. Se o produtor mudar a data, o horário ou o local, você pode pedir o reembolso em “Minhas compras”.

### 8. Compra na porta

Em alguns eventos a produção vende na porta, em dinheiro ou Pix. O ingresso é emitido na hora e a entrada já fica registrada. Compra na porta não tem reembolso pela BoraFest: qualquer acerto, inclusive se o evento for cancelado, é feito direto com a produção do evento.

### 9. Meia-entrada

Têm direito à meia-entrada, nos termos da Lei 12.933/2013 e do Decreto 8.537/2015, estudantes, pessoas com deficiência (e o acompanhante, quando necessário) e jovens de 15 a 29 anos de baixa renda; pessoas idosas têm o desconto pelo Estatuto da Pessoa Idosa. Quando o lote oferece meia, você marca a opção ao escolher o ingresso. O ingresso sai marcado como meia e, na entrada, a equipe pede o documento que comprova o direito; sem ele, a produção pode recusar a entrada com esse ingresso. A BoraFest não guarda o seu documento. A oferta e a cota de meia-entrada do evento são definidas pelo produtor.

### 10. Transferência

Ingresso pago pode ser transferido pela sua conta até o fim do evento, para quem já tem conta na BoraFest: pelo e-mail da pessoa ou pelo CPF de uma conta com e-mail confirmado. O ingresso passa para o nome e o CPF de quem recebe, ganha um QR novo e aparece na conta dessa pessoa, que recebe um aviso por e-mail. Em lote que exige CPF, a conta de quem recebe precisa ter CPF. Ingresso grátis, de cortesia ou de lista é pessoal e não pode ser transferido. Cada ingresso vale uma única entrada: receba ingresso só de quem você conhece e não repasse cópias do QR.

### 11. Ingresso grátis

Ingresso grátis não tem taxa nem reembolso, porque nada foi pago, e é pessoal e intransferível. Você pode liberar a vaga em “Minhas compras” → “Não vou mais” até o início do evento. O produtor também pode cancelar o ingresso enquanto ele não tiver sido usado. Nos dois casos o QR deixa de valer, a vaga volta para outra pessoa e você recebe um e-mail. Alguns ingressos só aparecem para quem tem o link de convite ou recebeu um convite pessoal por e-mail, e o convite por e-mail só vale com o mesmo e-mail que o recebeu.

### 12. Limite por pessoa

O produtor pode limitar quantos ingressos de um lote cada CPF leva, somando todos os pedidos, inclusive os que ainda aguardam pagamento. Nesses lotes o CPF é obrigatório e fica guardado no pedido. Pedido cancelado, expirado ou reembolsado deixa de contar no limite.

### 13. Entrada no evento

Mostre o QR do ingresso (no e-mail ou na página do pedido) na entrada. A equipe da produção lê o QR ou procura você pelo nome, pelo CPF ou pelo código do ingresso; a primeira leitura registra a entrada, e o mesmo ingresso não passa de novo. A idade mínima, quando houver, aparece na página do evento. As regras de entrada (idade, documento, revista, vestimenta) são do produtor e do local.

### 14. Fraude e segurança do ingresso

O QR de cada ingresso é assinado digitalmente: QR inventado, alterado ou de outro evento não passa. Mas uma cópia (print ou foto) de um QR verdadeiro passa uma vez, e quem chegar primeiro entra. Por isso, não divulgue seu QR e compre só pela BoraFest ou com o próprio produtor. Se o pagamento for contestado no cartão (chargeback) ou estornado, os ingressos do pedido deixam de valer. A BoraFest pode cancelar ingressos e pedidos com indício de fraude.

### 15. Fidelidade da Casa

Se a Casa tem programa de pontos, cada compra paga nela soma pontos pela regra que ela definiu, ligados ao e-mail do pedido; você vê o saldo em “Pontos e recompensas” depois de entrar. Os pontos valem só na Casa que os deu, são trocados pelas recompensas que ela oferece (com um código) e não valem dinheiro. Se a compra for reembolsada ou contestada, os pontos dela saem. A Casa pode pausar os resgates e mudar as recompensas; hoje os pontos não têm prazo de validade.

### 16. Comunicações da Casa

Avisos do pedido sempre chegam por e-mail. Se você seguir uma Casa, recebe um e-mail quando ela publicar um evento; para parar, deixe de seguir. Campanhas e convites das Casas onde você comprou só chegam se “Ofertas por e-mail” estiver ligado no seu perfil; desligue a mesma opção, a qualquer momento, para parar de receber.

### 17. Mesa e camarote (VIP)

Em alguns eventos você pode pedir reserva de mesa ou camarote. O pedido só vale depois que a Casa confirma; quando ela cobra sinal, o pagamento é por Pix. O cancelamento da reserva e a devolução do sinal são combinados com a Casa.

### 18. Avaliações

Depois do evento, quem fez pedido confirmado nele pode dar nota e comentário. A média aparece na página do evento; o comentário e o seu nome ficam guardados e podem ser exibidos. Não publique ofensas nem dados de outras pessoas.

### 19. Atendimento e mudanças nestes termos

Dúvidas sobre pedidos: suporte@borafest.com.br. Sobre dados pessoais: privacidade@borafest.com.br. A versão que você aceitou fica registrada em cada pedido; novas versões valem para as compras feitas depois delas. Valem as leis brasileiras, e você pode resolver qualquer disputa no foro da sua cidade.

---

## Parte 3 — O que mudou em relação à v2026-07 e por quê

### Política de Privacidade

| Tema | A v2026-07 dizia | A v2026-10 diz | Por quê |
|---|---|---|---|
| Quem é o controlador | Só o e-mail do encarregado no rodapé | Seção própria com razão social, CNPJ, endereço e nome do encarregado | A LGPD pede a identidade do controlador e do encarregado (arts. 9º e 41). Faltava. |
| O que coletamos | "CPF só quando o evento exigir (meia-entrada ou controle de acesso)" | Nome, e-mail e CPF obrigatórios na compra pelo site; celular opcional; participantes; dados do pedido; cartão só de passagem | O checkout exige CPF em **toda** compra. A meia-entrada não usa CPF. |
| Por que o CPF | Não falava | Pagamento, identificação na entrada, limite por pessoa e transferência, e onde o CPF fica guardado | O CPF fica na conta, no pedido (lote com limite), no ingresso e no registro do pagamento Pix. |
| Meia, porta, lista e convite | Não falava | Seção nova | Os quatro fluxos coletam dados e não eram citados. |
| Como usamos | "Enviar por e-mail/WhatsApp" | Só e-mail; "não usamos WhatsApp nem SMS" | O WhatsApp está desligado em produção (`WHATSAPP_PROVIDER=off`). |
| Base legal | Não tinha | Seção nova | LGPD, arts. 7º e 9º, II. |
| O que o produtor vê | "Lista de participantes" | Lista real: nome, e-mail, celular, gasto, presença, marcações, promoter, planilhas, pontos | O CRM da Casa mostra tudo isso a quem tem permissão financeira. |
| Prestadores | "Processador de pagamento e provedores de mensageria" | Mercado Pago, Asaas, Resend e servidor na Europa, com transferência internacional | LGPD, arts. 9º, V, e 33. |
| Pixel e API de Conversões | Não falava | Seção nova: Meta, Google e TikTok no navegador; só a Meta recebe do servidor nome, e-mail e telefone em hash; sem CPF; grátis fora | O envio existe desde agosto e não estava em lugar nenhum do texto. |
| Comunicações | "Marketing só com o seu opt-in explícito" | Avisos sempre; até 2 lembretes de compra; e-mail de quem você segue; campanhas só com "Ofertas por e-mail"; como parar | Lembretes de carrinho e aviso aos seguidores existem e não eram citados. |
| Retenção | Não falava | O que fica guardado, que hoje não há apagamento automático e que as cópias de segurança são trocadas em até 30 dias | Não há rotina de apagamento por prazo. |
| Exclusão de conta | "Remove seus dados pessoais em até 30 dias. Registros financeiros mantidos anonimizados" | O que é apagado na hora e o que continua guardado; ingressos seguem valendo | A exclusão é imediata, mas parcial: nome, e-mail e celular do pedido, nome e CPF do ingresso, CPF do pagamento e e-mail da fidelidade ficam. Não existe rotina de 30 dias. |
| Direitos | Lista curta | Lista do art. 18, o que o "Baixar meus dados" entrega, prazo de 15 dias e ANPD | A exportação só traz cadastro, pedidos e ingressos. |
| Segurança | "Criptografia em trânsito e em repouso, acesso restrito por função e trilha de auditoria em toda ação sensível" | Só o que existe: HTTPS, login por código, papéis, segundo fator na equipe, QR assinado com chave cifrada, auditoria nas ações listadas e aviso de incidente | Os dados pessoais (CPF inclusive) **não** são cifrados em repouso, e a auditoria não cobre "toda" ação sensível. |
| Cookies | Não falava | Seção nova | O site usa armazenamento local, e os pixels de terceiros gravam cookies. |
| Dados de terceiros | Não falava | Seção nova | Participantes nominais e transferências. |
| Produtores, equipe e promoters | Não falava | Seção nova | O painel guarda CPF/CNPJ, banco e chave Pix. |
| Mudanças | Não falava | A versão aceita fica em cada pedido | O aceite já é gravado por pedido (`consents`). |

### Termos de Uso

| Tema | A v2026-07 dizia | A v2026-10 diz | Por quê |
|---|---|---|---|
| O serviço | "Intermedia a venda... O evento é de responsabilidade do produtor" | Mantido, com o que é de cada um | — |
| Conta | Não falava | Conta nasce na compra, login por código e confirmação do e-mail antes do 1º ingresso | É o fluxo real desde agosto. |
| Compra e pagamento | Não falava | Reserva de 10 min, 30 min para pagar, Pix ou cartão, processadores e limite por pedido | Prazos reais do servidor. |
| Taxas | "Exibida desde a seleção do ingresso" | Mantido, mais: o produtor pode pagar a taxa, grátis não tem taxa, **taxa inteira na meia**, itens e proteção à parte | A meia corta só o preço; a taxa continua cheia. |
| Reembolso (CDC, art. 49) | "Podem ser canceladas em até 7 dias" | Pedido em "Minhas compras" com **análise** do produtor ou da BoraFest; depois de 7 dias depende da análise; grátis e porta sem reembolso | O servidor só registra o pedido; uma pessoa aprova ou recusa. Nada é automático. |
| Proteção de reembolso | Não falava | Seção nova | Existe desde agosto. |
| Cancelamento do evento | "Gera reembolso integral" | Integral no online, sem precisar pedir (com taxa, itens e proteção); porta acertada com a produção; grátis cancelado com aviso | A venda de porta não é estornada pela plataforma. |
| Compra na porta | Não falava | Seção nova | Decisão de 14/09: porta não tem reembolso. |
| Meia-entrada | "Documento conferido na portaria" | Ingresso marcado como meia, equipe pede o documento, BoraFest não guarda, cota do produtor | Até esta rodada a porta não sabia quem era meia; a etiqueta entra agora. |
| Transferência | "O QR anterior é invalidado na hora" | **Frase retirada.** Passa nome e CPF, QR novo, só ingresso pago, até o fim do evento, para conta existente | **Falso hoje**: o QR antigo e o código do ingresso continuam passando na porta depois da transferência (ver Parte 6). |
| Ingresso grátis | Não falava | Seção nova | "Não vou mais" e "Cancelar ingresso" do produtor. |
| Limite por pessoa | Não falava | Seção nova | Limite por CPF desde 10/10. |
| Entrada | Não falava | Seção nova | — |
| Fraude | "Cópias e prints não passam na validação" | **Corrigido:** a cópia de um QR verdadeiro passa uma vez; chargeback cancela; a BoraFest pode cancelar com indício de fraude | A porta confere a assinatura e se o ingresso já entrou. Um print de QR verdadeiro tem assinatura válida. |
| Fidelidade | Não falava | Seção nova | Programa de pontos existe desde 14/09. |
| Comunicações da Casa | Não falava | Seção nova, com como parar | — |
| Mesa e camarote | Não falava | Seção nova | Reserva VIP com sinal Pix existe desde 14/09. |
| Avaliações | Não falava | Seção nova | — |
| Atendimento e foro | Só o e-mail do encarregado | Suporte, privacidade, versões e foro do consumidor | — |

### Diferenças em relação ao texto do protótipo aprovado

O protótipo (aba "Termos e Privacidade") trazia 5 trechos e dizia que o texto completo seria "fiel ao sistema". Em
três pontos o código não confirma o trecho, e a regra do dono ("não vai ter nenhuma falha") pede fidelidade. Por isso
o texto final ficou assim:

| Trecho do protótipo | Texto final | Por quê |
|---|---|---|
| "Quando o produtor do evento usa Meta, Google ou TikTok [...] enviamos a eles [...] seu e-mail e telefone [em hash]" | Só a **Meta** recebe dados do servidor, e recebe **nome**, e-mail e telefone em hash. Google e TikTok recebem só o que o pixel registra no navegador. | `apps/worker/src/meta-capi.ts` manda `em`, `ph`, `fn` e `ln`. Não existe envio de servidor para Google ou TikTok. |
| Ingresso grátis "pode ser cancelado pelo produtor ou liberado por você [...] até o início do evento" | O prazo "até o início do evento" vale para o "Não vou mais". O produtor pode cancelar **enquanto o ingresso não tiver sido usado**. | `cancelarPedidoGratis` não tem trava de horário; só `nao-vou-mais.service.ts` tem. |
| Fidelidade e comunicações: "Você pode sair a qualquer momento **pelo link no e-mail**" | Para parar, você desliga "Ofertas por e-mail" no perfil, ou deixa de seguir a Casa. | Os e-mails de campanha e de seguidores **não têm link de descadastro**. Se o link for feito (ver Parte 6), a frase do protótipo pode voltar. |

Os outros dois trechos (CPF e proteção de reembolso) entraram com o mesmo sentido, só mais completos. O do CPF
agora diz também que o CPF fica na conta e no registro do pagamento. O da proteção ganhou um detalhe: no
cancelamento do evento, a proteção também volta.

---

## Parte 4 — Para o advogado conferir

1. **Identificação.** O sistema não tem razão social, CNPJ, endereço nem nome do encarregado em lugar nenhum. Os
   quatro campos estão entre colchetes no texto (LGPD, arts. 9º e 41, § 1º).
2. **Papel do produtor.** O texto trata a Casa como quem "também responde pelo uso" dos dados. Ela usa os dados para
   fins próprios (CRM, campanhas, fidelidade), o que sugere controladora independente ou conjunta, não operadora.
   Não existe hoje um termo do produtor que o obrigue a nada. A frase "o produtor só pode usar esses dados para o
   evento e para as comunicações que você aceitou" depende desse contrato.
3. **Transferência internacional.** Servidores numa VPS na Europa (`docs/projeto/DEPLOY.md`); Resend, Meta, Google e
   TikTok fora do Brasil. Qual mecanismo do art. 33 vale e se é preciso nomear países.
4. **Pixel e API de Conversões.** O texto propõe **legítimo interesse** para "medição das campanhas do produtor".
   Não existe banner de cookies e os pixels carregam assim que a página abre. O hash SHA-256 de e-mail e telefone é
   pseudonimização: continua sendo dado pessoal. O "início da compra" vai à Meta ao **criar** o pedido, antes de
   pagar. Se a conclusão for **consentimento**, é preciso um banner (trabalho de código) antes de publicar.
5. **CPF em toda compra.** O site exige CPF sempre. O Mercado Pago, que hoje cobra o Pix, não exige documento. A
   necessidade se apoia em identificar a pessoa na entrada e no limite por CPF. Isso basta para a minimização (art.
   6º, III)? O texto de ajuda do checkout diz "exigido pelo banco para emitir o Pix **e a nota do pagamento**", mas
   não existe nota.
6. **Retenção.** Não há prazo nem rotina de apagamento. Definir prazos: consumo (CDC, art. 27, 5 anos), fiscal e
   **Marco Civil, art. 15** (6 meses de registros de acesso). Hoje o sistema **não guarda registros de acesso** (IP,
   data e hora) de forma organizada, e o aceite dos termos não grava IP, embora a tabela tenha a coluna.
7. **Exclusão de conta.** O texto diz com franqueza o que fica: nome, e-mail e celular do pedido; nome e CPF do
   ingresso; CPF do pagador no registro do Pix; e-mail na fidelidade; corpos de webhook dos processadores. É aceitável
   pelo art. 16? O ingresso continua valendo depois da exclusão (ver Parte 5).
8. **Acesso e portabilidade.** "Baixar meus dados" entrega cadastro, pedidos e ingressos. Não entrega pagamentos,
   pontos, avaliações, Casas seguidas nem e-mails enviados. O texto manda o restante por e-mail. O prazo de 15 dias
   (art. 19, II) depende de alguém ler a caixa `privacidade@`.
9. **Arrependimento (CDC, art. 49).** O sistema não aprova sozinho. O analista pode recusar ou devolver parcial. O
   parágrafo único manda devolver "a qualquer título", incluindo a taxa de serviço. Hoje isso depende de o analista
   escolher "Total". O perfil do site fala em "até 48 h antes do evento", regra que **não existe no sistema** e cuja
   validade é discutível. O texto proposto não a usa.
10. **Proteção de reembolso.** Natureza jurídica (pode ser vista como seguro, área da SUSEP?). O valor da proteção
    fica com o **produtor**, não com a BoraFest (o razão contábil chama de `PROTECTION_CREDIT`). O texto diz "não é
    devolvida" só no reembolso pela proteção, e que volta no cancelamento do evento, que é o que o sistema faz. A
    opção vem desmarcada.
11. **Meia-entrada.** (a) Taxa de serviço cheia na meia: há entendimento de Procon de que o desconto alcança o preço
    efetivamente cobrado? (b) O sistema não controla a cota de 40%: fica com o produtor. (c) Lista de beneficiários,
    inclusive o idoso pelo Estatuto. (d) "Sem o documento, a produção pode recusar a entrada": é o adequado, ou é
    cobrar a diferença?
12. **Grátis cancelável pelo produtor** enquanto não usado, sem prazo. Isso pode ser cláusula abusiva (CDC, art. 51)
    mesmo sem pagamento?
13. **Cancelamento de pedido por fraude.** A equipe da BoraFest pode bloquear um ingresso pago, e isso não estorna
    nada sozinho. O texto diz "pode cancelar ingressos e pedidos com indício de fraude". O que precisa vir junto
    (aviso, devolução)?
14. **Responsabilidade da plataforma.** O texto não limita a responsabilidade da BoraFest (CDC, arts. 7º, 25 e 34) e
    só descreve quem faz o quê. Avaliar se e como dizer mais.
15. **Modelo de recebimento.** O dinheiro das vendas cai em contas da plataforma (Mercado Pago e Asaas), e o repasse
    sai delas. O levantamento de pendências marca isso como risco regulatório ainda sem decisão. O texto evita dizer
    em nome de quem o pagamento é recebido. Confirmar a redação de "vende ingressos em nome dos produtores".
16. **Quem não aceita os termos.** A compra na porta e a lista de convidados não passam por aceite (decisão de 31/08:
    "consentimento não se fabrica"). Como dar ciência a essas pessoas?
17. **Atualização da versão.** O aceite é gravado por pedido. Quem comprou na v2026-07 não é avisado da v2026-10. É
    preciso avisar? O sistema não tem envio em massa para todos os usuários; o CRM só alcança quem ligou ofertas.
18. **Texto do aceite no checkout.** Diz "autorizo o tratamento dos meus dados para emissão e entrega dos ingressos e
    para a criação da minha conta". Isso mistura consentimento com execução de contrato, e não cita pixel nem
    fidelidade.
19. **Menores de idade.** Não há verificação de idade na compra. A idade mínima é informada pelo produtor e conferida
    na porta.
20. **Avaliações.** A rota pública devolve o nome completo de quem comentou, embora o site mostre só a média.
21. **Dados de terceiros.** Participantes nominais e convidados de lista têm dados informados por outra pessoa. A
    seção "Dados de outras pessoas" basta?
22. **Incidente.** O texto promete avisar você e a ANPD (art. 48), e não existe processo escrito. Também vale avaliar
    o repositório de código, que esteve público com o e-mail de uma cliente no diário (já tirado do arquivo, mas
    ainda no histórico).
23. **Foro.** O texto propõe o foro do domicílio do consumidor (CDC, art. 101, I) e a lei brasileira.
24. **Itens adicionais.** Não há controle de estoque (copo e camiseta continuam vendendo depois de acabar). Se faltar,
    quem devolve?

---

## Parte 5 — Decisões do Arthur

1. **Preencher** razão social, CNPJ, endereço e nome do encarregado. Confirmar que `privacidade@borafest.com.br` e
   `suporte@borafest.com.br` existem e quem lê cada uma. O Resend só envia e não recebe e-mail.
2. **Exclusão de conta com ingresso ativo.** Hoje o ingresso continua valendo e o texto diz isso. A janela do perfil
   diz o contrário ("ingressos de eventos futuros são cancelados sem reembolso"). Opções: manter como hoje (e
   corrigir a janela), cancelar e reembolsar, ou impedir a exclusão enquanto houver ingresso para evento futuro.
3. **"Até 48 h antes do evento"** no arrependimento: manter fora (como no texto) ou criar a regra no servidor depois
   do parecer do advogado.
4. **Taxa de serviço no arrependimento:** devolver sempre (o texto diz "o valor pago volta") e orientar quem analisa
   a usar "Total", ou fazer o servidor aprovar automaticamente dentro dos 7 dias.
5. **Taxa cheia na meia-entrada:** manter (o texto diz) ou cortar pela metade (mudança de código).
6. **Fidelidade:** prazo de validade dos pontos e o que acontece se a Casa encerrar o programa. O texto diz "hoje os
   pontos não têm prazo de validade".
7. **Servidor na Europa:** confirmar provedor e país para a cláusula de transferência internacional.
8. **Correção do QR antigo após transferência** (Parte 6, item 1): é falha de segurança. Precisa da sua aprovação
   para entrar como prioridade.

---

## Parte 6 — Antes de publicar: o que precisa ser verdade no ar

**Bloqueia a publicação de uma frase específica** (se não estiver feito, a frase sai do texto):

| Frase do texto | Precisa estar verdadeiro | Como conferir |
|---|---|---|
| Segurança: "a chave que o assina fica guardada cifrada" | `TICKET_KEY_ENCRYPTION_KEY` definida na API **e** no worker, e `apps/api/scripts/cifrar-chaves-qr.ts` rodado | Backoffice → Configuração; o boot do worker avisa se a chave estiver em texto puro |
| Retenção e exclusão: "cópias de segurança [...] substituídas em até 30 dias" | `BACKUP_RETENTION_DAYS` ≤ 30 (padrão 14) **e**, se houver bucket externo, regra de ciclo de vida ≤ 30 dias | `infra/scripts/pg-backup.sh` não apaga nada no bucket, de propósito |
| Como usamos: "Não usamos WhatsApp nem SMS" | `WHATSAPP_PROVIDER=off` | `.env` do EasyPanel |
| Prestadores e Compra: "Mercado Pago e Asaas" | Pix e cartão roteados para esses dois (com reserva entre eles) | Backoffice → Configuração |
| Meia-entrada: "O ingresso sai marcado como meia e [...] a equipe pede o documento" | Etiqueta "MEIA-ENTRADA · peça o documento" na leitura do QR, online e offline (frente "Leitura do QR" desta rodada) | Ler um QR de meia em `/portaria` |
| Privacidade: "o produtor recebe o relatório dos ingressos de meia" e "baixam planilhas de [...] meia-entrada" | Planilha de meia-entrada no painel (frente "Relatórios" desta rodada) | Painel → Relatórios → "Exportar meia-entrada (CSV)" |
| Ingresso grátis: "Minhas compras → Não vou mais" | Botão no ar (frente "Não vou mais" desta rodada) | `/minhas-compras` com um pedido grátis |
| Ingresso grátis: "convite pessoal por e-mail" | Página de resgate do convite no ar (frente "Convite por e-mail") | Abrir um `?convite=` |
| Atendimento: e-mails de suporte e privacidade | Caixas existem e alguém lê | Mandar um e-mail de teste |

**Falhas achadas ao conferir o texto** (estão em "pendenteFora" do relatório, porque os arquivos são de outras
frentes):

1. **O QR antigo continua valendo depois da transferência.** `tickets.service.ts` (`transferTicket`) assina um QR
   novo, mas a porta não compara o QR lido com o vigente. Online, `checkins.service.ts` (`resolveTicketWithReason`)
   confere a assinatura e procura o ingresso pelo `tid`. Offline, `apps/checkout/lib/portaria/verify.ts`
   (`verifyLocally`) faz o mesmo. O `code` do ingresso também não muda na transferência. Resultado: quem transferiu
   (ou vendeu) ainda entra com o QR ou o código antigos, e quem chegar primeiro entra. O teste
   `ticket-transfer.test.ts` só confere que o token gravado mudou. Por isso o texto **não** promete que o QR antigo
   deixa de valer.
2. **Textos do site que contradizem a v2026-10** (corrigir junto com a publicação):
   - `apps/checkout/app/perfil/page.tsx`, resumo "Privacidade (LGPD)" e "Termos de Uso": "CPF apenas em eventos
     nominais", "O organizador recebe nome e tipo de ingresso", "a exclusão remove dados pessoais em até 30 dias",
     "Reembolso em até 7 dias (CDC art. 49, até 48h antes do evento)", "revenda acima do valor de face invalida o
     ingresso" (nada faz isso), "DPO: privacidade@borafest.**com**" (sem `.br`).
   - Mesmo arquivo, texto de "Reembolso: até 7 dias após a compra e até 48h antes do evento".
   - Mesmo arquivo, janela "Excluir sua conta?": "Ingressos de eventos futuros são cancelados sem reembolso" (não
     são) e "removidos em até 30 dias" (é na hora, e só em parte).
   - Mesmo arquivo, "Avisos do ingresso e lembretes do evento são sempre enviados" (não existe lembrete de evento).
   - `apps/checkout/app/minhas-compras/page.tsx`: "reembolso garantido (CDC art. 49)" e "O produtor responde em até
     5 dias úteis" (a aprovação é manual e não existe prazo no sistema).
   - `apps/checkout/app/checkout/[reservationId]/page.tsx`, ajuda do CPF: "Exigido pelo banco para emitir o Pix e a
     nota do pagamento" (não há nota e o Mercado Pago não exige CPF), e o texto do aceite (Parte 4, item 18).
3. **Versão do aceite em 3 lugares.** `CONSENT_VERSION = "v2026-07"` está repetida em `legal/page.tsx`,
   `checkout/[reservationId]/page.tsx` e `perfil/page.tsx`. Trocar as três para `"v2026-10"` no mesmo deploy, ou,
   melhor, unificar numa constante só.
4. **Link de descadastro.** Os e-mails de campanha (`packages/notifications/src/crm-reactivation.ts`) e de
   seguidores (`events.service.ts`, `notifyFollowers`) não têm link para sair. Com o link, a frase do protótipo
   ("sair pelo link no e-mail") passa a ser verdadeira.
5. **Exclusão e exportação incompletas** (`apps/api/src/me/me.service.ts`): ver Parte 4, itens 7 e 8. Mexer só
   depois do parecer.

---

## Parte 7 — Bloco pronto para `apps/checkout/app/legal/page.tsx`

Substitui o comentário e a linha de `CONSENT_VERSION` e os arrays `PRIVACIDADE` e `TERMOS` (hoje, linhas 7 a 26). O resto do arquivo não
muda: a página já mostra cada item como um cartão com título e texto. **Antes de colar:** preencher os 4 campos
entre colchetes e conferir a Parte 6. **No mesmo deploy:** trocar `CONSENT_VERSION` também no checkout e no perfil.

```ts
/** versão vigente do aceite de Termos/Privacidade — trocar também no checkout e no perfil */
const CONSENT_VERSION = "v2026-10";

const PRIVACIDADE = [
  [
    "Quem cuida dos seus dados",
    "A BoraFest ([RAZÃO SOCIAL], CNPJ [CNPJ], [ENDEREÇO]) é a controladora dos dados de quem usa o site borafest.com.br, o painel do produtor e a portaria. O produtor do evento (a Casa) recebe os dados de quem compra para os eventos dele e também responde pelo uso que faz deles. Encarregado de dados: [NOME DO ENCARREGADO], pelo e-mail privacidade@borafest.com.br.",
  ],
  [
    "O que coletamos na compra",
    "Nome, e-mail e CPF (obrigatórios na compra pelo site) e celular (opcional). Em ingresso nominal, o nome de cada participante e, quando o evento exige, o CPF dele. Do pedido, guardamos evento, ingressos, valores, forma de pagamento, cupom, itens adicionais, se houve proteção de reembolso e, se você chegou pelo link ou pelo código de um promoter, quem indicou. No cartão, número, validade, código de segurança, CPF do titular, CEP e número do endereço passam pelo nosso servidor só para chegar ao processador de pagamento, junto com o endereço IP da compra; não guardamos esses dados do cartão.",
  ],
  [
    "Por que pedimos o CPF",
    "Para emitir o pagamento: o processador pode exigir o CPF de quem paga. Para identificar você na entrada: o ingresso sai no seu nome e CPF, e a equipe da porta pode encontrá-lo pelo CPF. Para garantir o limite por pessoa: em lote com limite de ingressos por CPF, o CPF fica guardado no pedido. Para transferências: só recebe ingresso pelo CPF uma conta com CPF e e-mail confirmado. O CPF também fica na sua conta (definido uma vez; para trocar, fale com o suporte) e no registro do pagamento. Não enviamos CPF a parceiros de anúncio, e o link do pedido não mostra o CPF.",
  ],
  [
    "Meia-entrada, porta, lista e convite",
    "Meia-entrada: não pedimos nem guardamos o seu documento; ele é conferido na entrada pela equipe do evento. O ingresso fica marcado como meia, e o produtor recebe o relatório dos ingressos de meia (com o nome do participante) que a lei pede. Compra na porta: nome e e-mail são opcionais, e o CPF só é pedido quando o processador do Pix exige. Lista de convidados: quem coloca você na lista (o produtor ou um promoter) informa seu nome e, se o evento pedir, CPF e celular. Convite por e-mail: o produtor nos passa o seu e-mail para mandarmos o link pessoal.",
  ],
  [
    "Como usamos",
    "Para emitir e entregar seus ingressos, criar e manter sua conta, mostrar seus pedidos, conferir sua entrada, processar pagamentos, reembolsos, cancelamentos e transferências, aplicar limites por pessoa, prevenir fraude, somar pontos quando a Casa tem programa de fidelidade, cumprir obrigações legais (fiscais, de consumo e o relatório de meia-entrada) e falar com você sobre seus pedidos. Não usamos WhatsApp nem SMS para falar com você.",
  ],
  [
    "Base legal",
    "Execução do contrato da compra: emitir, entregar, validar, reembolsar e transferir ingressos. Cumprimento de obrigação legal ou regulatória: registros fiscais e de consumo e relatório de meia-entrada. Legítimo interesse: prevenção a fraude, segurança, programa de fidelidade da Casa e medição das campanhas do produtor. Consentimento: ofertas e campanhas por e-mail, que você liga e desliga no perfil.",
  ],
  [
    "O que o produtor vê",
    "O produtor do evento e as pessoas da equipe dele com permissão financeira veem os pedidos dos eventos da Casa: nome, e-mail, celular, ingressos, valores, se você já entrou, quanto gastou na Casa, se você a segue, por qual promoter comprou e marcações como “cliente frequente” ou “não compareceu”. Também baixam planilhas de pedidos, participantes e meia-entrada e, se a Casa tem fidelidade, veem seus pontos e resgates. A equipe da porta vê nome e tipo de ingresso; o CPF não aparece na tela, porque a busca por CPF compara um código embaralhado. Promoters veem só os convidados que eles mesmos puseram na lista. O produtor só pode usar esses dados para o evento e para as comunicações que você aceitou.",
  ],
  [
    "Prestadores de serviço",
    "Mercado Pago e Asaas processam os pagamentos e recebem o necessário para cobrar: nome, CPF e, conforme o meio de pagamento, e-mail, celular, dados do cartão e o endereço IP da compra. A Resend envia nossos e-mails: recebe seu e-mail e o conteúdo da mensagem e nos avisa se ela foi entregue, voltou ou foi marcada como spam. Nossos servidores ficam em um provedor contratado na Europa. Esses prestadores tratam os dados para a BoraFest; parte deles fica fora do Brasil, o que é uma transferência internacional de dados.",
  ],
  [
    "Parceiros de anúncio (pixel e API de Conversões)",
    "Quando o produtor ativa no evento o pixel da Meta, do Google (GA4) ou do TikTok, as páginas do evento, do checkout e do pedido carregam o código desse parceiro, que registra a visita, o início da compra e a compra com o valor, e pode usar cookies e dados do seu navegador conforme a política dele. Se o produtor ativar também a API de Conversões da Meta, nosso servidor envia à Meta o início da compra (ao criar o pedido) e a compra (ao pagar), com o valor e com seu nome, e-mail e telefone embaralhados (hash SHA-256). Não enviamos CPF. Pedidos grátis não são enviados como compra. Só a Meta recebe esse envio do servidor; Google e TikTok recebem apenas o que o pixel registra no navegador.",
  ],
  [
    "Comunicações",
    "Avisos do seu pedido (ingresso, código de acesso, transferência e cancelamento) chegam sempre por e-mail. Se você começar uma compra e não pagar, mandamos até dois lembretes. Se você seguir uma Casa, recebe um e-mail quando ela publicar um evento; para parar, deixe de seguir. Campanhas de uma Casa onde você já comprou só chegam se “Ofertas por e-mail” estiver ligado no seu perfil; desligue a mesma opção para parar de receber de todas as Casas.",
  ],
  [
    "Por quanto tempo guardamos",
    "Sua conta fica guardada enquanto existir. Pedidos, ingressos, pagamentos, entradas, o registro do aceite destes termos e a trilha de auditoria continuam guardados depois do evento, porque provam a compra e servem para reembolsos, contestações e obrigações fiscais e de consumo. Hoje esses registros não são apagados automaticamente depois de um prazo. As cópias de segurança do banco de dados são substituídas em até 30 dias.",
  ],
  [
    "Exclusão de conta",
    "Você pede em Perfil → “Excluir minha conta”. Na hora, apagamos da conta o nome, o e-mail, o celular, o CPF e a senha, encerramos todas as sessões e tiramos o CPF dos pedidos feitos com essa conta (e dos feitos sem login com o mesmo e-mail). Continuam guardados, pelos motivos do item anterior: nos pedidos, o nome, o e-mail e o celular informados na compra; nos ingressos, o nome, o e-mail e o CPF de quem usa; no pagamento, o CPF de quem pagou; os pontos de fidelidade (ligados ao e-mail) e o aceite dos termos. Ingressos já emitidos continuam valendo pelo QR que você recebeu por e-mail, mas deixam de aparecer no site. Para pedir a exclusão do restante, escreva para privacidade@borafest.com.br.",
  ],
  [
    "Seus direitos (LGPD, Lei 13.709/2018)",
    "Você pode confirmar se tratamos seus dados e acessá-los, corrigi-los, pedir portabilidade, anonimização, bloqueio ou eliminação do que for desnecessário, saber com quem compartilhamos, retirar o consentimento e pedir revisão de decisões automatizadas. No perfil, “Baixar meus dados” entrega seu cadastro, seus pedidos e seus ingressos; o nome você corrige ali; e “Ofertas por e-mail” liga e desliga as campanhas. Para o restante (CPF, e-mail, celular, pontos, histórico de mensagens), escreva para privacidade@borafest.com.br; respondemos em até 15 dias. Você também pode reclamar à ANPD (gov.br/anpd).",
  ],
  [
    "Segurança",
    "Site, painel e API usam conexão cifrada (HTTPS). Você entra com um código enviado ao seu e-mail, sem senha, e excluir a conta derruba todas as sessões abertas. No painel do produtor, cada pessoa tem um papel, e as listas com dados de compradores exigem permissão financeira. Na equipe da BoraFest, as ações que movem dinheiro exigem segundo fator (app autenticador). O QR de cada ingresso é assinado digitalmente, e a chave que o assina fica guardada cifrada. Estornos, cancelamentos, transferências, exclusões de conta, mudanças em eventos e lotes e entradas liberadas sem conferir o CPF ficam registrados numa trilha de auditoria. Se um incidente puder causar risco ou dano relevante a você, avisaremos você e a ANPD.",
  ],
  [
    "Cookies e dados no navegador",
    "O site guarda no seu navegador (armazenamento local, não cookies) a sua sessão, o link de promoter pelo qual você chegou (por 7 dias, para a comissão ir a quem indicou), favoritos, a cidade escolhida e o e-mail digitado no checkout. A BoraFest não usa cookies de publicidade próprios; os pixels de parceiros, quando o produtor os ativa, podem gravar cookies deles. Você apaga tudo isso nas configurações do navegador.",
  ],
  [
    "Dados de outras pessoas",
    "Ao informar o nome e o CPF de participantes, ou ao transferir um ingresso, você confirma que essas pessoas sabem disso e que você pode nos passar os dados delas. Esses dados são usados para emitir, transferir e validar o ingresso e aparecem para o produtor do evento como os seus.",
  ],
  [
    "Produtores, equipes e promoters",
    "Para usar o painel, guardamos nome, e-mail e senha (e celular, se informado); da organização, o CPF ou CNPJ, os dados bancários e a chave Pix do repasse; do promoter, as vendas e comissões. Usamos esses dados para dar acesso, pagar repasses e comissões, prevenir fraude e cumprir obrigações fiscais. As ações feitas no painel ficam na trilha de auditoria.",
  ],
  [
    "Mudanças nesta política",
    "A versão que você aceitou fica registrada em cada pedido. Quando esta política mudar, a nova versão aparece aqui, com outro número, e passa a valer para as compras feitas depois dela.",
  ],
];

const TERMOS = [
  [
    "O que é a BoraFest",
    "A BoraFest é uma plataforma que vende ingressos em nome dos produtores de eventos (as Casas). O produtor, identificado na página do evento, é quem organiza e realiza o evento: data, local, atrações, segurança, acessibilidade, idade mínima e regras de entrada. A BoraFest cuida da venda, do pagamento, da emissão, da transferência e da validação dos ingressos. Ao comprar, você aceita estes termos e a Política de Privacidade.",
  ],
  [
    "Sua conta",
    "A conta nasce na sua primeira compra, com os dados dela, ou na primeira vez que você entra. Você entra com um código enviado ao seu e-mail, sem senha. Para ver o primeiro ingresso, confirme o e-mail pelo link que mandamos. Use dados verdadeiros e um e-mail que seja seu: é para ele que vão o ingresso e os avisos. O CPF fica na conta depois de definido; para trocá-lo, fale com o suporte.",
  ],
  [
    "Compra e pagamento",
    "Os ingressos escolhidos ficam reservados por 10 minutos enquanto você preenche os dados; criado o pedido, você tem 30 minutos para pagar. Sem pagamento nesse prazo, o pedido expira e os ingressos voltam à venda. O pagamento é por Pix ou cartão de crédito (parcelado sem juros, quando oferecido), processado pelo Mercado Pago ou pela Asaas. O ingresso é emitido quando o pagamento é confirmado. Cada lote tem um limite de ingressos por pedido.",
  ],
  [
    "Taxa de serviço e valores",
    "Cada ingresso mostra o preço e a taxa de serviço da BoraFest antes de você escolher; em alguns eventos o produtor paga a taxa por você, e isso aparece na escolha do ingresso. O total do pedido aparece antes do pagamento. Itens adicionais (como copo ou camiseta) e a proteção de reembolso são opcionais e aparecem separados no resumo; os itens são entregues pelo produtor no evento. Ingresso grátis não tem taxa. Na meia-entrada, o preço do ingresso cai pela metade e a taxa de serviço é cobrada inteira.",
  ],
  [
    "Desistência e reembolso (CDC, art. 49)",
    "Na compra pela internet, você pode desistir em até 7 dias da compra. Peça em “Minhas compras” → “Solicitar reembolso”, dizendo o motivo. O pedido é analisado por quem cuida do repasse do evento (o produtor ou a BoraFest) e, aprovado, o valor pago volta pelo mesmo meio de pagamento e os ingressos do pedido deixam de valer. Depois dos 7 dias, você ainda pode pedir, mas a aprovação depende da análise. Ingresso grátis e compra na porta não têm reembolso pela plataforma.",
  ],
  [
    "Proteção de reembolso",
    "Opcional, R$ 1,50 por pedido, oferecida no checkout de ingressos pagos. Com ela, você mesmo pede o reembolso na página do pedido (“Pedir reembolso do ingresso”) até o início do evento, sem análise e por qualquer motivo: devolvemos tudo o que você pagou, menos os R$ 1,50 da proteção, e os ingressos do pedido deixam de valer na hora. Só quem fez a compra, entrando na própria conta, pode pedir. Se o evento for cancelado, você recebe tudo de volta, inclusive a proteção.",
  ],
  [
    "Cancelamento ou mudança do evento",
    "Se o produtor cancelar o evento, você não precisa pedir: devolvemos tudo o que você pagou online (ingresso, taxa de serviço, itens adicionais e proteção) pelo mesmo meio de pagamento e avisamos por e-mail, com o motivo informado pelo produtor. No Pix o dinheiro costuma voltar em minutos; no cartão, o estorno aparece na fatura no prazo do seu banco. Ingressos grátis do evento cancelado deixam de valer, e você recebe um aviso. Se o produtor mudar a data, o horário ou o local, você pode pedir o reembolso em “Minhas compras”.",
  ],
  [
    "Compra na porta",
    "Em alguns eventos a produção vende na porta, em dinheiro ou Pix. O ingresso é emitido na hora e a entrada já fica registrada. Compra na porta não tem reembolso pela BoraFest: qualquer acerto, inclusive se o evento for cancelado, é feito direto com a produção do evento.",
  ],
  [
    "Meia-entrada",
    "Têm direito à meia-entrada, nos termos da Lei 12.933/2013 e do Decreto 8.537/2015, estudantes, pessoas com deficiência (e o acompanhante, quando necessário) e jovens de 15 a 29 anos de baixa renda; pessoas idosas têm o desconto pelo Estatuto da Pessoa Idosa. Quando o lote oferece meia, você marca a opção ao escolher o ingresso. O ingresso sai marcado como meia e, na entrada, a equipe pede o documento que comprova o direito; sem ele, a produção pode recusar a entrada com esse ingresso. A BoraFest não guarda o seu documento. A oferta e a cota de meia-entrada do evento são definidas pelo produtor.",
  ],
  [
    "Transferência",
    "Ingresso pago pode ser transferido pela sua conta até o fim do evento, para quem já tem conta na BoraFest: pelo e-mail da pessoa ou pelo CPF de uma conta com e-mail confirmado. O ingresso passa para o nome e o CPF de quem recebe, ganha um QR novo e aparece na conta dessa pessoa, que recebe um aviso por e-mail. Em lote que exige CPF, a conta de quem recebe precisa ter CPF. Ingresso grátis, de cortesia ou de lista é pessoal e não pode ser transferido. Cada ingresso vale uma única entrada: receba ingresso só de quem você conhece e não repasse cópias do QR.",
  ],
  [
    "Ingresso grátis",
    "Ingresso grátis não tem taxa nem reembolso, porque nada foi pago, e é pessoal e intransferível. Você pode liberar a vaga em “Minhas compras” → “Não vou mais” até o início do evento. O produtor também pode cancelar o ingresso enquanto ele não tiver sido usado. Nos dois casos o QR deixa de valer, a vaga volta para outra pessoa e você recebe um e-mail. Alguns ingressos só aparecem para quem tem o link de convite ou recebeu um convite pessoal por e-mail, e o convite por e-mail só vale com o mesmo e-mail que o recebeu.",
  ],
  [
    "Limite por pessoa",
    "O produtor pode limitar quantos ingressos de um lote cada CPF leva, somando todos os pedidos, inclusive os que ainda aguardam pagamento. Nesses lotes o CPF é obrigatório e fica guardado no pedido. Pedido cancelado, expirado ou reembolsado deixa de contar no limite.",
  ],
  [
    "Entrada no evento",
    "Mostre o QR do ingresso (no e-mail ou na página do pedido) na entrada. A equipe da produção lê o QR ou procura você pelo nome, pelo CPF ou pelo código do ingresso; a primeira leitura registra a entrada, e o mesmo ingresso não passa de novo. A idade mínima, quando houver, aparece na página do evento. As regras de entrada (idade, documento, revista, vestimenta) são do produtor e do local.",
  ],
  [
    "Fraude e segurança do ingresso",
    "O QR de cada ingresso é assinado digitalmente: QR inventado, alterado ou de outro evento não passa. Mas uma cópia (print ou foto) de um QR verdadeiro passa uma vez, e quem chegar primeiro entra. Por isso, não divulgue seu QR e compre só pela BoraFest ou com o próprio produtor. Se o pagamento for contestado no cartão (chargeback) ou estornado, os ingressos do pedido deixam de valer. A BoraFest pode cancelar ingressos e pedidos com indício de fraude.",
  ],
  [
    "Fidelidade da Casa",
    "Se a Casa tem programa de pontos, cada compra paga nela soma pontos pela regra que ela definiu, ligados ao e-mail do pedido; você vê o saldo em “Pontos e recompensas” depois de entrar. Os pontos valem só na Casa que os deu, são trocados pelas recompensas que ela oferece (com um código) e não valem dinheiro. Se a compra for reembolsada ou contestada, os pontos dela saem. A Casa pode pausar os resgates e mudar as recompensas; hoje os pontos não têm prazo de validade.",
  ],
  [
    "Comunicações da Casa",
    "Avisos do pedido sempre chegam por e-mail. Se você seguir uma Casa, recebe um e-mail quando ela publicar um evento; para parar, deixe de seguir. Campanhas e convites das Casas onde você comprou só chegam se “Ofertas por e-mail” estiver ligado no seu perfil; desligue a mesma opção, a qualquer momento, para parar de receber.",
  ],
  [
    "Mesa e camarote (VIP)",
    "Em alguns eventos você pode pedir reserva de mesa ou camarote. O pedido só vale depois que a Casa confirma; quando ela cobra sinal, o pagamento é por Pix. O cancelamento da reserva e a devolução do sinal são combinados com a Casa.",
  ],
  [
    "Avaliações",
    "Depois do evento, quem fez pedido confirmado nele pode dar nota e comentário. A média aparece na página do evento; o comentário e o seu nome ficam guardados e podem ser exibidos. Não publique ofensas nem dados de outras pessoas.",
  ],
  [
    "Atendimento e mudanças nestes termos",
    "Dúvidas sobre pedidos: suporte@borafest.com.br. Sobre dados pessoais: privacidade@borafest.com.br. A versão que você aceitou fica registrada em cada pedido; novas versões valem para as compras feitas depois delas. Valem as leis brasileiras, e você pode resolver qualquer disputa no foro da sua cidade.",
  ],
];
```

---

## Anexo — Evidências (afirmação → código)

Arquivos na árvore de trabalho de 12/10 (base `c22a7f0` + frentes desta rodada). Os números de linha podem mudar
com as edições em paralelo. Por isso cito também a função.

| Afirmação do texto | Onde está |
|---|---|
| CPF obrigatório na compra pelo site; celular opcional | `apps/checkout/app/checkout/[reservationId]/page.tsx` (passo "Seus dados": campo CPF e validação `ehCpfValido` no "Continuar"; celular "ou deixe em branco") |
| CPF guardado no pedido só em lote com limite | `apps/api/src/orders/orders.service.ts`, `createFromReservation` (`cpfParaGuardar`) |
| CPF vai para a conta se estiver livre | mesmo arquivo, `createFromReservation` ("CPF na conta só quando...") |
| CPF do pagador no registro do Pix | `apps/api/src/payments/payments.service.ts`, `createPix` (`metadata: { payerDocument }`) |
| O que vai ao Mercado Pago (primeiro nome, CPF, e-mail sintético) e à Asaas (nome, e-mail, CPF, celular) | `packages/payments/src/mercadopago.ts` (`createPixCharge`); `packages/payments/src/asaas.ts` (`ensureCustomer`) |
| Cartão passa pela API com IP e não é guardado | `payments.service.ts`, `createCard` (`rawCard`, `remoteIp`; "PAN nunca entra em log, banco ou payload de idempotência") |
| Ingresso sai no nome e CPF de quem comprou ou do participante | `apps/worker/src/issue-tickets.ts`, `issueTicketsForOrder` (`attendeeName`, `attendeeCpf`) |
| A porta não vê o CPF; a busca compara hash | `apps/api/src/validator/validator.service.ts` (`hashCpf`); `apps/checkout/lib/portaria/search.ts` |
| Link do pedido sem CPF | `orders.service.ts`, rota de status ("contactCpf nunca sai") |
| Confirmação do e-mail antes do 1º ingresso | `issue-tickets.ts` ("Portão do 1º ingresso") |
| WhatsApp desligado | `.env.production.example` (`WHATSAPP_PROVIDER=off`, "Desligado por decisão") |
| API de Conversões: só Meta, nome, e-mail e telefone em hash, sem R$ 0, só com pixel e token | `apps/worker/src/meta-capi.ts` (`user_data: em, ph, fn, ln`; `totalCents === 0`; `!token \|\| !pixelId`) |
| Início da compra ao criar o pedido; compra ao pagar | `apps/worker/src/process-outbox.ts` (`order.created`, `order.paid`) |
| Pixels Meta, GA4 e TikTok no navegador; grátis não vira compra | `apps/checkout/components/PixelTracker.tsx`; `pedido/[publicToken]/page.tsx` e `checkout/[reservationId]/page.tsx` (`gratis ? undefined`, `totalCents > 0`) |
| O que o produtor vê (CRM) e com qual permissão | `apps/api/src/customer-crm/customer-crm.service.ts` (`FINANCE_VIEW`; e-mail, nome, celular, gasto, presença, marcações, promoter) |
| Planilhas de pedidos, participantes e meia | `apps/api/src/dashboard/dashboard.service.ts` (`exportOrdersCsv`, `exportParticipantsCsv`, `exportMeiaEntradaCsv`); `relatorio-meia.ts` |
| Campanhas só para quem ligou ofertas; sem link de descadastro | `apps/api/src/customer-crm/crm-reactivation.service.ts` (`EMAIL_OPT_IN`); `packages/notifications/src/crm-reactivation.ts` |
| E-mail aos seguidores quando a Casa publica | `apps/api/src/events/events.service.ts` (`notifyFollowers`, `anunciarAosSeguidoresUmaVez`) |
| Até 2 lembretes de compra não paga | `apps/worker/src/abandoned-cart.ts` (lembrete aos 15 min; resgate 1 h depois de expirar) |
| Fidelidade por e-mail, revertida no estorno | `apps/worker/src/loyalty.ts` (`awardLoyaltyForOrder`, `reverseLoyaltyForOrder`) |
| Exclusão: o que apaga | `apps/api/src/me/me.service.ts`, `deleteAccount` |
| "Baixar meus dados": o que entrega | `me.service.ts`, `dataExport` |
| Segundo fator nas ações de dinheiro da equipe | `apps/api/src/admin/admin.controller.ts` (`Exige2faGuard`); `apps/api/src/seguranca-2fa/` |
| Chave do QR cifrada quando configurada | `issue-tickets.ts` (`conferirChaveMestra`, `protegerChavePrivada`); `.env.production.example` (`TICKET_KEY_ENCRYPTION_KEY`) |
| Ações auditadas | `auditLog.create` em `refund-order.ts`, `events.service.ts`, `catalog.service.ts`, `tickets.service.ts`, `me.service.ts`, `checkins.service.ts`, `admin.service.ts` |
| Cópias de segurança: 14 dias no servidor | `docker-compose.yml` (`BACKUP_RETENTION_DAYS:-14`); `infra/scripts/pg-backup.sh` |
| Servidor na Europa | `docs/projeto/DEPLOY.md` ("VPS do Arthur (Europa)") |
| Armazenamento local (sessão, promoter por 7 dias, favoritos, cidade, e-mail) | `apps/checkout/lib/attribution.ts` (`ATTRIBUTION_WINDOW_MS`); `lib/favorites.ts`; `checkout/[reservationId]/page.tsx` (`bf.email`) |
| Reserva de 10 min; 30 min para pagar | `apps/api/src/reservations/reservations.service.ts` (`RESERVATION_TTL_MINUTES = 10`); `orders.service.ts` (`ORDER_PAYMENT_WINDOW_MINUTES = 30`) |
| Taxa por lote, produtor pode absorver | `apps/checkout/components/TicketSelector.tsx` ("taxa por conta do produtor"); `apps/checkout/lib/preco.ts` |
| Meia: metade do preço, taxa cheia | `reservations.service.ts` ("metade do preço, taxa cheia") |
| Reembolso: só cria o pedido, alguém analisa | `apps/api/src/refund-requests/refund-requests.service.ts` (`create` → `PENDING`; casa no modo instantâneo, BoraFest no padrão) |
| Grátis não tem reembolso | `refund-requests.service.ts`; `apps/api/src/common/refund-order.ts` |
| Proteção: R$ 1,50, até o início, devolve tudo menos o prêmio, só o titular | `packages/contracts/src/orders.ts` (`PROTECTION_FEE_CENTS = 150`); `orders.service.ts` (`requestProtectionRefund`) |
| Proteção volta no cancelamento do evento | `packages/payments/src/apply-status.ts` ("cancelamento de evento [...]: o prêmio todo") |
| Cancelamento do evento: estorno sem pedir, porta fora, grátis cancelado, e-mail com motivo | `events.service.ts` (`cancel`, `restantePorPedido` com `soldByUserId: null`, `avisarCompradoresDoCancelamento`) |
| Porta não tem reembolso | `refund-order.ts` ("VENDA DE PORTA NÃO TEM REEMBOLSO") |
| Porta: CPF só se o provedor do Pix exigir; entrada registrada na hora | `orders.service.ts` (`pixExigeCpf`); `apps/checkout/components/PdvPorta.tsx` ("check-in automático") |
| Limite por CPF soma pedidos pendentes e pagos | `orders.service.ts` (`ingressosDoCpfNoLote`) |
| Transferência: só pago, até o fim, conta existente, renomina, QR novo, aviso | `apps/api/src/tickets/tickets.service.ts` (`transferTicket`) |
| QR antigo não é recusado | `apps/api/src/checkins/checkins.service.ts` (`resolveTicketWithReason`); `apps/checkout/lib/portaria/verify.ts` (`verifyLocally`) |
| "Não vou mais" até o início, só o dono | `apps/api/src/orders/nao-vou-mais.service.ts` (`recusaDoNaoVouMais`) |
| Produtor cancela grátis sem trava de horário | `apps/api/src/common/cancelar-pedido-gratis.ts` |
| Chargeback cancela os ingressos | `process-outbox.ts` (`order.payment_reversed` → `revokeOrderTickets`) |
| BoraFest pode bloquear ingresso | `apps/api/src/admin/admin.service.ts` (`blockTicket`) |
| Avaliação: quem tinha ingresso, depois do evento; nome na rota pública | `apps/api/src/reviews/reviews.service.ts` |
| Aceite obrigatório e versionado por pedido | `packages/contracts/src/orders.ts` (`consent`, `superRefine`); `orders.service.ts` (`tx.consent.createMany`) |
