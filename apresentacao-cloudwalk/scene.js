// Cenário 3D do deck: campo de partículas, bloco de pontos que vira camadas e trilhas de mensagens.
// Cada slide pede um modo (data-scene); os grupos fazem crossfade. As cores vêm das variáveis CSS
// --s1..--s4 (terreno), --accent, --text e --danger, então trocar a marca é só trocar o deck.css.
import * as THREE from "./vendor/three.module.min.js";

const css = (n, d) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d);
const PAL = {
  orange: new THREE.Color(css("--s1", "#FF7A3D")), blue: new THREE.Color(css("--s2", "#4F7DFF")), bone: new THREE.Color(css("--text", "#ECEBE9")),
  lime: new THREE.Color(css("--accent", "#C9FF4D")), amber: new THREE.Color(css("--s3", "#FFB04A")), red: new THREE.Color(css("--danger", "#FF5C4D")), dim: new THREE.Color("#6E6E6E"),
};

const VERT = `
attribute vec3 aColor; attribute float aAlpha;
uniform float uSize; uniform float uOpacity; uniform float uPR;
varying vec3 vColor; varying float vAlpha;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uPR * (240.0 / -mv.z);
  vColor = aColor; vAlpha = aAlpha * uOpacity;
}`;
const FRAG = `
varying vec3 vColor; varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.1, d) * vAlpha;
  gl_FragColor = vec4(vColor * a, a);
}`;

function cloud(n, size, pr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uSize: { value: size }, uOpacity: { value: 0 }, uPR: { value: pr } },
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

const lerp = (a, b, k) => a + (b - a) * k;
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const hash = (i) => { const s = Math.sin(i * 127.1) * 43758.5453; return s - Math.floor(s); };

