# Roteiro da apresentação à banca

**Duração: 4min40s, com 20 segundos de margem.** Sete slides principais; quatro slides ocultos para perguntas. Sem demonstração ao vivo durante o pitch.

[Abrir os slides](Central-HelpDesk-Banca.pptx)

## Tese do pitch

Eu construí o fluxo, aumentei a exigência dos testes, encontrei os gargalos e conferi a integridade após as correções. A arquitetura explica as decisões; os resultados sustentam a apresentação.

**Ênfase:** 3min35s para testes, diagnóstico e resultados. Narre em primeira pessoa e use cada número para explicar uma decisão.

## Preparação

- Abra o PowerPoint em modo apresentador, com as notas e o cronômetro.
- Os prints já estão incorporados: a apresentação não depende do servidor ou do navegador.
- Deixe o repositório e os relatórios disponíveis para as perguntas. O painel é opcional.

## Slide 1 · Fluxo em prints

**0:00–0:15 · 15 segundos**

### Fala

Eu construí um help desk que leva o relato do cliente até o analista com o contexto preservado. Mas a interface funcionando era só o começo. Minha principal pergunta foi: esse fluxo continua correto quando entram centenas de conversas por segundo?

### No slide

Aponte o relato à esquerda e o histórico à direita. Não saia dos slides.

### Evidências

Capturas do painel local; dados de demonstração.

## Slide 2 · Arquitetura

**0:15–0:50 · 35 segundos**

### Fala

Para responder, eu testei este caminho inteiro. A API em Go grava a mensagem e a outbox juntas no PostgreSQL. O worker envia o webhook; a ponte publica no Kafka; o agente simulado responde; e a ponte devolve o resultado para gravação. A inbox protege contra reentregas. Essas peças permitem retomar trabalho, mas também criam pontos de espera. Então eu medi desde a entrada até a resposta persistida, além da latência da API.

### No slide

Acompanhe a ida e a volta no diagrama.

### Evidências

[results/CARGA-SUSTENTADA.md](results/CARGA-SUSTENTADA.md) · [results/CARGA-MISTA-OTIMIZADA.md](results/CARGA-MISTA-OTIMIZADA.md)

## Slide 3 · Simulador em um print

**0:50–1:05 · 15 segundos**

### Fala

Também construí um simulador de regras: consigo conferir quem muda de fila antes de publicar. Neste print, três cenários da InfinitePay mudam, sem afetar a JIM. O simulador e o atendimento usam o mesmo motor de decisão.

### No slide

Aponte a comparação e siga. A demonstração ao vivo fica opcional para as perguntas.

### Evidências

Captura do painel local; resultados do simulador de 48 cenários.

## Slide 4 · Primeiro gargalo: primeira resposta

**1:05–2:05 · 60 segundos**

### Fala

Primeiro, eu aumentei a carga até encontrar uma falha. A 400 aberturas por segundo, a API respondia em 14 milissegundos no p95, mas o cliente esperava 14,252 segundos pela resposta persistida. Medir só o endpoint teria escondido o problema. Nos logs, encontrei conexões esgotadas; no Kafka, atraso no retorno. Limitei o pool e distribuí a leitura pelas três partições. O p95 caiu para 3,038 segundos, mas ainda havia pendência. Conferi onde os eventos estavam: 1.184 de 1.185 casos sem resposta aguardavam na outbox. O plano SQL mostrou uma varredura de registros antigos. Criei um índice parcial dos pendentes e repeti: 75 milissegundos. São rodadas locais com históricos diferentes; os contadores e o plano de execução sustentam o diagnóstico.

### No slide

Aponte cada barra e depois a contagem de pendências na outbox.

### Evidências

[results/CARGA-SUSTENTADA.md](results/CARGA-SUSTENTADA.md) · [results/retest-400-parallel.json](results/retest-400-parallel.json) · [results/retest-400-indexed.json](results/retest-400-indexed.json)

## Slide 5 · Carga mista: consultas e gravação

**2:05–3:05 · 60 segundos**

### Fala

