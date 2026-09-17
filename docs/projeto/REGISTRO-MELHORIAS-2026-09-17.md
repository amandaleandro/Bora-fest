# BoraFest — melhorias de produção e vitrine pública (17/09/2026)

## Objetivo

Fechar inconsistências encontradas no ambiente público e aproximar a vitrine da maturidade real do produto.

## Implementado nesta branch

### Proteção de vendas
- Reserva pública é recusada no backend quando `endsAt <= agora`, mesmo se o evento ainda estiver `PUBLISHED`.
- O checkout deixa de apresentar fluxo de compra para evento encerrado.

### Qualidade de cadastro
- UF do local aceita apenas siglas brasileiras válidas.
- Término do evento precisa ser posterior ao início.

### Vitrine para produtores
- Nova rota `/para-produtores`.
- Comunicação de ingressos/lotes, promoters/listas, portaria offline, PDV, VIP e financeiro.
- Header e footer conectados à nova landing.

### Confiança do comprador
- Home ganhou bloco “Do ingresso à entrada”.
- Páginas públicas de evento exibem sinais de confiança sobre pagamento, QR individual e acesso sem app obrigatório.

## Ainda pendente

- impedir publicação/republicação de evento vencido;
- separar homologação/testes do catálogo público;
- hero institucional quando não houver destaque forte;
- limpeza dos registros de teste existentes em produção;
- enriquecer página do evento com políticas e FAQ;
- smoke test de produção após merge/deploy.
