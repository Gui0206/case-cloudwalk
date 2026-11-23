# Roteiro da apresentação à banca

**Duração-alvo: 4min30s, com 30 segundos de margem.** Sete slides principais; quatro slides ocultos para perguntas. Sem demonstração ao vivo durante o pitch. Os tempos são metas de ensaio, não uma duração medida da sua fala.

[Abrir os slides](Central-HelpDesk-Banca.pptx)

## Tese do pitch

O fluxo precisa continuar correto sob carga. Eu medi o caminho completo, encontrei os gargalos e conferi a integridade após as correções.

Aprofunde duas histórias: **a espera escondida depois da API** e **a disputa entre analistas**. Os outros ajustes mostram a evolução dos testes, sem virar uma lista de tecnologias.

Três resultados para a banca guardar: **400 novas conversas por segundo**, **120 mil conversas encerradas** e **zero conflitos no reteste**. Os valores de latência explicam o primeiro diagnóstico; os demais números ficam como evidência visual e apoio para perguntas.

## Preparação e entrega

- Abra o PowerPoint em modo apresentador, com notas e cronômetro. Os prints já estão incorporados.
- Ensaie em voz alta. Não tente preencher cada segundo: use pausas nos contrastes e no resultado final.
- Conte o que você investigou e decidiu. Não leia as tabelas nem enumere as caixas do diagrama.
- Se chegar ao slide 5 depois de 2:15, resuma-o: “Ampliei o teste para várias mensagens e analistas simultâneos. Corrigi consultas e gravações, mas só aceitei o resultado depois de conferir também as chegadas emitidas pelo gerador.”
- Guarde a mecânica dos pools, partições, CTEs e offsets para as perguntas. Os relatórios em `results/` contêm método, comandos e dados brutos.

## Slide 1 · Fluxo em prints

**0:00–0:20 · 20 segundos**

### Fala

Um lojista diz: “meu repasse não caiu”. Ele precisa de uma resposta e, se houver transferência, de um analista que já conheça o problema. Eu construí esse fluxo e fui além da demonstração: testei o que acontece quando chegam 400 novas conversas por segundo.

### No slide

Aponte o relato e o contexto recebido pelo analista. Faça uma pausa após “400 novas conversas por segundo”.

### Evidências

Capturas do painel local; dados de demonstração.

## Slide 2 · Arquitetura

**0:20–0:50 · 30 segundos**

### Fala

Esta arquitetura separa receber a mensagem de processar a resposta. A API em Go grava a mensagem e a intenção de envio juntas no PostgreSQL: essa é a outbox. O worker entrega à ponte, que conecta o webhook ao Kafka. Na volta, a inbox evita duplicar o efeito de uma reentrega. Isso permite retomar trabalho após uma interrupção. Mas aceitar uma mensagem não significa que ela já foi respondida. Foi essa diferença que orientou meus testes.

### No slide

Percorra a ida e a volta sem enumerar todas as caixas. Termine apontando para o retorno persistido.

### Evidências

[results/CARGA-SUSTENTADA.md](results/CARGA-SUSTENTADA.md) · [results/CARGA-MISTA-OTIMIZADA.md](results/CARGA-MISTA-OTIMIZADA.md)

## Slide 3 · Simulador em um print

**0:50–1:10 · 20 segundos**

### Fala

A operação define fila e prioridade por política. Antes de publicar, o simulador avisa se uma regra afeta as duas marcas ou fica encoberta por outra. A publicação registra autor e alterações. Testei as previsões contra o atendimento real e a disputa entre duas publicações simultâneas.

### No slide

Aponte o aviso de alcance entre marcas e a prioridade efetiva. Não leia os cenários. As identidades são de demonstração; o teste exercita o backend real com agente simulado.

### Evidências

[Política, alertas e auditoria](results/POLITICA-E-AUDITORIA.md) · [Verificação funcional](results/policy-check.json)


## Slide 4 · A espera escondida depois da API

**1:10–2:15 · 65 segundos**

### Fala

No primeiro teste a 400 conversas por segundo, a API parecia rápida: 14 milissegundos no p95. Mas a resposta só era gravada cerca de 14 segundos depois, também no p95. Eu poderia ter parado no primeiro número e apresentado um resultado enganoso.

Investiguei onde o trabalho estava esperando. Corrigi o excesso de conexões e o processamento do retorno. Ainda assim, quase todos os casos que continuavam sem resposta estavam parados na outbox.

O plano de execução mostrou o motivo: o banco varria registros antigos para encontrar o próximo evento pendente. Criei um índice parcial, que mantém só o trabalho ainda por enviar. No reteste, a primeira resposta ficou em 75 milissegundos no p95.

As rodadas tinham históricos diferentes, então o gráfico não isola o ganho de cada ajuste. A evidência está também na localização das pendências e no plano SQL. Para o cliente, o que importa é a resposta ficar pronta — não só a API aceitar a mensagem.

