# Central · Help desk com laboratório de filas

Protótipo individual do case Inteli × CloudWalk. Uma lojista conversa em um canal simulado; um atendente determinístico responde primeiro; quando há escalação, o analista assume com o histórico. O diferencial é testar alterações de roteamento contra casos fictícios antes de publicá-las. Não há acesso à CloudWalk, dados reais, API de LLM nem mensagens enviadas para fora.

## Início rápido no Mac

Instale Docker Desktop com Docker Compose v2. No Finder, abra **iniciar.command**, ou no Terminal:

~~~sh
cd ~/Desktop/Central-HelpDesk
./iniciar.command
~~~

Abra **http://localhost:4380**. O primeiro início baixa as imagens. O script gera senhas internas aleatórias em um arquivo local `.env`; o código de demonstração da equipe é **demo-local**. Para alterá-lo, edite `STAFF_CODE` nesse arquivo e rode o script novamente. Nenhuma dependência Node precisa ser instalada no Mac para usar a aplicação. Não exponha a porta na internet: este é um ambiente didático com seleção simulada de perfis.

Para parar e manter conversas, regras e histórico: `docker compose stop`. Para voltar: `./iniciar.command`. A aplicação usa volumes nomeados para PostgreSQL e Redpanda; remover volumes apaga os dados. O navegador mantém a identidade do cliente por cookie. Use outro perfil de navegador para representar outra pessoa.

## Roteiro da demonstração

1. Em **Operação**, entre com o código de equipe. Abra **Filas e equipes** para ver os destinos e quem os atende. Clique em **Exemplo: repasses**; a regra nova entra no topo. Para demonstrar um erro, troque a marca da regra para **Qualquer**.
2. Clique em **Simular impacto → Só alterações**. No estado inicial, seis cenários mudam: duas marcas × três prioridades. A fila *Repasses BR* receberia também casos JIM. Nada foi publicado ou enviado ao agente.
3. Corrija a marca para **InfinitePay**, simule novamente: agora só três cenários mudam. Confira a regra vencedora em cada linha. Publique. Fila de destino e equipe podem ser editadas pela própria operação.
4. Em **Cliente**, escolha InfinitePay, WhatsApp e envie “Meu repasse não caiu”. O mock pede o identificador da venda. Responda “VENDA-42”. O agente encaminha para análise humana. Para experimentar fechamento automático, pergunte sobre Pix e responda “funcionou”; para forçar uma transferência, peça um humano.
5. Em **Analista**, selecione **InfinitePay / Repasses**, entre, abra o caso e clique em **Assumir caso**. Leia o resumo, responda e encerre. Em *Histórico de decisões*, confira a versão da configuração e a regra de transferência. Volte para **Cliente** para ler a resposta no mesmo atendimento.
6. Repita com JIM: a escalação segue para **Suporte EUA / Atendimento**. Marcas e equipes limitam o acesso do analista; a tela de operação administra ambas.

## O que é requisito e o que é diferencial

| TAPI | Implementação |
|---|---|
| Três canais, múltiplas marcas, dados sintéticos | Uma interface simula chat, WhatsApp e e-mail com identificação do canal de origem. |
| Filas editáveis, triagem, prioridade, distribuição | Editor de filas e equipes, regras ordenadas por marca, assunto, prioridade e etapa; lista de trabalho ordenada por prioridade e atualização. |
| IA como atendente via webhook e broker | Ponte HTTP/Kafka e mock em contêineres separados. Redpanda fornece a API Kafka localmente. |
| Handoff com memória, resumo e histórico | O histórico acompanha a solicitação; o retorno inclui motivo e resumo. Analista assume, responde e encerra o mesmo caso. |
| Auditoria e experimento | Eventos identificam decisão, versão, regra, transferência, responsável e reentrega. Experimentos abaixo. |
| **Diferencial proposto** | **Rascunho persistido, simulação comparativa sem efeitos e publicação da versão revisada.** |

## Arquitetura

~~~mermaid
flowchart LR
  C[Cliente e canais simulados] <--> W[API do help desk]
  H[Painel do analista] <--> W
  W --> R[Motor de regras]
  R --> D[(PostgreSQL: casos, mensagens, regras e auditoria)]
  W --> D
  D --> O[Worker da outbox]
  O -->|Webhook| B[Ponte HTTP e Kafka]
  B --> Q[Tópico de solicitações]
  Q --> A[Agente simulado]
  A --> S[Tópico de respostas]
  S --> B
  B -->|Webhook de retorno| W
  P[Operação: editar e salvar rascunho] --> L[Simulador]
  L <-->|Avalia sem gravar casos| R
  L --> V[Comparar e publicar]
  V --> D
