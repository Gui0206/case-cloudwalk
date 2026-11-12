# A fila do analista com seis meses de histórico

A hipótese é que acumular casos encerrados tem pouco efeito sobre a consulta de casos ativos. O índice parcial `analyst_active` mantém ordenados os casos humanos em espera ou em atendimento por marca, equipe, prioridade e atualização. Assumir o caso também acessa o registro do atendimento e grava uma decisão de auditoria. O ensaio mede essas duas operações pela API usada no painel.

## Método

Duas instalações Docker Compose isoladas na mesma máquina receberam, uma de cada vez, 400 novas conversas por segundo por 300 segundos, com até 120 segundos adicionais para concluir o trabalho. O gerador reutiliza o fluxo do teste de carga mista: 128 sessões de cliente, duas marcas, três canais simulados, assunto Pix, duas mensagens do cliente, 96 tarefas de acompanhamento e 16 analistas simulados. Cada analista consulta a primeira página da fila de sua marca, abre o histórico, verifica o contexto, assume, responde e encerra. Para representar as três prioridades igualmente nas duas marcas, a prioridade alterna a cada par de aberturas; um em cada cinco clientes pede um humano. A sessão do analista consulta de novo 400 ms depois de percorrer a lista recebida.

O primeiro banco começou sem atendimentos. Antes da segunda rodada, inserimos 360 mil casos encerrados distribuídos uniformemente por 180 dias, dos quais 72 mil com passagem por analista. O histórico contém 1.512.000 mensagens, 864.000 registros de auditoria, 720.000 eventos de saída já enviados e 720.000 confirmações de processamento. A preparação insere os dados diretamente no PostgreSQL e atualiza suas estatísticas. O Kafka começa sem tráfego histórico em ambas as condições. A verificação dos casos novos exclui os clientes sintéticos do arquivo.

A **listagem** mede o tempo da requisição HTTP bem-sucedida até a leitura do JSON. A fila devolve todas as prioridades juntas. Quando discriminada por prioridade, a amostra inclui cada consulta que trouxe pelo menos um item daquela prioridade; a mesma consulta pode aparecer em mais de uma linha. **Assumir** mede a chamada HTTP bem-sucedida do analista. **Espera** usa a diferença entre os horários das transações que gravaram a transferência e a tomada do caso na auditoria. Inclui descoberta, leitura do histórico e espera enquanto os analistas percorrem a lista. Os percentis incluem a drenagem. O gerador não mede o tempo de renderização em um navegador.

## Resultados observados

| Medida | Inicialmente vazio | Com histórico |
|---|---:|---:|
| Novas conversas encerradas | 120000 | 120000 |
| Aberturas puladas | 0 | 0 |
| Listar fila, p95 (ms) | 8,41 | 8,92 |
| Listar fila contendo Urgente, p95 (ms) | 8,45 | 9,03 |
| Assumir Urgente, p95 HTTP (ms) | 8,36 | 9,06 |
| Transferência até assumir Urgente, p95 (ms) | 394,31 | 398,68 |
| Listar fila contendo Alta, p95 (ms) | 8,41 | 8,91 |
| Assumir Alta, p95 HTTP (ms) | 8,88 | 9,50 |
| Transferência até assumir Alta, p95 (ms) | 416,99 | 423,48 |
| Listar fila contendo Normal, p95 (ms) | 8,39 | 8,83 |
| Assumir Normal, p95 HTTP (ms) | 8,94 | 9,26 |
| Transferência até assumir Normal, p95 (ms) | 439,56 | 445,89 |
| Tentativas de assumir recusadas com HTTP 409 | 26410 | 26281 |
| Eventos do teste enviados / sem confirmação | 240000 / 0 | 240000 / 0 |
| Eventos de saída pendentes / falhos | 0 / 0 | 0 / 0 |
| Lag final Kafka, agente / ponte | 0 / 0 | 0 / 0 |
| Eventos no tópico de falhas | 0 | 0 |
| Tempo até a medição final, incluindo drenagem (s) | 301,75 | 301,60 |

O p95 da listagem aumentou 0,51 ms. Nas duas condições, a prioridade urgente teve a menor espera até a tomada; com histórico, a diferença para a prioridade normal foi de 47,21 ms no p95. O PostgreSQL escolheu o índice parcial `analyst_active` nas duas verificações após a drenagem. A primeira resposta da IA apresentou maior variação, de 104,73 para 163,72 ms no p95.

