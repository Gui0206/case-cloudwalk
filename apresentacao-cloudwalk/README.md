# Central · Engenharia sob carga

Apresentação contínua de onze slides: sete principais e quatro apoios, acessíveis em seguida pelas mesmas setas. O PowerPoint `Central-HelpDesk-Banca.pptx` permanece intacto.

## Abrir e apresentar

Abra **index.html** diretamente no navegador: imagens, fontes, estilos e navegação estão incorporados. Não exige rede, servidor ou instalação. Para usar o mesmo endereço da demonstração dos slides, execute `abrir.command` ou:

```sh
python3 -m http.server 4399 --bind 127.0.0.1 --directory apresentacao-cloudwalk
```

Acesse http://127.0.0.1:4399/.

- Setas, espaço ou deslize lateral: navegar. `F`: tela cheia. `S`: suspender animações.
- Os controles aparecem ao mover o ponteiro e desaparecem após uma pausa.
- O pitch termina no sétimo slide. A próxima seta abre o primeiro apoio, no slide 8; os apoios seguem até o slide 11. A seta anterior volta normalmente ao pitch.
- **Apoio** é um atalho para o slide 8 da mesma apresentação.
- `?static#4` abre o gráfico de latência sem animação. `#8` abre o primeiro apoio; os links antigos `?apoio#1` a `?apoio#4` continuam funcionando e levam aos slides 8 a 11.
- `E` ativa edição local de títulos e textos selecionados. `Esc` encerra a edição. As alterações ficam no armazenamento desse navegador; **Salvar HTML** ou `Ctrl/Cmd+S` baixa uma cópia independente com o texto editado.
- O roteiro pessoal continua local e ignorado pelo Git, sem falas privadas incorporadas ao HTML. A sequência acompanha o roteiro de 4min30s.

## Direção visual

Aplicação da skill aberta [Frontend Slides, de Zara Zhang](https://github.com/zarazhangrui/frontend-slides), sob licença MIT. Foram usados o palco fixo 1920×1080, princípios de tipografia, animação, composição e validação da skill. A direção visual foi criada para este case: superfícies escuras, prata e ciano, tipos Sora, DM Sans e DM Mono, e uma capa com arte própria.

O HTML é autossuficiente. Não carrega o motor, as partículas ou os estilos da skill do colega. Os arquivos anteriores permanecem no diretório e no histórico como referência, mas não são carregados. Logos oficiais foram preservados a partir da primeira versão, usados neste case para a CloudWalk; o símbolo Central vem do produto.

Prints são capturas reais do protótipo, exibidas em cinza. Diagramas e gráficos são elementos vetoriais/HTML. A imagem abstrata da capa é ilustrativa e não representa a topologia do sistema.

Fontes sob SIL Open Font License; licenças e atribuição da skill em `assets/signal/`.

## Arte da capa

Arquivo original: `assets/signal/fluxo.png`, também incorporado ao HTML. Criado com a ferramenta integrada de geração de imagens; não foi usada API externa por script.

Prompt utilizado:

> Create a premium photorealistic CGI artwork for a technical keynote presentation about reliable message processing. Wide 16:9 composition, high resolution. Pure near-black studio background #080c12. On the RIGHT TWO THIRDS only: one elegant large sculptural continuous ribbon made of satin brushed aluminum and smoked optical glass, bent in a tall ascending loop with two parallel trajectories, like a precision engineered fluid conduit, light cyan edge illumination subtle rather than neon. Beautiful complex material reflections, silver highlights, cyan transmitted light through glass, dark areas with genuine depth, gallery-quality product photography. The left THIRD must be completely dark empty negative space for type. View slightly from above, object floating with no pedestal, diagonal orientation, tightly art-directed, crisp silhouette. This is abstract cover art, not a literal architecture diagram. No text, no letters, no numbers, no charts, no logos, no particles, no dotted terrain, no purple, no orange, no lime green. Editorial quality technological sculpture, sophisticated minimal lighting, physically based rendering, confident and understated.

## Evidências

Os dados vêm dos relatórios em `../results/`; as diferenças entre rodadas permanecem explícitas. O resultado com histórico pertence à versão anterior, enquanto o reteste com novas políticas começou com banco vazio. O gráfico de latência usa escala linear em segundos; o destaque de 75 ms corresponde a 0,075 s. As 48 combinações do simulador não representam proporções do tráfego real. Dados sintéticos, agente e analistas simulados não equivalem a capacidade comprovada em produção.
