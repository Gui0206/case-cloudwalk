# Reteste da fila humana e da gravação de respostas

## Correções e diagnóstico

A lista do analista passou a selecionar os estados “Aguardando analista” e “Em atendimento” antes da ordenação e do limite. O painel oferece uma consulta separada de encerrados, com páginas de 250 casos em ambas as listas e desempate por ID. Dois índices parciais seguem as condições e a ordem dessas consultas. A auditoria ganhou um índice por atendimento e número do evento.

O teste de regressão foi executado nos dados existentes da carga anterior, com mais de 250 encerrados por marca. Conferiu duas páginas distintas de casos ativos, duas páginas de encerrados, histórico acessível, isolamento por marca e rejeição de offset negativo. Os planos do PostgreSQL usaram os índices da fila ativa e da auditoria.

Uma rodada exploratória com essas correções mostrou novo acúmulo. Na amostra inicial, o callback HTTP consumia em média 6,3 ms, com 1,9 ms para começar a transação e 2,8 ms no processamento SQL. O pool público estava no limite de 32 conexões e acumulava fechamentos de conexões ociosas. A rodada foi interrompida após cerca de 90 segundos para ajustar o orçamento de conexões, antes do ensaio completo abaixo.

A API agora mantém até 32 conexões ociosas reutilizáveis e reserva um pool de oito conexões para os callbacks. O dispatcher continua com quatro. O orçamento configurado soma até 44 conexões, mais as administrativas, em uma instalação com uma API e um dispatcher. Os callbacks usam transações com as mesmas verificações de revisão, deduplicação e commit. A reserva evita que as consultas de clientes e analistas consumam todas as vagas disponíveis para gravar as respostas.

## Método e reprodução

O reteste usa o mesmo perfil da [carga mista original](CARGA-MISTA.md), com 400 novas conversas/s por 300 segundos, duas mensagens de cliente por conversa, 20% de solicitações de humano, 128 sessões de cliente, 96 tarefas de acompanhamento e 16 analistas. O banco começa vazio. O projeto Compose `central-mixed-reserved` usa a porta 4385. Mantém os mesmos limites de concorrência, texto, marcas, canais e intervalo de consulta da rodada anterior.

O gerador registra os conflitos HTTP 409 ao assumir um caso a partir de uma listagem desatualizada. O critério de aprovação passou a permitir esses conflitos, pois a recusa impede duas atribuições concorrentes. Outros erros continuam reprovando a rodada. As verificações de mensagens, destinos, encerramentos, latência e pendência foram mantidas. A versão anterior já havia falhado pelos atrasos e pelos casos pendentes.

A cada 15 segundos, o gerador coleta contadores acumulados de tempo do callback HTTP, confirmação do offset Kafka, início da transação, processamento e commit no PostgreSQL, além das estatísticas dos pools. As médias de um intervalo são calculadas pela diferença de duração dividida pela diferença de chamadas. O tempo de início da transação inclui adquirir uma conexão e iniciar a transação. O tempo de processamento inclui o conjunto de consultas do callback. Esses contadores ajudam a localizar a demora, enquanto a latência ponta a ponta inclui as filas anteriores ao callback.

```sh
HELPDESK_PORT=4385 docker compose -p central-mixed-reserved up -d --build
MIXED_PROJECT=central-mixed-reserved node --env-file=.env scripts/mixed.js
docker compose -p central-mixed-reserved stop
```

Aguarde os consumidores e a API iniciarem. Use volumes vazios. Os dados detalhados ficam em [mixed-fixed.json](mixed-fixed.json). Para repetir a verificação da fila nos dados da rodada original, inicie apenas o banco e a API atualizados do projeto `central-mixed`, na porta 4383, e execute `node --env-file=.env scripts/analyst-queue-check.js`.

## Resultado do ensaio completo

O perfil continuou reprovado a 400 novas conversas/s. Foram aceitas todas as 119.978 aberturas enviadas em cinco minutos, com p95 de 52 ms. O gerador atingiu seu limite de concorrência em 22 chegadas e deixou de enviá-las. No corte dos cinco minutos, 87.173 clientes já haviam enviado a segunda mensagem e 14.729 casos estavam encerrados por humanos. A conferência abaixo inclui os dois minutos extras de drenagem.

