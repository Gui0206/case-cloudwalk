# Prioridade por política, alertas e auditoria de publicação

## Decisão de produto

A prioridade informada pelo cliente é um dado de entrada, não a prioridade da fila. `declared_priority` conserva esse valor; `priority` guarda o resultado da política. A primeira regra compatível escolhe fila, equipe e `setPriority`. Sem uma prioridade de saída explícita, o resultado é **Normal**, inclusive quando o cliente pede Urgente. Uma operação pode escolher usar a prioridade informada como condição, mas precisa fazê-lo explicitamente na política.

A triagem e a transferência humana calculam o resultado com a política ativa no momento da decisão. Na transferência, as condições consultam a prioridade originalmente informada, evitando realimentar o resultado da triagem como se fosse entrada do cliente. A auditoria conserva entrada, saída, regra e versão. Publicar não reprioriza retroativamente chamados já na fila. Na atualização de uma instalação antiga, a migração preserva a prioridade dos chamados existentes como prioridade informada; as próximas decisões usam a nova semântica de prioridade Normal por padrão. Os resultados históricos anteriores correspondem à implementação anterior.

## Alertas

O simulador percorre as 48 combinações finitas atuais de marca, assunto, etapa e prioridade informada. Usa o mesmo motor do atendimento, sem publicar nem alterar conversas.

- **Regra encoberta:** nenhuma combinação compatível chega a vencer; informa os IDs das regras vencedoras anteriores.
- **Alcance entre marcas:** uma regra muda fila/equipe/nome ou prioridade em ambas as marcas, em comparação à política ativa.
- **Fila sem cenários:** nenhum cenário simulado chega à fila. Não afirma que a fila está vazia nem que não contém chamados antigos.
- **Concentração por marca:** todos os cenários humanos de uma marca chegam à mesma fila. É informativo e pode ser intencional; não estima percentuais do tráfego real.

Os avisos não bloqueiam automaticamente configurações válidas. A comparação mostra a prioridade efetiva antes/depois, inclusive quando só a prioridade muda.

## Publicação auditada

A publicação exige a versão de base e o hash do rascunho simulado. A transação existente serializa publicações concorrentes. A nova versão, a remoção do rascunho e a auditoria são confirmadas juntas; em falha, tudo é revertido.

O registro contém operador da sessão, identificador da sessão de demonstração, horário do banco, versões anterior/nova, hash, correlação e diferenças de filas/regras, incluindo adições, remoções, alterações e reordenação. O ator enviado no corpo da publicação é ignorado. O histórico é acessível apenas à Operação e conserva as 50 publicações mais recentes na listagem; os registros anteriores continuam no banco.

As identidades de demonstração têm IDs estáveis, selecionados no login com o código compartilhado da equipe. **Não são autenticação individual de produção nem prova da identidade de uma pessoa.** Registros legados sem autor permanecem explicitamente identificados como legados.

## Testes reproduzíveis

`backend/policy_test.go` verifica prioridade efetiva, isolamento entre marcas, saída inválida, regras encobertas, alerta entre marcas, pureza da simulação e diferenças de reordenação. O build executa esses testes e os testes anteriores de roteamento/handoff.

Em uma instalação nova e isolada:

```sh
HELPDESK_PORT=4396 docker compose -p central-policy-test up -d --build
node --env-file=.env scripts/policy-check.js
```

O script exige versão inicial e banco sem atendimentos. Usa PostgreSQL, worker, webhook, Redpanda e agente simulado reais da instalação. Verifica:

1. Acesso negado ao histórico por cliente e rejeição de operador inexistente.
2. Simulação sem alteração da política ativa ou publicação.
3. As 48 prioridades contra uma expectativa independente do motor.
4. Publicação de prévia obsoleta recusada.
5. Duas publicações concorrentes: uma confirma e a outra recebe 409, sem versão/auditoria duplicada.
6. Autor obtido da sessão, hash, correlação, horário e diferenças persistidos.
7. Pedido Urgente não eleva a prioridade sem política; transferência humana recalcula pela regra correta.
8. Reentrega do callback não duplica mensagem/auditoria nem muda prioridade.
9. Regra InfinitePay não altera a prioridade da JIM.
10. O próximo caso usa prioridade efetiva; analistas concorrentes recebem casos distintos.
11. Reordenação auditada por um segundo operador.