### No slide

Contraste a abertura com a resposta. Aponte o índice e a última barra; não narre os valores intermediários. Pause após explicar a varredura de registros antigos.

### Evidências

[results/CARGA-SUSTENTADA.md](results/CARGA-SUSTENTADA.md) · [results/retest-400-parallel.json](results/retest-400-parallel.json) · [results/retest-400-indexed.json](results/retest-400-indexed.json)

## Slide 5 · Um teste mais próximo do uso

**2:15–2:50 · 35 segundos**

### Fala

Depois acrescentei conversas de várias mensagens e analistas trabalhando ao mesmo tempo, por cinco minutos. O sistema voltou a acumular respostas. Reduzi as consultas repetidas de histórico e o trabalho de gravação no retorno; os detalhes estão nos relatórios.

A pendência final zerou, mas ainda não aprovei a rodada: o gerador tinha deixado de enviar parte das chegadas. Para comprovar a carga proposta, eu precisava conferir tanto o sistema quanto o próprio teste.

### No slide

Use a tabela como apoio visual. Aponte a pendência final, sem ler cada número. A ideia central é que o critério de aprovação foi mantido.

### Evidências

[results/CARGA-MISTA-OTIMIZADA.md](results/CARGA-MISTA-OTIMIZADA.md) · [results/mixed-fixed.json](results/mixed-fixed.json) · [results/mixed-optimized.json](results/mixed-optimized.json)

## Slide 6 · Analistas disputando o mesmo chamado

**2:50–3:50 · 60 segundos**

### Fala

O segundo problema foi de concorrência. Dois analistas podiam abrir a mesma lista e escolher o mesmo chamado. O banco já impedia a dupla atribuição, mas um deles recebia conflito e precisava tentar de novo. Sob carga, isso gerou milhares de tentativas desperdiçadas.

Eu mudei a operação: em vez de cada analista escolher um ID da lista, ele pede ao servidor o próximo caso elegível. A seleção respeita marca, equipe e prioridade. Com FOR UPDATE SKIP LOCKED, uma transação pula o chamado que outra já está reservando. A atribuição e sua auditoria são confirmadas juntas.

Repeti a carga com seis meses de histórico sintético. O resultado foi zero conflitos, com exatamente uma atribuição auditada por caso humano. A listagem ficou um pouco mais lenta, mas a espera dos urgentes caiu. O ganho é o analista receber trabalho disponível sem disputar o mesmo caso com o colega.

### No slide

Aponte a operação SQL e depois o zero de conflitos. Dê mais tempo à mudança de responsabilidade, do navegador para o servidor, que às contagens.

### Evidências

[results/HISTORICO-E-FILA.md](results/HISTORICO-E-FILA.md) · [results/central-history-aged.json](results/central-history-aged.json) · [results/central-history-dispatch.json](results/central-history-dispatch.json)

## Slide 7 · Resultado e limites

**3:50–4:30 · 40 segundos**

### Fala

A rodada anterior com histórico encerrou 120 mil conversas. Depois das novas políticas, repeti a carga com banco vazio: outras 120 mil, sem chegadas puladas, conflitos ou prioridades incorretas. Após a drenagem, conferi as atribuições e o retorno de todos os eventos.

É um teste local do backend real, com agente, canais e analistas simulados; não é uma garantia de escala em produção.

O que este case demonstra é como eu trabalho: defino o que precisa ser verdadeiro, testo até encontrar os limites, investigo a causa e repito a medição. Além do fluxo funcionando, entrego evidências para sustentar as decisões de engenharia.

### No slide

Encerre até 4:30, deixando 30 segundos de margem. Na última frase, olhe para a banca; não leia os números restantes do slide.

### Evidências

[results/HISTORICO-E-FILA.md](results/HISTORICO-E-FILA.md) · [results/central-history-dispatch.json](results/central-history-dispatch.json) · [results/central-history-dispatch-snapshot.json](results/central-history-dispatch-snapshot.json) · [Reteste com políticas](results/central-policy-capacity.json) · [Integridade das políticas](results/policy-capacity-snapshot.json)

## Perguntas técnicas

Use os quatro slides ocultos para consistência, detalhes da carga mista, recuperação e limites da evidência. Os relatórios em `results/` contêm método, comandos e arquivos brutos.

- **O teste provou escala em produção?** Não. Mediu uma instalação local e um perfil sintético.
- **400/s significa requisições HTTP?** Não: novas conversas por segundo. Cada uma provoca várias requisições, eventos e gravações.
- **O teste simulou o front?** Exercitou as APIs e o fluxo de negócio; não mediu renderização do navegador.
- **Aumentar o teto do gerador explica a aprovação?** Não isoladamente: na confirmação, o pico observado ficou abaixo do teto antigo. Houve variação entre rodadas.
- **A entrega é exatamente uma vez?** Há possibilidade de reentrega. A inbox transacional deduplica o efeito no banco.