export function createScene(canvas) {
  const pr = Math.min(window.devicePixelRatio || 1, 2);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(pr);
  renderer.setClearColor(css("--bg", "#060606"), 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);

  // ---------- terreno de partículas
  const NX = 240, NZ = 120;
  const terrain = cloud(NX * NZ, 1.0, pr);
  {
    const pos = terrain.geometry.attributes.position.array, col = terrain.geometry.attributes.aColor.array, al = terrain.geometry.attributes.aAlpha.array;
    for (let i = 0, k = 0; i < NX; i++) for (let j = 0; j < NZ; j++, k++) {
      pos[k * 3] = (i / (NX - 1) - 0.5) * 60 + (hash(k) - 0.5) * 0.18;
      pos[k * 3 + 2] = (j / (NZ - 1) - 0.5) * 34 + (hash(k + 9) - 0.5) * 0.18;
      // faixas de cor: --s1, --s2, texto, --s3 e um pouco de --accent
      const band = Math.sin(i * 0.045 + Math.sin(j * 0.08) * 1.6) * 0.5 + 0.5;
      const c = band > 0.72 ? PAL.blue : band > 0.45 ? PAL.orange : band > 0.18 ? PAL.bone : PAL.amber;
      const lime = hash(k * 3) > 0.985;
      const cc = (lime ? PAL.lime : c).clone().multiplyScalar(0.55 + hash(k * 7) * 0.45);
      col[k * 3] = cc.r; col[k * 3 + 1] = cc.g; col[k * 3 + 2] = cc.b;
      al[k] = 0.35 + hash(k * 13) * 0.65;
    }
  }
  scene.add(terrain);

  // ---------- bloco de pontos (o jeito antigo) que se desfaz em três camadas finas (a proposta)
  const BX = 26, BY = 14, BZ = 14, BN = BX * BY * BZ;
  const block = cloud(BN, 0.95, pr);
  const blockA = new Float32Array(BN * 3), blockB = new Float32Array(BN * 3), blockR = new Float32Array(BN * 3);
  {
    const col = block.geometry.attributes.aColor.array;
    for (let i = 0, k = 0; i < BX; i++) for (let j = 0; j < BY; j++) for (let l = 0; l < BZ; l++, k++) {
      const jx = (hash(k + 31) - 0.5) * 0.22, jy = (hash(k + 37) - 0.5) * 0.22, jz = (hash(k + 41) - 0.5) * 0.22;
      blockA[k * 3] = (i / (BX - 1) - 0.5) * 7.2 + jx; blockA[k * 3 + 1] = (j / (BY - 1) - 0.5) * 3.6 + 2.6 + jy; blockA[k * 3 + 2] = (l / (BZ - 1) - 0.5) * 3.6 + jz;
      block.geometry.attributes.aAlpha.array[k] = 0.25 + hash(k + 43) * 0.45;
      // camadas: três faixas finas deslocadas
      const layer = k % 3; const len = [7.8, 7.2, 6.0][layer], off = [-0.6, 0.6, -1.2][layer];
      blockB[k * 3] = (hash(k) - 0.5) * len + off; blockB[k * 3 + 1] = 3.9 - layer * 1.25 + (hash(k + 3) - 0.5) * 0.12; blockB[k * 3 + 2] = (hash(k + 5) - 0.5) * 2.4;
      const r = 6 + hash(k + 11) * 10, th = hash(k + 17) * Math.PI * 2, ph = (hash(k + 23) - 0.5) * Math.PI;
      blockR[k * 3] = Math.cos(th) * Math.cos(ph) * r; blockR[k * 3 + 1] = 2.6 + Math.sin(ph) * r * 0.6; blockR[k * 3 + 2] = Math.sin(th) * Math.cos(ph) * r;
      const c = PAL.amber.clone().lerp(PAL.orange, hash(k * 5)).multiplyScalar(0.6 + hash(k * 2) * 0.4);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
  }
  scene.add(block);

  // ---------- fluxo: 6 trilhas (partições, filas, etapas), mensagens coloridas por chave
  const LANES = 6, LX0 = -4.5, LX1 = 8.6;
  const laneZ = (l) => (l - (LANES - 1) / 2) * 1.5;
  const LANE_PTS = 160;
  const lanes = cloud(LANES * LANE_PTS + 120, 0.7, pr);
  {
    const pos = lanes.geometry.attributes.position.array, col = lanes.geometry.attributes.aColor.array, al = lanes.geometry.attributes.aAlpha.array;
    let k = 0;
    for (let l = 0; l < LANES; l++) for (let i = 0; i < LANE_PTS; i++, k++) {
      pos[k * 3] = lerp(LX0, LX1, i / (LANE_PTS - 1)); pos[k * 3 + 1] = 0; pos[k * 3 + 2] = laneZ(l);
      col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = 0.55; al[k] = 0.5;
    }
    // trilha de erro (DLQ), abaixo
    for (let i = 0; i < 120; i++, k++) {
      pos[k * 3] = lerp(3.8, LX1, i / 119); pos[k * 3 + 1] = -3.2; pos[k * 3 + 2] = laneZ(5) + 1.4;
      col[k * 3] = PAL.red.r * 0.6; col[k * 3 + 1] = PAL.red.g * 0.6; col[k * 3 + 2] = PAL.red.b * 0.6; al[k] = 0.6;
    }
  }
  scene.add(lanes);

  const CONVS = [PAL.lime, PAL.blue, PAL.orange, PAL.bone, PAL.amber, new THREE.Color("#9B93FF"), new THREE.Color("#5FD3C4"), new THREE.Color("#FF8FB1")];
  const MSG_PTS = 70, MSGS = 22;
  const msgs = cloud(MSG_PTS * MSGS, 1.25, pr);
  // cada mensagem: partição, conversa, posição de saída; a conversa 0 (lima) mora na partição 2 e é a que falha
  const plan = Array.from({ length: MSGS }, (_, m) => {
    const conv = m % 8; const lane = [2, 0, 4, 1, 5, 3, 0, 2][conv];
    return { conv, lane, start: m * 0.55 + (conv === 0 ? 0 : hash(m) * 0.3), seq: Math.floor(m / 8) };
  });
  scene.add(msgs);

  // ---------- modos por slide
  const MODES = {
    cover:   { terrain: 1, block: 0, lanes: 0, msgs: 0, cam: [0, 5.2, 21], look: [0, 0.6, 0] },
    drift:   { terrain: 0.55, block: 0, lanes: 0, msgs: 0, cam: [6, 9, 22], look: [2, 0, 0] },
    block:   { terrain: 0.25, block: 0.8, lanes: 0, msgs: 0, cam: [4, 6.5, 17], look: [-4.5, 2.2, 0], blockState: "whole" },
    layers:  { terrain: 0.3, block: 0.9, lanes: 0, msgs: 0, cam: [4, 6, 16], look: [-4.5, 2.6, 0], blockState: "layers" },
    quiet:   { terrain: 0.16, block: 0, lanes: 0, msgs: 0, cam: [0, 7, 24], look: [0, 0, 0] },
    flow:    { terrain: 0.08, block: 0, lanes: 1, msgs: 1, cam: [-2.2, 10.5, 12.5], look: [-2.2, -0.8, 0.4], lane: "flow" },
    fail:    { terrain: 0.08, block: 0, lanes: 1, msgs: 1, cam: [-2.6, 9.5, 15.5], look: [-2.6, -2.4, 0.8], lane: "fail" },
    end:     { terrain: 0.75, block: 0, lanes: 0, msgs: 0, cam: [0, 3.2, 23], look: [0, 3.2, 0] },
    off:     { terrain: 0.06, block: 0, lanes: 0, msgs: 0, cam: [0, 7, 24], look: [0, 0, 0] },
  };
  let mode = MODES.cover, modeName = "cover", modeT0 = performance.now();
  const op = { terrain: 0, block: 0, lanes: 0, msgs: 0 };
  const cam = new THREE.Vector3(...MODES.cover.cam), look = new THREE.Vector3(...MODES.cover.look);
  let blockMix = 0, blockBurst = 0;
  let frozen = false, last = performance.now(), t = 0;
  const labels = [];

  function setMode(name) {
    if (!MODES[name] || name === modeName) return;
    const prev = modeName; modeName = name; mode = MODES[name]; modeT0 = performance.now();
    if (prev === "block" && name === "layers") blockBurst = 1;
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize); resize();

  const v = new THREE.Vector3();
  function project(p) { v.set(p[0], p[1], p[2]).project(camera); return [(v.x * 0.5 + 0.5) * canvas.clientWidth, (-v.y * 0.5 + 0.5) * canvas.clientHeight, v.z < 1]; }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!frozen) t += dt;
    const k = frozen ? 1 : 1 - Math.pow(0.0025, dt); // aproximação suave e independente de fps
    for (const g of ["terrain", "block", "lanes", "msgs"]) op[g] = lerp(op[g], mode[g], k * 0.9);
    terrain.material.uniforms.uOpacity.value = op.terrain;
    block.material.uniforms.uOpacity.value = op.block;
    lanes.material.uniforms.uOpacity.value = op.lanes;
    msgs.material.uniforms.uOpacity.value = op.msgs;
    cam.lerp(v.set(...mode.cam), k * 0.6); look.lerp(new THREE.Vector3(...mode.look), k * 0.6);
    camera.position.copy(cam); camera.lookAt(look);

    // terreno em onda
    if (op.terrain > 0.01) {
      const pos = terrain.geometry.attributes.position.array;
      for (let n = 0; n < NX * NZ; n++) {
        const x = pos[n * 3], z = pos[n * 3 + 2];
        pos[n * 3 + 1] = 1.5 * Math.sin(x * 0.17 + t * 0.35) * Math.cos(z * 0.22 - t * 0.12) + 0.7 * Math.sin((x + z) * 0.11 - t * 0.25) - 2.4;
      }
      terrain.geometry.attributes.position.needsUpdate = true;
    }

    // bloco: inteiro → explode → três camadas
    if (op.block > 0.01) {
      const target = mode.blockState === "layers" ? 1 : 0;
      blockMix = frozen ? target : lerp(blockMix, target, dt * 1.1);
      blockBurst = frozen ? 0 : Math.max(0, blockBurst - dt * 0.7);
      const burst = Math.sin(Math.min(1, blockMix) * Math.PI) * 0.9 + blockBurst * 0.0;
      const pos = block.geometry.attributes.position.array, col = block.geometry.attributes.aColor.array;
      const m = ease(blockMix);
      for (let n = 0; n < BN; n++) {
        const wob = frozen ? 0 : Math.sin(t * 1.3 + n * 0.37) * 0.025;
        for (let a = 0; a < 3; a++) {
          const base = lerp(blockA[n * 3 + a], blockB[n * 3 + a], m);
          pos[n * 3 + a] = lerp(base, blockR[n * 3 + a], burst * 0.35) + wob;
        }
        if (n % 4 === 0 || frozen) {
          const layer = n % 3; const to = layer === 2 ? PAL.lime : PAL.bone;
          const from = PAL.amber.clone().lerp(PAL.orange, hash(n * 5));
          const c = from.lerp(to, m).multiplyScalar(0.6 + hash(n * 2) * 0.4);
          col[n * 3] = c.r; col[n * 3 + 1] = c.g; col[n * 3 + 2] = c.b;
        }
      }
      block.rotation.y = frozen ? -0.35 : -0.35 + Math.sin(t * 0.2) * 0.12;
      block.geometry.attributes.position.needsUpdate = true; block.geometry.attributes.aColor.needsUpdate = true;
    }

    // trilha de erro só aparece no modo fail
    if (op.lanes > 0.01) {
      const al = lanes.geometry.attributes.aAlpha.array, want = mode.lane === "fail" ? 0.6 : 0;
      if (al[LANES * LANE_PTS] !== want) { for (let i = LANES * LANE_PTS; i < al.length; i++) al[i] = want; lanes.geometry.attributes.aAlpha.needsUpdate = true; }
    }

    // mensagens nas trilhas
    if (op.msgs > 0.01) {
      const pos = msgs.geometry.attributes.position.array, col = msgs.geometry.attributes.aColor.array, al = msgs.geometry.attributes.aAlpha.array;
      const T = frozen ? (mode.lane === "fail" ? 6.6 : 9.5) : (now - modeT0) / 1000;
      const speed = 2.2; const CONSUMER = 5.6; const LOOP = 13;
      const fail = mode.lane === "fail";
      // linha do tempo da falha (em segundos desde a entrada no slide)
      const tFail = 2.2, tDlq = 5.0, tReplay = 9.0;
      for (let m = 0; m < MSGS; m++) {
        const p = plan[m];
        let tt = fail ? T - p.start * 0.5 : ((T - p.start) % LOOP + LOOP) % LOOP;
        let x = LX0 + tt * speed, y = 0, z = laneZ(p.lane), a = 1, c = CONVS[p.conv];
        if (tt < 0) a = 0;
        if (fail && p.conv === 0) {
          const first = p.seq === 0;
          if (first) {
            if (T > tFail && T < tDlq) { x = CONSUMER - 0.6 + Math.abs(Math.sin((T - tFail) * 3.3)) * -0.9; c = PAL.red; } // 3 tentativas
            else if (T >= tDlq && T < tReplay) { const q = ease((T - tDlq) / 1.1); x = lerp(CONSUMER - 0.6, 6.8, q); y = lerp(0, -3.2, q); z = lerp(laneZ(p.lane), laneZ(5) + 1.4, q); c = PAL.red; }
            else if (T >= tReplay) { const q = ease((T - tReplay) / 1.2); x = lerp(6.8, CONSUMER + 2 + (T - tReplay - 1.2) * speed * (q >= 1 ? 1 : 0), q); y = lerp(-3.2, 0, q); z = lerp(laneZ(5) + 1.4, laneZ(p.lane), q); c = PAL.lime; }
          } else {
            // seguintes da mesma conversa esperam atrás do consumidor até o replay
            const holdX = CONSUMER - 1.4 - p.seq * 1.1;
            if (T < tReplay + 1.2) x = Math.min(x, holdX); else x = Math.min(LX0 + tt * speed, holdX + (T - tReplay - 1.2) * speed);
            if (T > tFail && T < tReplay) c = PAL.lime.clone().multiplyScalar(0.55);
          }
        }
        if (!fail && x > LX1) a = Math.max(0, 1 - (x - LX1) * 2);
        if (fail && x > LX1 + 1) a = 0;
        for (let i = 0; i < MSG_PTS; i++) {
          const n = m * MSG_PTS + i;
          const r = 0.32 * Math.sqrt(hash(n)); const th = hash(n + 1) * Math.PI * 2;
          pos[n * 3] = x + Math.cos(th) * r * 1.4; pos[n * 3 + 1] = y + (hash(n + 2) - 0.5) * 0.35; pos[n * 3 + 2] = z + Math.sin(th) * r * 0.8;
          const cc = c.clone().multiplyScalar(0.7 + hash(n + 4) * 0.3);
          col[n * 3] = cc.r; col[n * 3 + 1] = cc.g; col[n * 3 + 2] = cc.b; al[n] = a;
        }
      }
      msgs.geometry.attributes.position.needsUpdate = true; msgs.geometry.attributes.aColor.needsUpdate = true; msgs.geometry.attributes.aAlpha.needsUpdate = true;
    }

    renderer.render(scene, camera);
    for (const l of labels) {
      const [x, y, vis] = project(l.pos);
      l.el.style.transform = `translate(${x}px, ${y}px)`;
      l.el.style.opacity = vis && l.modes.includes(modeName) ? 1 : 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setMode, MODES,
    setFrozen(f) { frozen = f; },
    restart() { modeT0 = performance.now(); if (modeName === "layers") blockMix = 0; },
    label(el, pos, modes) { labels.push({ el, pos, modes }); },
    geometry: { laneZ, LX0, LX1, CONSUMER: 5.6, LANES },
  };
}
