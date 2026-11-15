(() => {
  const map = document.querySelector('.map');
  const chapters = [...document.querySelectorAll('article > section')];
  const links = [...document.querySelectorAll('nav a')];
  const layers = [...map.querySelectorAll('[data-from]')];
  const [back, next] = map.querySelectorAll('button');
  const order = new Map(chapters.map((chapter, i) => [chapter.id, i]));
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
      const first = order.get(layer.dataset.from);
      const last = layer.dataset.until ? order.get(layer.dataset.until) : chapters.length - 1;
      layer.toggleAttribute('hidden', index < first || index > last);
      layer.classList.toggle('new', first === index);
    });
    map.querySelector('.map-controls strong').textContent = 'Evolução do desenho · ' + stage + ' de ' + chapters.length;
    const slot = chapters[index].querySelector('.map-slot');
    slot.prepend(map);
    map.querySelector('#map-probe').setAttribute('transform', 'translate(' + slot.dataset.x + ' ' + slot.dataset.y + ')');
    map.querySelector('#map-description').textContent = layers.filter(l => !l.hasAttribute('hidden')).map(l => l.getAttribute('aria-label')).join('. ');
    map.querySelector('figcaption').textContent = chapters[index].dataset.caption;
    const activeLink = links[index];
    if (nav.offsetHeight && (activeLink.offsetTop < nav.scrollTop || activeLink.offsetTop + activeLink.offsetHeight > nav.scrollTop + nav.clientHeight)) {
      nav.scrollTop = activeLink.offsetTop - nav.clientHeight / 2;
    }
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
    link.textContent = 'Continuar →';
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