Resultado: [policy-check.json](policy-check.json). A política e as conversas de demonstração na porta 4380 não são usadas nesses testes.

## Carga sustentada da nova versão

```sh
HELPDESK_PORT=4398 docker compose -p central-policy-capacity up -d --build
MIXED_PROJECT=central-policy-capacity node --env-file=.env scripts/mixed.js
```

A instalação deve estar vazia. O gerador publica políticas de Pix humano com prioridade Urgente para InfinitePay e Alta para JIM; os destinos continuam nas equipes de atendimento originais. Mantém 400 aberturas/s por 300 segundos, duas mensagens do cliente, 16 analistas simulados e atribuição de próximo caso. A comparação envolve a nova semântica de prioridade, não replica a distribuição de prioridades dos testes antigos. O teste verifica as prioridades persistidas e registra os resultados em arquivo separado, sem substituir medições anteriores. A execução retorna código de erro quando os critérios falham.

As medições são locais e com agente/canais/analistas simulados. Os p95 de resposta medem persistência no PostgreSQL, não renderização no navegador. Resultados de carga não garantem capacidade de produção nem produtividade humana.


### Resultado observado da carga

| Medida | Resultado |
|---|---:|
| Conversas abertas / encerradas | 120.000 / 120.000 |
| Chegadas puladas / erros HTTP | 0 / 0 |
| p95 de abertura | 12,45 ms |
| p95 da primeira / segunda resposta persistida | 121,12 / 122,09 ms |
| Casos humanos / atribuições distintas | 24.000 / 24.000 |
| Prioridades incorretas na conferência independente | 0 |
| Eventos enviados / sem retorno confirmado | 240.000 / 0 |
| Outbox pendente / falha | 0 / 0 |
| Lag final do agente / ponte | 0 / 0 |
| Encerramento do acompanhamento | 301,72 s |

[Resultado bruto](central-policy-capacity.json) · [Snapshot independente e hashes dos fontes medidos](policy-capacity-snapshot.json).

O teste foi executado durante o desenvolvimento: `revision` identifica o commit-base; os hashes do snapshot identificam os fontes de backend/schema da implementação medida. A conferência independente de offsets e eventos foi adicionada ao comando de reprodução após essa rodada; a rodada salva foi conferida pelo script separado `node scripts/policy-snapshot.js` antes de parar a instalação. O resultado antigo com seis meses de histórico **não** foi refeito nesta versão e continua identificado como evidência da versão anterior.

### Regressão e interface

- [Experimento anterior](policy-regression-experiment.json): 48 decisões conferidas em 24 conversas, isolamento entre marcas, bloqueio de prévia obsoleta e atendimento humano.
- [Falhas](policy-regression-faults.json): mensagem persistida com agente desligado, recuperação, deduplicação e retorno obsoleto ignorado.
- Verificação no navegador: seleção da prioridade efetiva; regra ampla com aviso entre marcas; restrição à InfinitePay removendo o aviso; publicação real na instalação isolada; autor e diferenças legíveis; viewport de 390 px sem overflow da página e sem erros JavaScript.
- Atualização da instalação de demonstração: contagens de tickets, mensagens, auditorias e versões preservadas.

Para a regressão, use uma instalação nova em 4397, `TEST_URL=http://localhost:4397 node scripts/experiment.js` e `TEST_URL=http://localhost:4397 TEST_PROJECT=central-policy-regression node scripts/faults.js`. Esses scripts antigos gravam os nomes de resultados originais; preserve-os antes de executar se quiser manter o histórico. Os arquivos desta rodada foram copiados para nomes separados.
