# Carga mista com consulta leve e gravação agrupada

## Alterações

O endpoint autenticado `GET /api/tickets/:id/status` retorna estado, revisão, responsável, identificador e autor da última mensagem, horário de atualização e, para a equipe, identificador do último evento de auditoria. Ele usa os índices do atendimento, das mensagens e da auditoria. O controle de acesso segue o histórico completo. Uma mudança apenas na auditoria também é detectada.

O navegador consulta esse estado antes de baixar o histórico completo. Quando ele permanece igual, aumenta o intervalo até oito segundos. A seleção ou ação explícita permite uma atualização imediata. O painel continua consultando a lista de casos. O teste de carga usa o estado leve para aguardar a primeira resposta e aumenta o intervalo entre consultas sem resposta, de 800 ms até oito segundos. Na rodada final, quando detecta a resposta, o cliente faz uma leitura completa e verifica a presença de texto da IA antes de enviar a segunda mensagem.

O callback continua bloqueando o atendimento, deduplicando o evento e verificando fase, revisão e encerramento na mesma transação. Para uma resposta válida, a inserção da mensagem, a inserção da auditoria e a atualização do caso são executadas em uma instrução PostgreSQL com CTEs. Isso reduz duas idas ao banco em cada resposta válida. O commit da transação continua precedendo o sucesso HTTP devolvido à ponte.

A ponte mantém três leitores e processa sequencialmente os eventos de cada leitor. Após um callback concluído, marca a posição processada. A biblioteca kafka-go v0.4.49 agrupa essas posições e tenta confirmá-las no broker a cada 100 ms. Uma interrupção antes da confirmação pode causar reentrega, tratada pela inbox transacional. O leitor registra falhas de confirmação nos logs. A métrica `offset` agora mede a marcação local para confirmação assíncrona. Ela deve ser interpretada junto com `commitIntervalMs`; a medição anterior incluía a confirmação síncrona no broker.

## Método

Mantidos 400 novos atendimentos/s por 300 segundos, duas marcas, três canais simulados, uma categoria, duas mensagens por cliente, 20% de pedidos de humano, 128 sessões de cliente, 96 tarefas de acompanhamento e 16 sessões de analista. O teste começa com banco vazio e admite até 120 segundos adicionais de drenagem. Os critérios de latência, encerramento, ordem e integridade são os mesmos do [reteste anterior](CARGA-MISTA-RETESTE.md).

O método de acompanhamento mudou para exercitar a consulta leve e a espera adaptativa. Por isso, a comparação avalia o conjunto de alterações na aplicação e no padrão de consulta, sem atribuir todo o ganho às alterações da ponte. A taxa de novas conversas e as mensagens de negócio mantiveram o mesmo perfil.

As instalações dos testes anteriores permanecem paradas durante a carga. O Docker disponibiliza 12 CPUs e 7,65 GiB para a VM. A aplicação de demonstração fica na porta 4380. Este ensaio usa o projeto isolado `central-mixed-conversation` na porta 4387, com os pools de 32 conexões públicas e oito reservadas para callbacks.

## Reprodução

```sh
HELPDESK_PORT=4387 docker compose -p central-mixed-conversation up -d --build
MIXED_PROJECT=central-mixed-conversation node --env-file=.env scripts/mixed.js
docker compose -p central-mixed-conversation stop
```

Aguarde a inicialização dos consumidores e da API. O gerador verifica a porta e exige banco sem atendimentos. As medições e os contadores de diagnóstico ficam em [mixed-optimized.json](mixed-optimized.json).

Em uma instalação de teste na porta 4381, `scripts/status-check.js` confere estado inalterado, mudanças de mensagem e de auditoria, isolamento de acesso, encerramento e preservação do histórico completo. O experimento de 48 decisões e o teste de recuperação, duplicação e retorno obsoleto passaram com esta versão antes da carga.

A verificação adicional de reinício abrupto, em `scripts/bridge-restart.js`, acumulou 512 pedidos e encerrou a ponte com SIGKILL durante o processamento das respostas. Havia 279 respostas persistidas ao reiniciar. Depois de a ponte recuperar o trabalho e confirmar os offsets, os 512 casos apresentavam exatamente uma mensagem de cliente seguida de uma resposta e uma única decisão auditada. O ensaio cobre o resultado observável de uma interrupção com trabalho pendente. O teste de reentrega explícita cobre a deduplicação do evento repetido.