| Medida no corte final | Anterior | Reteste |
|---|---:|---:|
| Aberturas aceitas | 119.659 | 119.978 |
| Primeiras respostas gravadas | 94.814 | 116.823 |
| Segundas mensagens enviadas | 93.605 | 115.514 |
| Segundas respostas gravadas | 67.639 | 86.184 |
| p95 primeira resposta | 168,3 s | 123,9 s |
| p95 segunda resposta | 139,5 s | 113,0 s |
| Encerramentos humanos | 515 | 17.175 |
| Encerramentos automáticos | 54.109 | 68.945 |
| Casos já escalados aguardando analista | 13.015 | 64 |
| Conversas com sequência inesperada de autores | 0 | 0 |

Os percentis incluem somente respostas gravadas até o corte. Faltavam 3.155 primeiras respostas e 29.330 segundas respostas. Das 23.100 solicitações de humano enviadas, 5.861 ainda aguardavam o callback de escalação, além dos 64 casos já na fila humana. Portanto, a contagem baixa de casos na fila humana deve ser lida junto com a pendência anterior à escalação. Outros 4.464 clientes ainda não haviam enviado a segunda mensagem.

A outbox tinha zero eventos pendentes ou falhos. Houve 13.984 recusas HTTP 409 de tentativas de assumir casos a partir de listas desatualizadas. As outras operações HTTP não registraram erro. Esses conflitos foram contabilizados, e os atrasos e as pendências reprovam o ensaio independentemente da regra que os permite.

## Onde o retorno está demorando

| Etapa medida | Média durante a rodada |
|---|---:|
| Callback HTTP completo, visto pela ponte | 5,47 ms |
| Adquirir conexão e iniciar transação | 0,29 ms |
| Processamento SQL do callback | 3,24 ms |
| Commit no PostgreSQL | 1,34 ms |
| Confirmação do offset Kafka | 0,65 ms |

O pool reservado registrou zero esperas por conexão e usou até três conexões nas amostras. Os dois pools registraram zero fechamentos por excesso de conexões ociosas. A reserva de oito vagas permite margem, mas a ponte continua com três leitores, cada qual aguardando seu callback e a confirmação do offset antes de seguir.

Nos cerca de 421 segundos medidos, a ponte concluiu aproximadamente 482 callbacks/s. O perfil alvo exige aproximadamente 800 callbacks/s quando as duas mensagens por conversa estão em regime estável. A maior parcela do callback ficou no processamento SQL e no commit. Nos últimos 15 segundos, o callback completo chegou a uma média de 7,84 ms, com 4,62 ms de processamento e 1,99 ms de commit. A reserva de conexões removeu a espera por vaga desse caminho, mas as operações ainda compartilham CPU e armazenamento do PostgreSQL.

O gerador fez 1.659.152 leituras do histórico de clientes durante o ensaio e a drenagem. Essas consultas se repetem enquanto a resposta não chega. O perfil preserva o polling do teste original. Sua amplificação durante o atraso deve ser considerada ao interpretar o resultado e ao dimensionar a aplicação. O reteste também incluiu a abertura breve de um painel no navegador para verificar a presença dos controles de estado e paginação.

## Próximos limites a tratar

A fila funcional foi corrigida e validada nos dados antigos. A gravação de respostas continua sendo o limite observado para este perfil. Um próximo experimento deve medir o ganho de reduzir consultas repetidas de histórico e de diminuir as idas ao PostgreSQL por callback, junto com a latência do commit. A ponte também tem apenas três leitores sequenciais. Ampliar sua concorrência ou agrupar confirmações de offset exige preservar a ordem por atendimento e testar novamente reentrega, falhas e deduplicação. Essas alterações precisam de medição controlada para determinar qual delas aumenta a vazão útil.

Os testes de recuperação do agente, reentrega e descarte de retorno obsoleto passaram novamente com o pool reservado. O cenário usa canais e IA simulados em uma única máquina. O TAPI pede evidência de escalabilidade e estabilidade diante de milhares de atendimentos diários com picos. Este resultado sustenta a correção da fila e identifica o limite do perfil ensaiado.
