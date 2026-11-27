# Central · nova apresentação CloudWalk

Versão alternativa em HTML. O arquivo `Central-HelpDesk-Banca.pptx` não foi alterado.

## Abrir

Dê dois cliques em `abrir.command` nesta pasta, ou execute na raiz do repositório:

```sh
python3 -m http.server 4399 --bind 127.0.0.1 --directory apresentacao-cloudwalk
```

Abra http://127.0.0.1:4399. Não abra `index.html` diretamente pelo Finder: os módulos JavaScript precisam do servidor HTTP. Fontes, bibliotecas, logos e prints estão locais; o deck não depende de acesso à internet.

- Setas ou espaço: navegar. `F`: tela cheia. Sem animações decorativas ou dependência de WebGL.
- Sete slides principais, na ordem do roteiro existente de 4min30s.
- O botão **Apoio** abre os quatro slides de perguntas em uma sequência separada. Eles não entram no pitch.
- `#4` abre o slide 4. `?apoio#1` abre o primeiro apoio.
- O roteiro pessoal continua no arquivo local ignorado pelo Git. Nenhuma fala privada foi incorporada ao HTML.

## Direção visual e conteúdo

A versão atual usa composição editorial em preto, cinza e papel claro, tipografia Arial/Helvetica e números em Courier New. Os layouts e a navegação estão em `editorial.css` e `presentation.js`. Não carrega partículas, three.js, Lucide, fontes ou estilos da skill.

A primeira versão foi construída com a skill [deck-cloudwalk](https://github.com/PedroJorgeSA/skill/tree/main/deck-cloudwalk). Seus arquivos permanecem como referência de origem, sem serem carregados pela página atual. Os logos oficiais fornecidos pelo template são usados neste case para a CloudWalk. O símbolo Central vem do produto. Prints reais do protótipo são exibidos em cinza.

Sete slides principais e quatro apoios separados. A narrativa acompanha o roteiro pessoal de 4min30s. Os números vêm dos relatórios em `../results/`; as diferenças entre rodadas continuam explícitas. O resultado com histórico pertence à versão anterior; o reteste com novas políticas começou com banco vazio. O gráfico usa escala linear em segundos.