## Rodada diagnóstica

A [rodada com leitura apenas do estado](mixed-status-only.json) detectou a chegada da resposta antes de enviar a segunda mensagem. Todos os 119.841 casos enviados receberam as duas respostas e foram encerrados. A API aceitou todas as tentativas, mas o gerador deixou de enviar 159 das 120.000 chegadas planejadas, e o critério estrito reprovou a rodada. Os p95 foram 521 ms e 511 ms. Esta rodada deixou de ler o corpo da resposta, uma diferença em relação ao comportamento do navegador. A rodada final inclui essa leitura do histórico e usa outro banco inicialmente vazio.

## Resultado final com leitura do conteúdo

A instalação aceitou e encerrou **119.857 conversas**. A taxa enviada foi de **399,52 aberturas/s** ao longo de cinco minutos. O gerador descartou 143 das 120.000 chegadas programadas quando atingiu o teto de 160 aberturas simultâneas. O critério estrito de processar todas as chegadas e atingir os totais planejados de encerramentos reprovou a rodada. O teste não identifica isoladamente a causa de cada pico de concorrência no gerador.

Ao parar a entrada, 119.854 aberturas já haviam retornado ao cliente, 119.526 segundas mensagens tinham sido enviadas e 23.894 casos estavam encerrados por analistas. A conferência final foi feita com o fluxo drenado aos 301,74 s. Todos os casos enviados tiveram as duas respostas e o encerramento esperado. Os 16 analistas encerraram casos.

| Medida | Reteste anterior | Agora |
|---|---:|---:|
| Aberturas aceitas | 119.978 | 119.857 |
| p95 de abertura | 52 ms | 19 ms |
| p95 da primeira resposta | 123,9 s | 707 ms |
| p95 da segunda resposta | 113,0 s | 679 ms |
| Segundas respostas persistidas | 86.184 | 119.857 |
| Encerramentos automáticos | 68.945 | 95.884 |
| Encerramentos humanos | 17.175 | 23.973 |
| Respostas pendentes no corte final | 32.485 | 0 |
| Leituras completas de histórico pelos clientes | 1.659.152 | 119.857 |

O gerador fez 125.022 consultas leves e 119.857 leituras completas para conferir o corpo da primeira resposta. A queda nas leituras completas de clientes foi de **92,8% por rodada**. Os p95 das respostas são tempos até a gravação no PostgreSQL. A exibição no navegador depende da próxima consulta. As duas rodadas tiveram o mesmo tempo de entrada e drenagens diferentes. Na anterior, os percentis também excluíam as respostas ainda pendentes no corte.

A comparação dos contadores de diagnóstico, incluindo a drenagem, mostrou:

| Média por callback | Anterior | Agora |
|---|---:|---:|
| Callback HTTP completo | 5,47 ms | 3,00 ms |
| Início da transação | 0,29 ms | 0,18 ms |
| Processamento SQL | 3,24 ms | 1,50 ms |
| Commit no PostgreSQL | 1,34 ms | 0,94 ms |
| Callbacks concluídos por segundo | 482 | 796 |

O pool reservado registrou zero esperas por vaga. A outbox terminou sem eventos pendentes ou falhos. Houve 23.677 respostas HTTP 409 ao tentar assumir casos a partir de listas desatualizadas e nenhum outro erro HTTP registrado. As 143 chegadas descartadas não chegaram a ser requisições HTTP.

A verificação dos históricos encontrou 95.884 sequências completas de encerramento automático e 23.973 sequências completas com resposta humana. Uma consulta independente à auditoria conferiu os 119.857 casos: cada automático tinha uma triagem e duas decisões da IA; cada humano tinha uma triagem, uma decisão inicial, uma transferência, uma atribuição e um encerramento. Nenhum atendimento ficou aguardando analista.

A comparação combina consulta leve, leitura adaptativa, gravação agrupada e confirmação assíncrona de offsets. Ela demonstra o comportamento desta instalação e deste perfil sintético. Não mede o limite absoluto do servidor nem comprova 400 aberturas enviadas por segundo sem descarte pelo gerador.
