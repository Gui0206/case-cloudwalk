# Roteiro da apresentação à banca

Meta de 4min30s, com 30 segundos de margem até o limite de cinco minutos. Sete slides na sequência principal e quatro slides ocultos para perguntas. Avanço manual.

[Abrir o PowerPoint](Central-HelpDesk-Banca.pptx)

## Preparação

- Abra o painel em http://localhost:4380 e entre em Operação com o perfil de demonstração.
- Prepare **Exemplo: repasses** com a marca **Qualquer** e clique em **Simular impacto**. Confira seis mudanças antes de começar. A contagem pressupõe as regras iniciais.
- Deixe o PowerPoint em modo de apresentação e o painel pronto em outra janela.
- Use o cronômetro do modo apresentador. Faça uma única saída para o navegador, no slide 3.

## Slide 1 · Problema

0:00–0:20 · 20 segundos · Permanecer nos slides.

### Fala


“A lojista relata o problema uma vez. O agente faz a triagem e, quando precisa de ajuda humana, o analista assume com o histórico na equipe correta. Construí essa plataforma e testei tanto as decisões de roteamento quanto o atendimento sob carga.”

### Antes de começar

Deixe o painel em http://localhost:4380 aberto em Operação, autenticado. Prepare o exemplo de repasses com marca Qualquer e a prévia de seis mudanças, partindo das regras iniciais. Confira isso antes de iniciar o cronômetro. O próximo slide é a arquitetura.
Meta do roteiro completo · 4min30s. Margem até o limite · 30 segundos. Trocas manuais.

## Slide 2 · Arquitetura

0:20–1:20 · 60 segundos · Permanecer nos slides.

### Fala


“Acompanhe ‘meu repasse não caiu’. A API em Go salva a fala no PostgreSQL. Na mesma transação, grava o envio na outbox. Se a API cair depois, o worker ainda encontra o que falta entregar.
O worker envia um webhook. A ponte traduz HTTP para Kafka e publica o pedido no Redpanda. O agente pode ler depois, inclusive após uma pausa. Ele recebe o histórico e publica a resposta em outro tópico.
A ponte entrega o retorno à API. A inbox reconhece o ID quando uma entrega se repete, evitando duplicar a fala. Quando há transferência, a API aplica as regras e o caso aparece para a equipe responsável. O agente e os canais são simulados neste protótipo.”

### Ação

Aponte a ida e a volta no desenho. Avance para o slide do simulador e faça uma única saída para o navegador.

## Slide 3 · Simulador de regras

1:20–2:05 · 45 segundos, incluindo a saída e a volta do painel.

### Fala e cliques


“Quero mandar os repasses da InfinitePay para especialistas.”

Saia para o painel já preparado em Operação. Mostre Simular impacto com a marca Qualquer e Só alterações.

“Essa regra também afeta a JIM. O simulador mostra seis destinos alterados.”

Clique em **Voltar às regras**, troque a marca para InfinitePay e clique em Simular impacto.

“Com o filtro, mudam três destinos. A operação compara a política publicada com o rascunho antes de publicar. O mesmo motor decide o destino no atendimento, e a auditoria guarda a regra e a versão.”

Volte aos slides até 2:05 e avance para o gráfico de latência.
Se o painel estiver indisponível, use os valores seis e três deste slide e prossiga no mesmo horário. A publicação e a abertura de casos podem ser demonstradas nas perguntas.

## Slide 4 · Investigação da latência

2:05–3:00 · 55 segundos · Permanecer nos slides.

### Fala


“A 400 aberturas por segundo, a API aceitava em 14 milissegundos no p95, mas a primeira resposta levava 14,252 segundos. O p95 é o limite de tempo observado para 95% dos casos.
Investigamos cada espera. Limitamos o pool de conexões e passamos a ler três partições de respostas em paralelo. O p95 caiu para 3,038 segundos.
Ainda havia pedidos parados. Dos 1.185 casos sem resposta, 1.184 aguardavam na outbox. O banco varria registros antigos para localizar o próximo envio. Um índice só dos pendentes reduziu essa busca. Na rodada seguinte, o p95 foi de 75 milissegundos.”

### Ação

Aponte as barras conforme descreve as intervenções. São rodadas sequenciais em ambiente local, com históricos diferentes. Avance para a atribuição do próximo caso.

## Slide 5 · Disputa entre analistas

3:00–3:30 · 30 segundos · Permanecer nos slides.

### Fala


“Na fila humana, Ana e Bruno podiam carregar a mesma lista e escolher o mesmo chamado. O banco protegia o responsável, mas um deles recebia conflito e precisava tentar novamente.
O painel passou a pedir o próximo caso. A API escolhe por marca, equipe e prioridade. FOR UPDATE SKIP LOCKED permite pular uma linha que outro analista já está reservando. Atribuição e auditoria são confirmadas juntas.”

### Ação

Aponte a consulta e avance para o resultado do reteste.

## Slide 6 · Resultado do reteste

3:30–3:50 · 20 segundos · Permanecer nos slides.

### Fala


“Repetimos a carga com 360 mil casos encerrados de histórico sintético. Os conflitos caíram de 26.281 para zero. A auditoria confirmou exatamente uma atribuição para cada um dos 24 mil casos humanos. Conferimos também que os eventos novos terminaram processados.”

### Ação

Aponte o antes e depois e avance para o resultado de vazão.

## Slide 7 · Vazão e alcance da evidência

3:50–4:30 · 40 segundos · Encerrar neste slide.

### Fala


“No fluxo completo, cada cliente enviou duas mensagens e os analistas trabalharam ao mesmo tempo. A primeira rodada otimizada encerrou 119.857 conversas. As 143 restantes tinham sido puladas pelo próprio gerador.
Ajustamos o limite de aberturas simultâneas e repetimos. Foram 120 mil conversas abertas e encerradas em uma janela de cinco minutos de chegadas, com mais 1,74 segundo para terminar o trabalho em andamento.
A evidência é de um ambiente Docker local com PostgreSQL e Redpanda de nó único, agente e canais simulados. O case reúne previsão das regras, decisões auditáveis e testes reproduzíveis do fluxo completo.”

### Encerramento

Pare até 4:30. Os 30 segundos restantes absorvem pausas e transições. Os próximos quatro slides estão ocultos e disponíveis para aprofundar respostas às perguntas.

## Slides de apoio

Os slides 8 a 11 estão ocultos na apresentação normal. Abra-os manualmente durante as perguntas para detalhar consistência, gargalos da carga mista, recuperação do agente e limites do ambiente medido.

## Se a demonstração atrasar

Até 2:05, volte ao PowerPoint. O slide 3 contém os dois resultados da simulação e permite continuar a explicação. Termine o roteiro até 4:30 e use a margem de 30 segundos para transições.
