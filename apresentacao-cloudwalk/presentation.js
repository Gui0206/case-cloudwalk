// Navegação independente. Não carrega o motor visual do template anterior.
const stage = document.querySelector('#stage');
const slides = [...stage.querySelectorAll(':scope > .slide')];
const support = new URLSearchParams(location.search).has('apoio');
let current = 0;
const fitStage = () => {
  const scale = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
};
function displaySlide(index, updateUrl = true) {
  current = Math.max(0, Math.min(slides.length - 1, index));
  slides.forEach((slide, i) => {
    slide.classList.toggle('on', i === current);
    slide.setAttribute('aria-hidden', String(i !== current));
    slide.dataset.number = String(i + 1).padStart(2, '0');
  });
  const active = slides[current];
  document.querySelector('#ch').textContent = active.dataset.ch;
  document.querySelector('#num').textContent = `${support ? 'Apoio ' : ''}${String(current + 1).padStart(2, '0')} / ${slides.length}`;
  document.body.classList.toggle('dark-slide', !support && [0, 4, 6].includes(current));
  document.querySelector('#prev').disabled = current === 0;
  document.querySelector('#next').disabled = current === slides.length - 1;
  if (updateUrl) history.replaceState(null, '', `#${current + 1}`);
}
const fromHash = () => displaySlide((parseInt(location.hash.slice(1), 10) || 1) - 1, false);
addEventListener('resize', fitStage);
addEventListener('hashchange', fromHash);
addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) {
    event.preventDefault(); displaySlide(current + 1);
  } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) {
    event.preventDefault(); displaySlide(current - 1);
  } else if (event.key === 'Home') displaySlide(0);
  else if (event.key === 'End') displaySlide(slides.length - 1);
  else if (event.key.toLowerCase() === 'f') {
    (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  }
});
document.querySelector('#prev').onclick = () => displaySlide(current - 1);
document.querySelector('#next').onclick = () => displaySlide(current + 1);
fitStage(); fromHash();
