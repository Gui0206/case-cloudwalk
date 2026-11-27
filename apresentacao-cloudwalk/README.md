# Central · nova apresentação CloudWalk

Versão alternativa em HTML. O arquivo `Central-HelpDesk-Banca.pptx` não foi alterado.

## Abrir

Dê dois cliques em `abrir.command` nesta pasta, ou execute na raiz do repositório:

```sh
python3 -m http.server 4399 --bind 127.0.0.1 --directory apresentacao-cloudwalk
```

Abra http://127.0.0.1:4399. Não abra `index.html` diretamente pelo Finder: os módulos JavaScript precisam do servidor HTTP. Fontes, bibliotecas, logos e prints estão locais; o deck não depende de acesso à internet.

- Setas ou espaço: navegar. `F`: tela cheia. `S`: suspender animações. `R`: repetir entrada.
- Sete slides principais, na ordem do roteiro existente de 4min30s.
- O botão **Apoio** abre os quatro slides de perguntas em uma sequência separada. Eles não entram no pitch.
- `?static#4` abre o slide 4 sem animação. `?apoio&static#1` abre o primeiro apoio.
- O roteiro pessoal continua no arquivo local ignorado pelo Git. Nenhuma fala privada foi incorporada ao HTML.

## Origem visual e conteúdo

Design baseado na skill [deck-cloudwalk](https://github.com/PedroJorgeSA/skill/tree/main/deck-cloudwalk). `deck.js` e `scene.js` preservam o motor do template. `deck.css` usa as fontes locais; `pitch.css` contém as adaptações do case. O terreno usa tons neutros e lima para respeitar a preferência por evitar laranja. O símbolo Central vem do produto. Logos oficiais fornecidos pelo template, usados apenas neste case para a CloudWalk.

Bibliotecas fornecidas pelo template: three.js (MIT) e Lucide (ISC). Fontes Gabarito e IBM Plex Mono, disponíveis sob SIL Open Font License. Capturas reais do protótipo original, exibidas em tons de cinza. Não há demo em vídeo porque a apresentação prioriza testes e narração dos prints.

Os números vêm dos relatórios em `../results/`, com as diferenças entre rodadas explicitadas nos slides. O resultado com histórico pertence à versão anterior; o reteste com novas políticas começou com banco vazio. O gráfico usa escala linear em segundos.
