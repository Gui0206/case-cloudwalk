# Carga de conversas com segunda mensagem e atendimento humano

## Hipótese e método

O ensaio verifica se a instalação que respondeu à primeira mensagem de aproximadamente 400 novos casos/s por dois minutos consegue manter a mesma taxa de abertura por cinco minutos, responder a uma segunda mensagem e manter a fila humana utilizável.

- Projeto Compose isolado `central-mixed`, porta 4383, banco inicialmente vazio, uma instância por serviço, 32 conexões no pool da API, quatro workers de outbox e três leitores da ponte.
- O gerador agenda 120.000 aberturas pelo relógio. Alterna as duas marcas e três canais simulados, usa 128 sessões de cliente, um assunto (Pix), 10% de prioridade alta e até 160 aberturas simultâneas. O contador `skipped` registra chegadas que atingem esse teto.
- Até 96 tarefas consultam o histórico do cliente a partir de 800 ms depois da abertura. Só enviam a segunda mensagem após observar a primeira resposta. Quatro em cada cinco clientes informam que o caso foi resolvido. Um em cada cinco solicita um humano.
- Dezesseis sessões autenticadas de analista, oito por marca, consultam a lista real da API. Cada sessão lê o histórico e verifica o resumo, assume o caso, responde e encerra pelos endpoints do painel. O gerador coordena tentativas simultâneas por ID em memória. Uma listagem anterior pode ficar desatualizada entre leitura e ação. Os analistas são sintéticos, sem tempo humano de digitação. O ensaio exercita a API do painel, sem renderizar navegadores.
- O gerador interrompe novas chegadas após cinco minutos e dá até dois minutos para concluir as conversas abertas. Contagens da API e o histórico persistido permitem verificar as duas respostas, o destino e a sequência de autores de cada atendimento. O p95 de abertura usa o relógio do cliente. Cada p95 da IA mede a diferença entre os horários de início das transações que gravaram a mensagem e sua resposta no PostgreSQL.
- Para aprovação, o gerador exige as 120.000 aberturas, as duas respostas em cada caso, 96.000 encerramentos automáticos, 24.000 humanos, sequência correta, nenhum erro de requisição, nenhum evento pendente ou falho ao final e p95 de até dois segundos para cada resposta da IA. Ao terminar a entrada admite até três segundos de chegadas ainda sem segunda mensagem e até três segundos de escalações ainda sem encerramento. São critérios deste experimento.

## Resultado medido

**Reprovado no fluxo completo.** A VM do Docker tinha 12 CPUs e 7,65 GiB. Das 120.000 chegadas programadas, 341 atingiram o limite do gerador. As 119.659 tentativas de abertura foram aceitas (398,86/s), com p95 de 54 ms. Ao parar a entrada, 74.792 clientes já tinham enviado a segunda mensagem. Todas as 16 sessões de analista encerraram pelo menos um caso, totalizando 515 nos primeiros 15 segundos. Nos minutos seguintes, continuaram consultando o painel e não conseguiram encerrar outros casos.

| Conferência após 120 s extras | Resultado |
|---|---:|
| Primeiras respostas persistidas / aberturas | 94.814 / 119.659 |
| Segundas respostas persistidas / segundas mensagens enviadas | 67.639 / 93.605 |
| p95 da primeira e da segunda resposta, entre as persistidas | 168,3 s e 139,5 s |
| Encerramentos automáticos / encerramentos humanos | 54.109 / 515 |
| Handoffs aguardando atendimento | 13.015 |
| Conversas com sequência inesperada de autores | 0 |
| Outbox pendente / falha definitiva | 0 / 0 |

Houve 539 respostas HTTP 409 ao tentar assumir casos de listagens que já haviam mudado. As demais operações HTTP não registraram erro. Os percentis de IA excluem respostas ainda pendentes no corte. Ao todo, 26.054 conversas também chegaram ao corte sem que o cliente sintético tivesse enviado a segunda mensagem.

Uma verificação logo após o corte encontrou 6.559 casos aguardando na InfinitePay e 6.568 na JIM. Nas duas marcas, todas as 250 posições visíveis estavam ocupadas por encerrados. A consulta de auditoria subsequente confirmou fila esperada, resumo, motivo e um único evento de transferência em todos os 13.651 casos já escalados naquele instante, além de 515 encerramentos auditados. As consultas usaram snapshots sucessivos enquanto a ponte continuava processando eventos.

Logo após o fim das chegadas, o agente tinha atraso zero e a ponte tinha 56.764 eventos publicados ainda sem offset confirmado. Havia três eventos pendentes na outbox nessa amostra. Durante a carga houve também uma amostra com as 32 conexões da API em uso. Isso localiza acúmulo no caminho de retorno para a API e o banco. A contribuição individual do painel, da espera pelo pool e das escritas concorrentes exige um teste controlado. As [amostras operacionais](mixed-lag.json) combinam contagens do PostgreSQL e leituras sucessivas de `rpk group describe` para os grupos `central-agent-v1` e `central-bridge-v1`.

## Reprodução

A partir da raiz, com Docker, Node 22+ e o arquivo local `.env`:

```sh
HELPDESK_PORT=4383 docker compose -p central-mixed up -d --build
node --env-file=.env scripts/mixed.js
docker compose -p central-mixed exec -T db psql -X -U helpdesk < scripts/mixed-queues.sql
docker compose -p central-mixed stop
```

Aguarde a API e os consumidores iniciarem. O script exige banco sem atendimentos e confirma a porta de teste. Salva as amostras, contagens e latências em [mixed.json](mixed.json). Para uma nova rodada use volumes de teste vazios.

## Interpretação para o TAPI

O enunciado situa a plataforma em uma operação com milhares de novos atendimentos por dia, picos sazonais e milhões de clientes em diferentes marcas. O pico de 400 novas conversas por segundo, o percentual de transferências, a velocidade dos analistas e o prazo de dois segundos são hipóteses do ensaio. A carga concentrou um único assunto e uma equipe por marca. As 128 sessões reutilizadas também limitam o que se pode afirmar sobre a cardinalidade de clientes.

A fila de escalações é um entregável funcional. A listagem usada pelo painel filtra por fase humana, equipe e marca, ordena por prioridade e atualização e limita o retorno a 250. Casos encerrados continuam na fase humana. Com histórico suficiente, os 250 primeiros podem estar todos encerrados, enquanto casos que aguardam ficam fora do alcance do analista. A correção prioritária é selecionar os estados de trabalho antes de ordenar e limitar, mantendo o histórico consultável e paginando a lista. Um teste de regressão deve popular mais de 250 encerrados por marca e confirmar que um caso novo ainda pode ser localizado e assumido.

Para avaliar a estabilidade depois dessa correção, repita o mesmo perfil e observe a vazão de encerramentos por marca, os dois tempos de resposta, a espera por conexão da API e o atraso do consumidor de respostas. O teste anterior de reentrega e recuperação cobre falhas em um cenário separado. Interromper e recuperar um consumidor durante tráfego misto e repetir com a distribuição de volume, categorias, tempos humanos e picos do parceiro ampliaria a evidência operacional.
