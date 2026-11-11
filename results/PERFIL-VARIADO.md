# Encaminhamento por marca e recuperação durante um pico

## Hipótese

Com uma regra de repasses restrita à InfinitePay, clientes de duas marcas devem receber o destino previsto, manter o histórico e concluir o atendimento mesmo quando o agente reinicia durante o pico. A operação precisa conseguir identificar a regra que produziu cada transferência.

## Decisão demonstrada

Partindo das regras iniciais, uma regra ampla de repasses alterou seis das 48 combinações do simulador. A restrição à InfinitePay preservou as três prioridades da JIM e alterou três combinações. Após a publicação da versão 2, duas conversas com a mesma prioridade, canal e mensagens passaram pelo webhook, broker e agente. A conferência comparou identificador da regra, versão, fila e equipe com o evento de transferência gravado. A tabela mostra os resultados das conversas criadas pelo botão da operação na verificação pelo navegador.

| Marca | Mensagem inicial e resposta do cliente | Destino previsto e observado | Equipe |
|---|---|---|---|
| InfinitePay | Meu repasse não caiu. → VENDA-42 | Repasses BR | Repasses |
| JIM | Meu repasse não caiu. → VENDA-42 | Suporte EUA | Atendimento |

O operador pode expandir **Conversa e decisão** e consultar a justificativa do encaminhamento. O mesmo fluxo foi executado pela API depois da reconciliação do ensaio de carga, para preservar a contagem da amostra principal. [Captura do painel](demonstracao-repasses.png) · [Mensagens, previsões e auditoria dos dois casos automatizados](routing-proof.json)

## Método do ensaio

Distribuímos 6.160 chegadas em 24 períodos com volumes de 30 a 750 conversas. Os volumes e a distribuição de assuntos são hipóteses sintéticas, escolhidas para cobrir horários tranquilos e um pico. Cada atendimento abriu uma nova sessão de cliente. Uma semente fixa determina marca, canal, prioridade, assunto, roteiro e intervalo de interação. O gerador agenda as chegadas pelo relógio e continua emitindo enquanto espera pelas respostas anteriores.

Na execução medida, cada período durou 15 segundos. O máximo programado foi de 50 novas conversas/s e o maior atraso de disparo foi de 6 ms. O agente usa as regras determinísticas do projeto. Cada cliente lê o histórico, verifica o autor e o texto da sua mensagem e só então prossegue. Nos casos humanos, uma sessão autorizada da equipe lê o resumo e o histórico, assume o caso e responde após mais uma mensagem do cliente. Neste ensaio os analistas acessam o caso pelo identificador. O teste separado de 400/s exercita a descoberta de casos na lista do painel.

Os critérios de sucesso incluem o encerramento de todas as conversas emitidas, uma identidade distinta por cliente, a sequência esperada de autores em cada caso, o destino esperado dos handoffs, a presença de resumo e decisão versionada, cobertura das marcas, assuntos, canais e prioridades e igualdade entre eventos enviados e recebidos. O ensaio verifica o destino a partir da marca e do assunto por uma expectativa definida no gerador. As latências são medidas separadamente.

## Resultado

| Medida | Observado |
|---|---:|
| Conversas emitidas / encerradas / clientes distintos no banco | 6.160 / 6.160 / 6.160 |
| Marcas / canais / prioridades / assuntos | 2 / 3 / 3 / 4 |
| Encerramentos automáticos / humanos | 3.107 / 3.053 |
| Eventos na outbox / identificadores processados na inbox | 12.768 / 12.768 |
| Eventos de saída pendentes ou falhos no corte | 0 |
| Maior número de conversas simultâneas em andamento no gerador | 338 |
| Tempo até a resposta da IA, p50 / p95 / p99 | 38 ms / 71 ms / 4.268 ms |
| Duração da conversa até o encerramento observado, p50 / p95 / p99 | 0,91 s / 3,93 s / 6,61 s |

A amostra incluiu 1.498 casos de Pix, 1.532 de repasses, 1.582 de maquininha e 1.548 de outros assuntos. Houve de uma a cinco mensagens de cliente dirigidas ao agente. Em 478 casos, o cliente enviou cinco mensagens ao agente. A troca adicional com o analista é contada separadamente. O gerador registrou zero erros nas verificações e completou o perfil em 360,71 segundos. O tempo de resposta usa a diferença entre os horários de início das transações que gravaram cada par de mensagens. A duração da conversa inclui as esperas sintéticas e o acompanhamento pelo cliente de teste. [Medições por período](varied.json)

Durante o pico, o consumidor do agente foi desligado. Delimitamos a amostra pelas triagens gravadas entre dois números de sequência da auditoria, ambos coletados com o agente parado. Em 5,10 segundos, a API aceitou 255 novos casos nessa janela. Nenhum deles tinha resposta da IA antes do reinício. Todos já tinham a primeira resposta na consulta realizada 573 ms após o retorno do comando de inicialização. Esse tempo inclui a consulta de verificação. O p99 da rodada inclui o atraso durante a falha. [Medição de recuperação](varied-recovery.json)

## Reprodução

Com Docker, Node 22+ e o arquivo `.env` gerado pelo iniciador, use uma instalação de teste com banco vazio e a porta 4390 livre. A partir da raiz do repositório:

```sh
export VARIED_PROJECT="central-varied-$(date +%Y%m%d%H%M%S)"
HELPDESK_PORT=4390 docker compose -p "$VARIED_PROJECT" up -d --build
# Aguarde a API e os consumidores ficarem prontos.
VARIED_RESULTS=results/minha-rodada npm run test:varied
docker compose -p "$VARIED_PROJECT" stop
```

O comando de teste também interrompe e reinicia o agente da instalação isolada durante o período de pico. O diretório de saída contém o perfil, a medição de recuperação e os dois encaminhamentos comparados. Para executar o mesmo volume distribuído em horas reais, use `VARIED_SLOT_SECONDS=3600` no comando de teste. Essa opção requer manter o computador ativo por aproximadamente 24 horas. O roteiro aumenta também o intervalo de interação e renova as sessões de equipe durante execuções longas.

## Alcance

A rodada exercita variedade, cardinalidade de clientes, efeitos de uma interrupção e consistência da aplicação. A duração observada foi de seis minutos em uma máquina. Estabilidade por 24 horas reais, milhões de identidades, infraestrutura distribuída, latência de um modelo de produção e comportamento de atendentes humanos continuam em aberto. Os 400 novos casos/s foram medidos no ensaio de pico separado. [Carga mista de cinco minutos](CARGA-MISTA-OTIMIZADA.md)
