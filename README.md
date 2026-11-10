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

O motor em `domain.js` é uma função pura: dados do caso + configuração → fila, equipe, prioridade e motivo. A primeira regra compatível vence. Sem correspondência, a fase IA usa a fila automática; escalações usam o padrão da marca. Publicar gera uma versão imutável. Casos existentes mantêm seu destino até uma nova decisão. Remover uma regra ou editar uma fila não reescreve o histórico.

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

Este experimento avalia roteamento e recuperação em uma máquina. Não mede o volume de produção da CloudWalk. A execução usa um nó de banco e um nó de mensageria, sem alta disponibilidade; o worker embutido na API processa um evento por vez. O mock classifica o assunto inicial com palavras-chave e recebe o histórico integral; isso não é adequado para conversas ilimitadas. O painel usa atualização periódica, com até 250 casos por consulta. Há um único rascunho compartilhado: múltiplos editores podem sobrescrever alterações antes da simulação. As identidades de equipe usam um código local compartilhado, não SSO corporativo.

Para evoluir: aumentar carga progressivamente, medir atraso por partição e latência de ponta a ponta sob indisponibilidade prolongada, testar workers independentes, paginar históricos e acrescentar autenticação individual e controle concorrente de edição. O frontend é HTML/CSS/JS sem build; `public/ui.js` contém as três telas. A API/worker está em `server.js`, a ponte e o consumidor em `integration.js`, o modelo relacional em `schema.sql`, e as versões das dependências em `package-lock.json`.

## Identidade da demonstração

A interface usa o [site institucional da CloudWalk](https://www.cloudwalk.io/) como referência: logotipo institucional, base em preto e branco e acentos em laranja. O grafismo orbital é original do projeto. Os arquivos visuais são servidos localmente; esta aplicação é uma demonstração acadêmica, sem vínculo com sistemas de produção.
