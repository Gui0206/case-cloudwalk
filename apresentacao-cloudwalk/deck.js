import { createScene } from "./scene.js";

// Configuração do deck: nome no rodapé e rótulos presos ao 3D. Edite em index.html (window.DECK).
const CFG = Object.assign({
  name: "",
  flow: { lanes: ["P0", "P1", "P2", "P3", "P4", "P5"], producer: "<b>produtor</b>", consumer: "<b>consumidor</b>", error: "erro · fila de retentativa" },
}, window.DECK || {});

window.lucide?.createIcons({ attrs: { "stroke-width": 2 } });

const stage = document.getElementById("stage");
const slides = [...document.querySelectorAll(".slide")];
const ch = document.getElementById("ch"), num = document.getElementById("num"), bar = document.getElementById("bar");
let scene = null;
try { scene = createScene(document.getElementById("gl")); } catch (e) { console.warn("WebGL indisponível", e); }

// rótulos presos ao 3D (trilhas, produtor, consumidor, erro)
if (scene && CFG.flow) {
  const L = document.getElementById("labels");
  const mk = (html, pos, modes, cls = "") => { const el = document.createElement("div"); el.className = `lb ${cls}`; el.innerHTML = html; L.appendChild(el); scene.label(el, pos, modes); };
  const g = scene.geometry;
  for (let l = 0; l < g.LANES; l++) if (CFG.flow.lanes?.[l]) mk(CFG.flow.lanes[l], [g.LX1 + 0.6, 0, g.laneZ(l)], ["flow"]);
  if (CFG.flow.producer) mk(CFG.flow.producer, [g.LX0 + 0.2, 0.9, g.laneZ(0) - 1.4], ["flow", "fail"]);
  if (CFG.flow.consumer) mk(CFG.flow.consumer, [g.CONSUMER, 0.9, g.laneZ(0) - 1.3], ["flow", "fail"]);
  if (CFG.flow.error) mk(CFG.flow.error, [3.9, -3.2, g.laneZ(5) + 2.6], ["fail"], "red");
}

function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `scale(${s}) translate(-50%, -50%)`;
}
addEventListener("resize", fit); fit();

let cur = 0;
function show(i, push = true) {
  cur = Math.max(0, Math.min(slides.length - 1, i));
  slides.forEach((s, k) => s.classList.toggle("on", k === cur));
  const s = slides[cur];
  ch.textContent = s.dataset.ch ? [CFG.name, s.dataset.ch].filter(Boolean).join(" · ") : "";
  num.textContent = `${String(cur + 1).padStart(2, "0")} / ${slides.length}`;
  document.getElementById("foot").style.visibility = cur === 0 ? "hidden" : "visible";
  bar.style.width = `${((cur + 1) / slides.length) * 100}%`;
  // vídeos: toca o do slide ativo do começo, pausa os outros; sem animação mostra o pôster
  document.querySelectorAll("video[data-demo]").forEach((v) => {
    if (s.contains(v) && !isStatic) { v.currentTime = 0; v.play().catch(() => {}); } else v.pause();
  });
  scene?.setMode(s.dataset.scene || "off");
  scene?.restart();
  if (push) history.replaceState(null, "", `#${cur + 1}`);
}

function replay() {
  const s = slides[cur];
  s.classList.remove("on"); void s.offsetWidth; s.classList.add("on");
  scene?.restart();
}

var isStatic = false;
const KEY = `deck-static:${location.pathname}`;
try { isStatic = localStorage.getItem(KEY) === "1"; } catch {}
if (new URLSearchParams(location.search).has("static")) isStatic = true;
function setStatic(v) {
  isStatic = v; document.body.classList.toggle("static", v); scene?.setFrozen(v);
  document.getElementById("static").setAttribute("aria-pressed", String(v));
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch {}
}
setStatic(isStatic);

addEventListener("keydown", (e) => {
  if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) { e.preventDefault(); show(cur + 1); }
  else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) { e.preventDefault(); show(cur - 1); }
  else if (e.key === "Home") show(0);
  else if (e.key === "End") show(slides.length - 1);
  else if (e.key.toLowerCase() === "s") setStatic(!isStatic);
  else if (e.key.toLowerCase() === "r") replay();
  else if (e.key.toLowerCase() === "f") (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch?.(() => {});
});
document.getElementById("prev").onclick = () => show(cur - 1);
document.getElementById("next").onclick = () => show(cur + 1);
document.getElementById("static").onclick = () => setStatic(!isStatic);
document.getElementById("replay").onclick = replay;
stage.addEventListener("click", (e) => { if (!e.target.closest("button, a, video")) show(cur + 1); });

let idle;
addEventListener("mousemove", () => { document.body.classList.remove("idle"); clearTimeout(idle); idle = setTimeout(() => document.body.classList.add("idle"), 2200); });

show((parseInt(location.hash.slice(1), 10) || 1) - 1, false);