~~~

O motor em [`backend/rules.go`](backend/rules.go) é uma função pura: dados do caso + configuração → fila, equipe, prioridade e motivo. A primeira regra compatível vence. Sem correspondência, a fase IA usa a fila automática; escalações usam o padrão da marca. Publicar gera uma versão imutável. Casos existentes mantêm seu destino até uma nova decisão. Remover uma regra ou editar uma fila não reescreve o histórico.

O simulador avalia 48 combinações fixas: 2 marcas × 4 assuntos × 2 etapas × 3 prioridades. O conjunto é construído em memória, separado de atendimentos e de clientes. A simulação não publica eventos, não altera o responsável e não muda filas reais. A publicação exige a versão base e a assinatura do rascunho avaliado; uma prévia anterior a uma alteração é recusada.

### Dados e entrega de mensagens

- **PostgreSQL:** tickets guardam estado e proprietário, messages guardam a conversa, audit guarda decisões; configs/drafts separam versão ativa de edição. Outbox e inbox controlam entrega e deduplicação. Sessões web também são persistidas.
- **Saída:** gravar a mensagem e o evento é uma única transação. O worker lê eventos confirmados e tenta entregar por webhook. Em caso de falha, registra a tentativa e usa espera crescente até o limite.
- **Integração:** tópicos `desk.requests` e `desk.responses`, três partições cada, chave por atendimento. O mock reproduz regras locais de assunto, solicitação explícita e contexto. Não consulta sistemas financeiros. Sua versão é a do código, sem pesos ou parâmetros de modelo.
- **Retorno:** a API deduplica por identificador do evento e verifica responsável, estado e revisão. Uma resposta atrasada não substitui o analista. A transferência e sua auditoria são confirmadas na mesma transação. Uma falha repetida no consumidor vai para `desk.failed`.
- **Operação:** os contadores na tela da operação refletem o momento de abertura. Para diagnóstico use `docker compose logs --tail=60 web bridge agent`. Inspecione eventos de saída esgotados com `docker compose exec web node scripts/recovery.js outbox`; para repetir um deles, use `retry-outbox UUID` no lugar de `outbox`. Para inspecionar a fila de falhas Kafka: `docker compose exec kafka rpk topic consume desk.failed --brokers kafka:9092 -f '%v\n'` (Ctrl+C para sair). Para reenviar um registro inspecionado salvo como JSON: `docker compose exec -T web node scripts/recovery.js retry-dlq < registro.json`. O reenvio preserva o identificador.

## Experimento reproduzível

**Hipótese:** restringir a nova regra de repasses à InfinitePay muda apenas as escalações pretendidas, e a prévia prevê a fila efetiva de cada caso. Medimos duas coisas separadas: fidelidade entre prévia e runtime, e aderência a destinos esperados definidos no teste independentemente do motor. Comparar apenas o motor consigo mesmo não detectaria uma regra errada.

Para repetir, use Node 22+, Docker e uma **instalação de teste vazia**, separada da principal. Os comandos abaixo usam o projeto Compose `central-helpdesk-test` e porta 4381. O experimento recusa a porta da demonstração e dados preexistentes.

~~~sh
npm ci
npm test
HELPDESK_PORT=4381 docker compose -p central-helpdesk-test up -d --build
npm run experiment
npm run test:faults
npm run test:load
docker compose -p central-helpdesk-test down
~~~

Se já executou o experimento e quiser **apagar apenas os dados de teste** para repetir, rode `docker compose -p central-helpdesk-test down -v`. Aguarde a inicialização da aplicação antes de começar. Se mudou o código de equipe da instalação, passe o mesmo valor em `STAFF_CODE` ao executar o experimento.

**Método:** primeiro, a política sem filtro de marca; depois, a mesma política restrita a InfinitePay. Compara-se a configuração original com o rascunho nos 48 cenários. Após publicar, o script abre 24 conversas distribuídas pelos três canais em lotes de seis; cada conversa passa pela IA e solicita um humano, produzindo 48 decisões reais. Também verifica o bloqueio de uma prévia obsoleta, isolamento entre marcas e resposta do analista. O teste de falha complementar desliga o agente, aceita uma mensagem, religa o agente, reentrega o evento e injeta um retorno atrasado.

