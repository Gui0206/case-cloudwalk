# Carga sustentada do help desk em Go

O teste investiga quantos **novos atendimentos por segundo** uma instalação local consegue aceitar e responder mantendo um prazo definido para o experimento. A unidade é uma conversa aberta com uma mensagem de cliente. Cada abertura percorre API, PostgreSQL, outbox, webhook, Kafka, agente simulado e callback até a gravação da primeira resposta.

## Método

- Docker Desktop com 12 CPUs e 7,65 GiB disponíveis para a VM. O Compose de teste usa a porta 4382 e volumes próprios. Um nó PostgreSQL, um Redpanda, uma API, uma ponte, um agente e um dispatcher com quatro goroutines. A demonstração pessoal continua na porta 4380.
- 32 sessões de lojista reutilizadas, duas marcas, três canais simulados e assunto Pix. A cada cinco casos, um pede transferência humana. O teste inclui a entrada na fila humana. Conversas posteriores e o trabalho do analista estão fora desta medição.
- O gerador agenda chegadas pelo relógio, independentemente das respostas anteriores. Acima de 200 requisições HTTP simultâneas, contabiliza as chegadas que não conseguiu disparar. Cada etapa dura um minuto. As taxas planejadas são 10, 25, 50, 100, 200 e 400 aberturas/s. Ao primeiro patamar reprovado, o gerador interrompe a subida e, se a fila drenou, repete o maior patamar aprovado por dois minutos. O banco acumula o histórico entre etapas.
- Critério experimental: pelo menos 99% da taxa oferecida, zero erros de criação, uma resposta por atendimento aceito, número esperado de transferências, zero falhas definitivas na outbox, p95 até a resposta de no máximo dois segundos e pendência total ao fim da carga de no máximo dois segundos de chegadas. O TAPI não especifica esse prazo.
- A latência de abertura usa o relógio do cliente HTTP. A latência de resposta usa a diferença entre timestamps de início das transações PostgreSQL da mensagem inicial e da primeira resposta. Ela exclui a espera pela próxima atualização do navegador. O script conserva p50, p95 e p99. As consultas de acompanhamento rodam a cada dois segundos. A integridade é conferida por atendimento depois de até 90 segundos adicionais de drenagem.

## Resultados

| Chegadas/s | Duração | Casos aceitos / oferecidos | p95 abertura | p95 resposta | Aguardando resposta ao parar |
|---:|---:|---:|---:|---:|---:|
| 10 | 60 s | 600 / 600 | 13 ms | 72 ms | 0 |
| 25 | 60 s | 1.500 / 1.500 | 10 ms | 71 ms | 0 |
| 50 | 60 s | 3.000 / 3.000 | 6 ms | 70 ms | 0 |
| 100 | 60 s | 6.000 / 6.000 | 5 ms | 74 ms | 0 |
| 200 | 60 s | 12.000 / 12.000 | 5 ms | 75 ms | 3 |
| 400 | 60 s | 23.873 / 24.000 | 14 ms | 14.252 ms | 5.695 |
| 200 | 120 s | 24.000 / 24.000 | 5 ms | 74 ms | 0 |

Todos os 70.973 casos aceitos tiveram exatamente uma primeira resposta na conferência final. A confirmação a 200/s terminou com 4.800 transferências e p99 de 199 ms até a resposta. A 400/s, a drenagem de todos os aceitos foi observada cerca de 11 segundos após o fim da entrada. Entre as taxas ensaiadas, 200/s foi a maior aprovada e 400/s a primeira reprovada. O ponto de transição entre as duas taxas continua em aberto.

Os dados de cada etapa, incluindo erros HTTP, latências e evolução da pendência, estão em [sustained.json](sustained.json). As amostras dos consumidores Kafka estão em [sustained-lag.json](sustained-lag.json).

## Diagnóstico da sobrecarga

Na etapa de 400/s, os logs da API registraram 127 ocorrências de `pq: sorry, too many clients already`. O PostgreSQL estava configurado com `max_connections=100`. O dispatcher limita seu próprio pool a quatro conexões. A API usa o pool de `database/sql` sem definir `SetMaxOpenConns`. O primeiro ajuste a testar é reservar conexões para o dispatcher e administração e impor um orçamento ao pool da API, medindo a espera e os erros após a mudança.

Ao encerrar a entrada a 400/s, a outbox estava vazia e 5.695 casos aceitos ainda aguardavam resposta. A maior amostra de atraso do grupo que lê `desk.responses` nessa etapa foi de 5.520 eventos. Na mesma amostra, o grupo que lê `desk.requests` estava em dia. A ponte confirma cada offset após aguardar o callback HTTP. Essa observação localiza a pendência no retorno Kafka → ponte → API/PostgreSQL. Para separar o custo de cada componente, medir a duração do callback e do commit de offset e repetir o teste variando uma configuração por vez.

## Alcance para o TAPI

O projeto tem evidência reproduzível de milhares de novas conversas, respostas automáticas, transferências por duas marcas, auditoria e integridade sob pico. O experimento de regras e o teste de falhas existentes complementam esta medição. Para avaliar estabilidade no perfil operacional do parceiro, ainda faltam a taxa de pico e o prazo de resposta de referência, um ensaio prolongado com conversas de várias mensagens, painel de analistas ativo, clientes e histórico em escala maior e recuperação de falhas durante carga. O agente e os canais são simulados conforme o escopo acadêmico.

## Comandos

Com o arquivo local `.env` gerado pelo iniciador, a partir da raiz do projeto:

```sh
HELPDESK_PORT=4382 docker compose -p central-sustained up -d --build
npm run test:sustained
docker compose -p central-sustained stop
```

Em outro terminal, `node scripts/sustained-lag.js` coleta a diferença entre eventos publicados e posições confirmadas pelos grupos do agente e da ponte a cada cinco segundos. Interrompa com Ctrl+C após o experimento. A primeira execução começou com volumes vazios. Reutilizar volumes altera a quantidade de histórico no PostgreSQL. Os scripts sobrescrevem os respectivos arquivos JSON de resultados.