Cada medição de tomada bem-sucedida tem 8.000 casos por prioridade. Os HTTP 409 são tentativas de assumir um caso que outro analista já assumiu ou encerrou enquanto o primeiro percorria uma listagem anterior. As tentativas recusadas entram na carga do servidor e ficam fora do p95 das tomadas bem-sucedidas.

O teste cobre uma execução por condição, com o banco analisado e o histórico encerrado. A variação entre rodadas, o cache e a atividade da máquina podem influenciar diferenças pequenas. A consulta de verificação após a drenagem examina o plano com a fila ativa vazia. Atendimento humano real, fila ativa acumulada e uso contínuo por 180 dias ficam fora do experimento.

[Dados sem histórico](central-history-empty.json) · [Dados com histórico](central-history-aged.json) · [Verificação final sem histórico](central-history-empty-snapshot.json) · [Verificação final com histórico](central-history-aged-snapshot.json)

## Reteste com atribuição do próximo caso pelo servidor

Na primeira rodada com histórico, vários analistas podiam identificar o mesmo chamado em listagens anteriores e tentar assumi-lo depois. O painel passou a enviar uma solicitação de próximo caso, com o filtro de fila selecionado. Em uma transação PostgreSQL, a API escolhe uma linha disponível da marca e equipe da sessão, ordena por prioridade e antiguidade e usa `FOR UPDATE SKIP LOCKED` para pular linhas que outro analista já está assumindo. Atribuição e auditoria são confirmadas juntas. Se nenhum caso estiver disponível naquele instante, a API devolve uma resposta sem chamado.

Repetimos a rodada com uma nova instalação e a mesma carga, partindo do mesmo histórico sintético. Os 16 analistas ainda consultam a listagem pública de sua equipe; agora usam os IDs devolvidos pela atribuição e então abrem o histórico, verificam o contexto, respondem e encerram. Nenhum coordenador em memória reserva IDs entre os analistas nesse fluxo. A conferência final exige zero erros HTTP e exatamente uma atribuição por caso humano.

| Medida | Escolha por ID na lista | Próximo caso pelo servidor |
|---|---:|---:|
| Conversas encerradas | 120.000 | 120.000 |
| Tentativas de assumir com HTTP 409 | 26.281 | 0 |
| Listar fila, p95 (ms) | 8,92 | 11,02 |
| Assumir Urgente, p95 HTTP (ms) | 9,06 | 11,06 |
| Transferência até assumir Urgente, p95 (ms) | 398,68 | 364,68 |
| Assumir Alta, p95 HTTP (ms) | 9,50 | 12,38 |
| Transferência até assumir Alta, p95 (ms) | 423,48 | 383,93 |
| Assumir Normal, p95 HTTP (ms) | 9,26 | 11,80 |
| Transferência até assumir Normal, p95 (ms) | 445,89 | 405,32 |

A auditoria registrou 24.000 atribuições para 24.000 chamados distintos. Houve 10.056 consultas de próximo caso sem trabalho disponível. O tempo de atribuição HTTP considera apenas respostas com chamado. Os 240 mil eventos tiveram retorno confirmado; a outbox, a defasagem dos dois consumidores e o tópico de falhas terminaram zerados. Uma execução por versão permite comparar o comportamento observado nesta máquina.

[Medições da nova rodada](central-history-dispatch.json) · [Verificação final do banco e do tópico de falhas](central-history-dispatch-snapshot.json)

Para reproduzir, use os comandos da rodada com histórico abaixo, substituindo o projeto por `central-history-dispatch` e a porta por `4395`.

## Reprodução

Partindo da raiz do projeto com Docker, Node 22+, dependências e o arquivo local `.env`:

```sh
HELPDESK_PORT=4393 docker compose -p central-history-empty up -d --build
# Com API e consumidores prontos e banco de teste vazio:
MIXED_PROJECT=central-history-empty node --env-file=.env scripts/mixed.js
MIXED_PROJECT=central-history-empty node scripts/history-snapshot.js
docker compose -p central-history-empty stop

HELPDESK_PORT=4394 docker compose -p central-history-aged up -d --build
# Com API e consumidores prontos e banco de teste vazio:
docker compose -p central-history-aged exec -T db psql -X -U helpdesk < scripts/history-seed.sql
MIXED_PROJECT=central-history-aged node --env-file=.env scripts/mixed.js
MIXED_PROJECT=central-history-aged node scripts/history-snapshot.js
docker compose -p central-history-aged stop
```

Os dois projetos precisam de volumes novos em uma reprodução. O comando de parada conserva os volumes para inspeção. A aplicação de demonstração usa outro projeto e outra porta.