**Resultados:** consulte [experimento](results/experiment.json) para contagens e latências medidas e [falhas](results/faults.json) para recuperação e reentrega. Na rodada documentada, a regra ampla desviou seis cenários; a corrigida alterou três. As 48 decisões corresponderam ao esperado. O p95 inclui polling do cliente de teste e o caminho de duas mensagens, da abertura à escalação; não é tempo de resposta de um modelo real.

**Pico de entrada:** o teste adicional envia 120 conversas sintéticas em lotes de 12 requisições simultâneas. Mede a confirmação da API, o maior acúmulo observado na outbox e o tempo até observar a primeira resposta, verificando exatamente uma resposta por caso. Veja [resultado do pico](results/load.json). Os percentis incluem o custo do cliente e, para a resposta, o intervalo entre consultas. Um pico curto não representa carga sustentada, disponibilidade de produção ou tráfego real.

## Limites e evolução

O [teste de carga sustentada](results/CARGA-SUSTENTADA.md) mede a abertura e a primeira resposta com chegadas em taxa fixa, verifica perdas e duplicações por atendimento e registra quando a fila de respostas passa a crescer.

No [reteste a 400 aberturas/s](results/retest-400-indexed.json), a instalação local aceitou e respondeu aos 47.999 casos enviados em dois minutos. O p95 da abertura foi de 6 ms e o da primeira resposta do agente simulado foi de 72 ms. A configuração usa um pool de até 32 conexões por API, três leitores da ponte e um índice parcial na outbox para localizar o próximo evento pendente.

No [teste misto de cinco minutos](results/CARGA-MISTA.md), a API aceitou 119.659 aberturas. Com segundas mensagens e 16 analistas simultâneos, a ponte acumulou respostas e os casos encerrados ocuparam todas as posições visíveis da fila humana. O fluxo completo reprovou a 400 novas conversas/s.

A [correção e o reteste da carga mista](results/CARGA-MISTA-RETESTE.md) mantiveram a fila acessível e elevaram os encerramentos humanos para 17.175. O fluxo completo ainda reprovou a 400 novas conversas/s. A gravação dos callbacks acumulou respostas mesmo com conexões reservadas.

Com [consulta leve e gravação agrupada](results/CARGA-MISTA-OTIMIZADA.md), o reteste de cinco minutos completou todas as 119.857 conversas enviadas, com p95 de 707 ms e 679 ms para a primeira e a segunda resposta. O gerador atingiu seu limite de concorrência em 143 chegadas e a taxa efetiva foi 399,52/s. Na [rodada de confirmação](results/mixed-capacity.json), o gerador enviou as 120.000 chegadas programadas em cinco minutos sem descarte. A aplicação encerrou os 120.000 casos após 1,74 s adicionais e o p95 de ambas as respostas ficou em 119 ms.

O dispatcher em [Go](worker/main.go) usa quatro goroutines por padrão. Cada uma reserva um evento com `FOR UPDATE SKIP LOCKED`, entrega o webhook e confirma o resultado na mesma transação. Enquanto há trabalho, busca o próximo evento imediatamente. A versão anterior aguardava 70 ms após cada entrega. Interromper o processo libera reservas não confirmadas. O identificador original permite deduplicar uma eventual reentrega.

Para comparar concorrências na instalação de teste, execute `WORKERS=4 HELPDESK_PORT=4381 docker compose -p central-helpdesk-test up -d --no-deps worker` e `LOAD_RESULT=results/load-go-4.json npm run test:load`. Repita com 1, 8 e 16. As medições estão em `results/load-go-*.json`. A comparação com `results/load.json` inclui a mudança na espera entre entregas. O backlog é amostrado e o p95 inclui a consulta periódica do cliente.

A API HTTP, o motor de regras, o simulador, a ponte Kafka e o atendente determinístico estão em Go no diretório [backend](backend/). O dispatcher da outbox está em [worker](worker/). O navegador usa JavaScript e os scripts de experimento e recuperação usam Node.js. A API lê o cookie assinado e a tabela de sessões do backend anterior, e utiliza as mesmas tabelas de atendimentos e versões de regras. O experimento de pico cobre uma máquina com banco e mensageria de nó único.

## Identidade da demonstração

A interface usa o [site institucional da CloudWalk](https://www.cloudwalk.io/) como referência: logotipo institucional, base em preto e branco e acentos em laranja. O grafismo orbital é original do projeto. Os arquivos visuais são servidos localmente; esta aplicação é uma demonstração acadêmica, sem vínculo com sistemas de produção.