Depois eu tornei o teste mais exigente: cinco minutos a 400 novas conversas por segundo, duas mensagens por cliente e dezesseis analistas simultâneos. O sistema voltou a falhar: p95 de 123,9 segundos e mais de 32 mil respostas pendentes no corte. Investiguei as consultas de histórico e a gravação do retorno. Troquei leituras repetidas por uma consulta leve de estado com espera adaptativa, agrupei as gravações SQL e passei a confirmar offsets em intervalos de cem milissegundos. No reteste, observei 707 milissegundos e zero respostas pendentes ao final. Não atribuo o ganho a uma única mudança: o padrão de consulta também mudou. E não considerei a rodada aprovada: o gerador tinha pulado 143 chegadas. Eu precisava comprovar as 120 mil conversas, não apenas as que ele conseguiu enviar.

### No slide

Leia as três linhas da tabela; explique a mudança e reconheça o critério que ainda falhou.

### Evidências

[results/CARGA-MISTA-OTIMIZADA.md](results/CARGA-MISTA-OTIMIZADA.md) · [results/mixed-fixed.json](results/mixed-fixed.json) · [results/mixed-optimized.json](results/mixed-optimized.json)

## Slide 6 · Concorrência dos analistas

**3:05–4:00 · 55 segundos**

### Fala

Também testei a fila com seis meses de histórico sintético: 360 mil casos encerrados. A carga revelou mais de 26 mil conflitos entre analistas que escolhiam o mesmo chamado numa lista desatualizada. O banco já impedia a dupla atribuição, mas o fluxo desperdiçava tentativas. Eu mudei a operação: agora o servidor reserva o próximo caso por marca, equipe e prioridade. FOR UPDATE SKIP LOCKED permite pular linhas que outro analista está reservando, e a auditoria é gravada na mesma transação. Repeti a carga com histórico: zero conflitos e exatamente uma atribuição em cada um dos 24 mil casos humanos. Eu também medi o custo: a listagem ficou um pouco mais lenta, enquanto a espera dos urgentes caiu.

### No slide

Aponte SQL, conflitos e auditoria. Não descreva conflito anterior como dupla atribuição: a proteção já existia.

### Evidências

[results/HISTORICO-E-FILA.md](results/HISTORICO-E-FILA.md) · [results/central-history-aged.json](results/central-history-aged.json) · [results/central-history-dispatch.json](results/central-history-dispatch.json)

## Slide 7 · Resultado e limites

**4:00–4:40 · 40 segundos**

### Fala

Na rodada final com histórico, eu confirmei 120 mil conversas abertas e encerradas, sem chegadas puladas nem conflitos. Conferi também os 240 mil eventos: todos tiveram retorno, e outbox, lag e tópico de falhas terminaram zerados após a drenagem. O teste percorre o backend real; agente, canais e analistas são simulados. Isso não prova escala em produção. O que eu entrego é uma implementação com evidência reproduzível: consigo explicar onde ela falhou, por que fiz cada mudança e como verifiquei que o resultado continuou correto.

### No slide

Encerre até 4:40. Os 20 segundos restantes absorvem pausas.

### Evidências

[results/HISTORICO-E-FILA.md](results/HISTORICO-E-FILA.md) · [results/central-history-dispatch.json](results/central-history-dispatch.json) · [results/central-history-dispatch-snapshot.json](results/central-history-dispatch-snapshot.json)

## Perguntas técnicas

Use os quatro slides ocultos para consistência, detalhes da carga mista, recuperação e limites da evidência. Os relatórios em `results/` contêm método, comandos e arquivos brutos.

- **O teste provou escala em produção?** Não. Mediu uma instalação local e um perfil sintético.
- **400/s significa requisições HTTP?** Não: novas conversas por segundo. Cada uma provoca várias requisições, eventos e gravações.
- **O teste simulou o front?** Exercitou as APIs e o fluxo de negócio; não mediu renderização do navegador.
- **Aumentar o teto do gerador explica a aprovação?** Não isoladamente: na confirmação, o pico observado ficou abaixo do teto antigo. Houve variação entre rodadas.
- **A entrega é exatamente uma vez?** Há possibilidade de reentrega. A inbox transacional deduplica o efeito no banco.
