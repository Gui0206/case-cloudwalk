(() => {
  const map = document.querySelector('.map');
  const chapters = [...document.querySelectorAll('article > section')];
  const links = [...document.querySelectorAll('nav a')];
  const layers = [...map.querySelectorAll('[data-from]')];
  const [back, next] = map.querySelectorAll('button');
  const changes = [
    'Primeiro desenho',
    'Entra o PostgreSQL',
    'Entram a outbox e o worker',
    'Entram a ponte, o broker e o agente',
    'Entra a inbox',
    'Entram as regras e o simulador',
    'Muda a tomada do caso',
    'Entra o índice dos pendentes',
    'Teste do desenho acumulado',
    'Arquitetura final'
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
    chapters[index].querySelector('.map-slot').append(map);
    map.querySelector('#map-description').textContent = layers.filter(l => !l.hasAttribute('hidden')).map(l => l.getAttribute('aria-label')).join('. ');
    map.querySelector('figcaption').textContent = stage < 9 ? 'Traço verde em negrito · ' + changes[index] : stage === 9 ? 'Teste de carga sobre a arquitetura da etapa anterior.' : 'Desenho completo com as peças nas posições originais.';
    back.disabled = !index;
    next.disabled = index === chapters.length - 1;
  }
  function go(id) {
    history.pushState(null, '', '#' + id);
    render();
    chapters[index].querySelector('h2').focus({preventScroll:true});
    chapters[index].scrollIntoView({block:'start'});
  }
  back.onclick = () => go(chapters[index - 1].id);
  next.onclick = () => go(chapters[index + 1].id);
  links.forEach((link,i) => link.addEventListener('click', e => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(chapters[i].id);
  }));
  chapters.slice(0, -1).forEach((section, i) => {
    const link = document.createElement('a');
    link.className = 'stage-next';
    link.href = links[i + 1].hash;
    link.textContent = 'Continuar → ' + chapters[i + 1].querySelector('h2').textContent;
    link.onclick = event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      go(chapters[i + 1].id);
    };
    section.append(link);
  });
  window.addEventListener('hashchange', render);
  window.addEventListener('popstate', render);
  render();
  document.documentElement.classList.add('chapter-view');
  map.hidden = false;
  if (location.hash && chapters.some(s => location.hash === '#' + s.id)) requestAnimationFrame(() => chapters[index].scrollIntoView());
})();
