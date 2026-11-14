(() => {
  const map = document.querySelector('.map');
  const chapters = [...document.querySelectorAll('article > section')];
  const links = [...document.querySelectorAll('nav a')];
  const layers = [...map.querySelectorAll('[data-from]')];
  const [back, next] = map.querySelectorAll('button');
  const changes = [
    ['Primeiro desenho', 'Uma lojista envia o relato. Ana abre o caso na mesma aplicação.'],
    ['Entra o PostgreSQL', 'A lojista fecha o chat. Para Ana recuperar as falas amanhã, a API precisa gravá-las.'],
    ['Entram a outbox e o worker', 'O servidor pode cair após salvar a fala. Gravamos a obrigação de envio junto com ela e um worker retoma a entrega.'],
    ['Entram a ponte, o broker e o agente', 'O agente pode estar desligado. A ponte recebe o webhook e publica o pedido. A resposta volta por outro tópico.'],
    ['Entra a inbox', 'A ponte pode reenviar uma resposta já gravada. A API reconhece o ID no PostgreSQL antes de repetir seu efeito.'],
    ['Entram as regras e o simulador', 'O mesmo relato tem destinos diferentes por marca. A operação compara os destinos antes de publicar a regra usada pela API.'],
    ['Muda a tomada do caso', 'Ana e Bruno veem o mesmo chamado livre. O painel pede o próximo elegível e a API reserva uma linha no banco.'],
    ['Entra o índice dos pendentes', 'A 400 aberturas/s, o worker perde tempo procurando eventos na outbox. O índice encurta essa busca.'],
    ['Teste do desenho acumulado', 'Repetimos cinco minutos de carga com histórico e analistas. Os mesmos componentes encerram 120 mil conversas.'],
    ['Arquitetura final', 'Siga o pedido da lojista, o retorno do agente e a tomada do caso por Ana no mapa completo.']
  ];
  let index;
  function render() {
    const found = chapters.findIndex(section => '#' + section.id === location.hash);
    index = Math.max(0, found);
    const stage = index + 1;
    chapters.forEach((section, i) => {
      section.hidden = i !== index;
      if (i === index) links[i].setAttribute('aria-current', 'step');
      else links[i].removeAttribute('aria-current');
    });
    layers.forEach(layer => {
      const first = Number(layer.dataset.from);
      layer.toggleAttribute('hidden', first > stage);
      layer.classList.toggle('new', first === stage);
    });
    map.querySelector('.map-controls strong').textContent = 'Evolução do desenho · ' + stage + ' de ' + chapters.length;
    map.querySelector('.map-status strong').textContent = changes[index][0] + '. ';
    map.querySelector('.map-status span').textContent = changes[index][1];
    map.querySelector('#map-description').textContent = layers.filter(l => !l.hasAttribute('hidden')).map(l => l.getAttribute('aria-label')).join('. ');
    map.querySelector('figcaption').textContent = stage < 9 ? 'Traço verde em negrito · ' + changes[index][0] : stage === 9 ? 'Teste de carga sobre a arquitetura da etapa anterior.' : 'Desenho completo com as peças nas posições originais.';
    back.disabled = !index;
    next.disabled = index === chapters.length - 1;
  }
  function go(id) {
    history.pushState(null, '', '#' + id);
    render();
    map.scrollIntoView({block:'start'});
  }
  back.onclick = () => go(chapters[index - 1].id);
  next.onclick = () => go(chapters[index + 1].id);
  links.forEach((link,i) => link.addEventListener('click', e => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(chapters[i].id);
  }));
  window.addEventListener('hashchange', render);
  window.addEventListener('popstate', render);
  render();
  document.documentElement.classList.add('chapter-view');
  map.hidden = false;
  if (location.hash && chapters.some(s => location.hash === '#' + s.id)) requestAnimationFrame(() => map.scrollIntoView());
})();
