import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-300.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/archivo-black/latin-400.css';
import './style.css';
import {
  BRANCH_SPECS,
  buildCarabiner,
  buildTree,
  buildTwigs,
  drawPill,
  hash,
  mulberry32,
  pointAt,
  renderLayer,
} from './tree.js';
import { EVENT, REGISTER_URL, STATIONS, TITLES } from './content.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

const canvas = $('#tree');
const ctx = canvas.getContext('2d');
const nav = $('#branches');
const hint = $('#hint');
const brand = $('#brand');
const stationEl = $('#station');
const stationBody = $('#station-body');
const rootsEl = $('#roots');
const revealEl = $('#reveal');
const backBtn = $('#back');
const live = $('#live');

const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = motionQuery.matches;
motionQuery.addEventListener?.('change', (e) => (reduced = e.matches));

// ---------- world ----------

const tree = buildTree();
const carabiner = buildCarabiner(tree.branches.register.tip);
const view = { W: 1, H: 1, dpr: 1 };
const cam = { x: 0, y: 0, s: 1 };

const state = {
  view: 'intro', // intro | tree | station | register | roots
  station: null,
  busy: false,
  grow: reduced ? 1 : 0,
  twigs: null,
  twigGrow: 0,
  carGrow: 0,
  dim: 1, // alpha of branches that are not in focus
  focus: null,
  treeLabels: false,
  timers: [],
};

let leaders = [];
let dirty = true;

// Adaptive dot budget: each dot carries a random rank and is drawn when the
// rank is under the current density. Frame time feedback lowers it.
let density = (navigator.hardwareConcurrency || 4) <= 4 ? 0.8 : 1;
const perf = { last: 0, ema: 16, slow: 0 };

// ---------- camera helpers ----------

function w2s(x, y, c = cam) {
  return { x: view.W / 2 + (x - c.x) * c.s, y: view.H / 2 - (y - c.y) * c.s };
}

function fitCam() {
  const { W, H } = view;
  const b = tree.bounds;
  const top = 54;
  const bottom = 80;
  const side = 14;
  const s = Math.min((W - 2 * side) / (b.maxX - b.minX), (H - top - bottom) / (b.maxY - b.minY));
  const midX = (b.minX + b.maxX) / 2;
  const midY = (b.minY + b.maxY) / 2;
  const screenMid = top + (H - top - bottom) / 2;
  return { x: midX, y: midY + (screenMid - H / 2) / s, s };
}

function zoomScale(mult) {
  return clamp(fitCam().s * mult, 0.85, 2.0);
}

// Camera so that `world` lands at screen point (sx, sy) at scale s.
function camFor(world, sx, sy, s) {
  return { x: world.x - (sx - view.W / 2) / s, y: world.y + (sy - view.H / 2) / s, s };
}

const tweens = [];
function tween(dur, fn, done) {
  tweens.push({ start: performance.now(), dur, fn, done });
}
function runTweens(now) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const t = tweens[i];
    const u = Math.min(1, (now - t.start) / t.dur);
    t.fn(u);
    if (u >= 1) {
      tweens.splice(i, 1);
      t.done && t.done();
    }
  }
}

function later(ms, fn) {
  state.timers.push(setTimeout(fn, ms));
}
function clearTimers() {
  state.timers.forEach(clearTimeout);
  state.timers = [];
}

// Follow a branch from wherever the camera is to `target`.
function flyAlong(br, target, dur, done) {
  const from = { ...cam };
  const off = { x: target.x - br.tip.x, y: target.y - br.tip.y };
  const dimFrom = state.dim;
  tween(
    dur,
    (u) => {
      const e = ease(u);
      const p = pointAt(br, e);
      const px = p.x + off.x * e;
      const py = p.y + off.y * e;
      const k = ease(clamp(u / 0.4, 0, 1));
      cam.x = lerp(from.x, px, k);
      cam.y = lerp(from.y, py, k);
      cam.s = from.s * Math.pow(target.s / from.s, e);
      state.dim = lerp(dimFrom, 0.14, ease(clamp(u * 1.6, 0, 1)));
      dirty = true;
    },
    done,
  );
}

function glide(target, dur, dimTo, done) {
  const from = { ...cam };
  const dimFrom = state.dim;
  tween(
    dur,
    (u) => {
      const e = ease(u);
      cam.x = lerp(from.x, target.x, e);
      cam.y = lerp(from.y, target.y, e);
      cam.s = from.s * Math.pow(target.s / from.s, e);
      state.dim = lerp(dimFrom, dimTo, e);
      dirty = true;
    },
    done,
  );
}

// Reduced motion: fade out, jump, fade in.
function cut(target, dimTo, done) {
  canvas.style.opacity = '0';
  later(280, () => {
    Object.assign(cam, target);
    state.dim = dimTo;
    dirty = true;
    canvas.style.opacity = '1';
    later(200, done);
  });
}

// ---------- tree view labels ----------

const labelEls = {};
for (const spec of BRANCH_SPECS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'branch-label';
  b.dataset.id = spec.id;
  b.textContent = TITLES[spec.id];
  b.setAttribute('aria-describedby', `sr-${spec.id}`);
  b.addEventListener('click', () => open(spec.id));
  nav.appendChild(b);
  labelEls[spec.id] = b;
}

// screen-reader descriptions for every station
(() => {
  const box = $('#sr-descriptions');
  for (const [id, st] of Object.entries(STATIONS)) {
    const p = document.createElement('p');
    p.id = `sr-${id}`;
    p.textContent =
      `${TITLES[id]}. ` + st.groups.map((g) => `${g.name}: ${g.items.join(', ')}.`).join(' ');
    box.appendChild(p);
  }
  const p = document.createElement('p');
  p.id = 'sr-register';
  p.textContent = `Opens the title card: ${EVENT.title}, ${EVENT.date}, ${EVENT.venue}, with the registration link.`;
  box.appendChild(p);
})();

function layoutTreeLabels() {
  leaders = leaders.filter((l) => l.group !== 'tree');
  const minY = 40;
  for (const spec of BRANCH_SPECS) {
    const b = labelEls[spec.id];
    const br = tree.branches[spec.id];
    const tip = w2s(br.tip.x, br.tip.y);
    const w = b.offsetWidth;
    const h = b.offsetHeight;
    const gap = 14;
    let x;
    let y;
    if (spec.side < 0) {
      x = tip.x - gap - w;
      y = tip.y - h / 2 - 12;
    } else if (spec.side > 0) {
      x = tip.x + gap;
      y = tip.y - h / 2 - 12;
    } else {
      x = tip.x - w / 2;
      y = tip.y - gap - h - 4;
    }
    const minX = 4;
    const maxX = view.W - 4 - w;
    if (x < minX || x > maxX) {
      // not enough room beside the tip: sit above it instead
      x = clamp(tip.x - w / 2 + spec.side * w * 0.22, minX, maxX);
      y = tip.y - 20 - h;
    }
    y = Math.max(minY, y);
    b.style.transform = `translate(${x}px, ${y}px)`;
    // the leader runs to the text, not the padded hit area
    leaders.push({ group: 'tree', ax: br.tip.x, ay: br.tip.y, rect: { x: x + 8, y: y + 6, w: w - 16, h: h - 12 }, seed: hash(spec.id) });
  }
  const g = w2s(0, 0);
  hint.style.transform = `translate(0, ${Math.round(g.y + 14)}px)`;
  dirty = true;
}

function showTreeUI() {
  layoutTreeLabels();
  state.treeLabels = true;
  nav.classList.remove('hidden');
  nav.inert = false;
  hint.classList.remove('hidden');
  hint.inert = false;
  brand.style.opacity = '1';
  backBtn.hidden = true;
  dirty = true;
}

function hideTreeUI() {
  state.treeLabels = false;
  nav.classList.add('hidden');
  nav.inert = true;
  hint.classList.add('hidden');
  hint.inert = true;
  dirty = true;
}

// ---------- stations ----------

function bez(p0, p1, p2, p3, n = 56, wobble = 0, seed = 1) {
  const rng = mulberry32(seed);
  const pts = [];
  const ph = rng() * 6;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const it = 1 - u;
    const x = it * it * it * p0[0] + 3 * it * it * u * p1[0] + 3 * it * u * u * p2[0] + u * u * u * p3[0];
    const y = it * it * it * p0[1] + 3 * it * it * u * p1[1] + 3 * it * u * u * p2[1] + u * u * u * p3[1];
    const wob = wobble * Math.sin(u * 9 + ph) * Math.sin(u * Math.PI);
    pts.push({ x: x + wob, y, u });
  }
  return pts;
}

// x of a screen-space polyline at height y (polyline runs bottom → top)
function xAtY(pts, y) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if ((a.y >= y && b.y <= y) || (a.y <= y && b.y >= y)) {
      const k = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
      return { x: a.x + (b.x - a.x) * k, u: a.u + (b.u - a.u) * k };
    }
  }
  const last = pts[pts.length - 1];
  return { x: last.x, u: 1 };
}

function stationFrame() {
  const H = view.H;
  const small = H < 640 || view.W < 360;
  const top = small ? 84 : 104;
  const tipY = H - (small ? 108 : 140);
  return { small, top, tipY, h: tipY - top, s: zoomScale(2.7) };
}

function stationCam(id) {
  const f = stationFrame();
  return camFor(tree.branches[id].tip, view.W / 2, f.tipY, f.s);
}

function registerFrame() {
  const s = zoomScale(2.6);
  const cy = clamp(view.H * 0.17, 74, 150);
  return { s, cy };
}

function registerCam() {
  const f = registerFrame();
  return camFor(carabiner.center, view.W / 2, f.cy, f.s);
}

function makeLabel(text, cls, parent, tag = 'li') {
  const el = document.createElement(tag);
  el.className = `lbl ${cls}`;
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

function placeLabel(el, ax, ay, side, maxW, gap = 14) {
  el.style.maxWidth = `${Math.max(60, maxW)}px`;
  el.style.width = 'max-content';
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let x;
  if (side < 0) {
    x = ax - gap - w;
    el.classList.add('align-r');
  } else {
    x = ax + gap;
  }
  x = clamp(x, 8, view.W - 8 - w);
  const y = ay - h / 2;
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  return { x, y, w, h };
}

// Lays out the twigs and their labels in screen space for the current
// camera, then converts the twigs to world space and stipples them.
function buildStation(id, animate) {
  const st = STATIONS[id];
  const f = stationFrame();
  const { W } = view;
  const cx = W / 2;
  const Lw = Math.min(W - 24, 600);
  const { top, tipY, h } = f;
  const seed = hash(id) ^ 99;
  stationEl.classList.toggle('small', f.small);
  stationBody.textContent = '';
  leaders = leaders.filter((l) => l.group !== 'station');

  const sideX = 0.085 * Lw;
  const curves = [
    bez([cx, tipY], [cx - 0.11 * Lw, tipY - 0.16 * h], [cx - 0.1 * Lw, tipY - 0.4 * h], [cx - sideX, top + 0.47 * h], 56, 2, seed + 1),
    bez([cx, tipY], [cx + 0.11 * Lw, tipY - 0.16 * h], [cx + 0.1 * Lw, tipY - 0.4 * h], [cx + sideX, top + 0.47 * h], 56, 2, seed + 2),
    bez([cx, tipY], [cx + 0.015 * Lw, tipY - 0.35 * h], [cx - 0.02 * Lw, top + 0.38 * h], [cx, top + 0.03 * h], 70, 1.5, seed + 3),
  ];

  const anchors = []; // {sx, sy, u, curve, el, order}
  st.groups.forEach((g, gi) => {
    const sec = document.createElement('section');
    sec.className = 'twig-group';
    sec.setAttribute('aria-label', g.name);
    const name = makeLabel(g.name, `twig-name tone-${g.tone}`, sec, 'h3');
    const ul = document.createElement('ul');
    sec.appendChild(ul);
    const items = g.items.map((t) => makeLabel(t, 'item', ul));
    stationBody.appendChild(sec);

    const pts = curves[gi];
    const end = pts[pts.length - 1];
    if (gi < 2) {
      const side = gi === 0 ? -1 : 1;
      const nameMax = side < 0 ? end.x - 22 : W - end.x - 22;
      anchors.push({ sx: end.x, sy: end.y, u: 1, gi, el: name, side, maxW: nameMax, kind: 'name' });
      const y0 = end.y + 46;
      const y1 = tipY - 0.1 * h;
      const step = items.length > 1 ? Math.min(58, (y1 - y0) / (items.length - 1)) : 0;
      items.forEach((el, i) => {
        const y = y0 + i * step;
        const p = xAtY(pts, y);
        const maxW = side < 0 ? p.x - 22 : W - p.x - 22;
        anchors.push({ sx: p.x, sy: y, u: p.u, gi, el, side, maxW, kind: 'item' });
      });
    } else {
      anchors.push({ sx: end.x, sy: end.y, u: 1, gi, el: name, side: 1, maxW: Lw / 2 - 20, kind: 'name' });
      const y0 = top + 0.12 * h;
      const y1 = top + 0.37 * h;
      const step = items.length > 1 ? Math.min(52, (y1 - y0) / (items.length - 1)) : 0;
      items.forEach((el, i) => {
        const y = y0 + i * step;
        const p = xAtY(pts, y);
        const side = i % 2 === 0 ? -1 : 1;
        anchors.push({ sx: p.x, sy: y, u: p.u, gi, el, side, maxW: Lw / 2 - 22, kind: 'item' });
      });
    }
  });

  // world-space geometry
  const c = { ...cam };
  const toW = (sx, sy) => ({ x: c.x + (sx - W / 2) / c.s, y: c.y - (sy - view.H / 2) / c.s });
  const px = 1 / c.s;
  const twigList = curves.map((pts, i) => ({
    pts: pts.map((p) => toW(p.x, p.y)),
    w0: (i < 2 ? 3.8 : 2.4) * px,
    w1: (i < 2 ? 1.3 : 0.9) * px,
    t0: i === 2 ? 0.08 : 0,
    t1: i === 2 ? 0.8 : 0.7,
    dens: 1.1 * c.s,
    spines: i < 2,
  }));
  const tOf = (a) => (a.gi === 2 ? 0.08 + 0.72 * a.u : 0.7 * a.u);
  const buds = anchors.map((a) => {
    const w = toW(a.sx, a.sy);
    const tone = st.groups[a.gi].tone;
    return { x: w.x, y: w.y, r: (a.kind === 'name' ? 3.4 : 2.4) * px, n: a.kind === 'name' ? 26 : 14, t: tOf(a), c: tone === 'gold' ? 5 : tone === 'rose' ? 4 : 2 };
  });
  const clouds = curves.slice(0, 2).map((pts) => {
    const e = pts[pts.length - 1];
    const w = toW(e.x, e.y - 6);
    return { x: w.x, y: w.y, r: 9 * px, t: 0.72, dens: 0.3 * c.s * c.s };
  });
  state.twigs = buildTwigs({ seed, twigs: twigList, buds, clouds });
  state.twigGrow = animate ? 0 : 1;
  if (animate) tween(1100, (u) => ((state.twigGrow = easeOut(u)), (dirty = true)));

  // place labels and schedule their entrance
  let order = 0;
  const now = performance.now();
  const sorted = [...anchors].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'name' ? -1 : 1));
  for (const a of anchors) {
    const rect = placeLabel(a.el, a.sx, a.sy, a.side, a.maxW, a.kind === 'name' ? 12 : 16);
    const wpt = toW(a.sx, a.sy);
    const idx = sorted.indexOf(a);
    const delay = animate ? (a.kind === 'name' ? 720 : 820 + idx * 95) : 0;
    order++;
    const L = { group: 'station', ax: wpt.x, ay: wpt.y, rect, seed: seed + order, start: now + delay, dur: animate ? 320 : 1 };
    leaders.push(L);
    if (animate) later(delay + 120, () => a.el.classList.add('in'));
    else a.el.classList.add('in');
  }
  dirty = true;
}

function open(id) {
  if (state.busy || state.view !== 'tree') return;
  state.busy = true;
  state.station = id;
  state.focus = id;
  hideTreeUI();
  brand.style.opacity = '0';
  const br = tree.branches[id];
  const isReg = id === 'register';
  const target = isReg ? registerCam() : stationCam(id);
  const arrive = () => {
    state.busy = false;
    state.view = isReg ? 'register' : 'station';
    showBack();
    if (isReg) showReveal(!reduced);
    else showStation(id, !reduced);
  };
  if (reduced) cut(target, 0.14, arrive);
  else flyAlong(br, target, isReg ? 2200 : 1700, arrive);
}

function showStation(id, animate) {
  $('#station-kicker').textContent = STATIONS[id].kicker;
  $('#station-title').textContent = TITLES[id];
  stationEl.hidden = false;
  buildStation(id, animate);
  requestAnimationFrame(() => stationEl.classList.add('in'));
  $('#station-title').focus({ preventScroll: true });
  live.textContent = `${TITLES[id]} opened. Press Escape or the back button to return to the tree.`;
}

function showReveal(animate) {
  state.carGrow = animate ? 0 : 1;
  if (animate) tween(1500, (u) => ((state.carGrow = easeOut(u)), (dirty = true)));
  positionReveal();
  revealEl.hidden = false;
  later(animate ? 650 : 0, () => {
    revealEl.classList.add('in');
    paintPills();
  });
  $('#reveal-title').focus({ preventScroll: true });
  live.textContent = `${EVENT.title}. ${EVENT.date}, ${EVENT.venue}.`;
}

function positionReveal() {
  const f = registerFrame();
  const top = f.cy + carabiner.ry * f.s + 30;
  revealEl.style.setProperty('--card-top', `${Math.round(top)}px`);
}

// ---------- roots ----------

function rootsCam() {
  const s = zoomScale(1.55);
  const g = clamp(view.H * 0.16, 70, 150);
  return camFor({ x: 0, y: 0 }, view.W / 2, g, s);
}

function layoutRoots() {
  leaders = leaders.filter((l) => l.group !== 'roots');
  const tips = tree.rootTips.filter((p) => p.y < -60);
  const screen = tips.map((p) => ({ p, s: w2s(p.x, p.y) })).filter((o) => o.s.x > 20 && o.s.x < view.W - 20);
  const lowest = Math.max(...screen.map((o) => o.s.y));
  const left = screen.reduce((a, b) => (b.s.x < a.s.x ? b : a));
  const right = screen.reduce((a, b) => (b.s.x > a.s.x ? b : a));
  const mid = screen.reduce((a, b) => (Math.abs(b.s.x - view.W / 2) + (lowest - b.s.y) < Math.abs(a.s.x - view.W / 2) + (lowest - a.s.y) ? b : a));
  const room = view.H - 90 - lowest;
  const y0 = lowest + clamp(room * 0.18, 26, 70);
  const gap = clamp(room / 4.4, 54, 92);
  const W = view.W;
  const items = [
    { el: $('#root-date'), at: left, y: y0, align: 'l' },
    { el: $('#root-venue'), at: right, y: y0 + gap, align: 'r' },
    { el: $('#root-hosts'), at: mid, y: y0 + gap * 2, align: 'c' },
  ];
  const margin = Math.max(16, W / 2 - 230);
  for (const it of items) {
    const w = it.el.offsetWidth;
    const h = it.el.offsetHeight;
    const x = it.align === 'l' ? margin : it.align === 'r' ? W - margin - w : W / 2 - w / 2;
    it.el.classList.toggle('align-r', it.align === 'r');
    it.el.classList.toggle('align-c', it.align === 'c');
    it.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(it.y)}px)`;
    leaders.push({ group: 'roots', ax: it.at.p.x, ay: it.at.p.y, rect: { x, y: it.y, w, h }, seed: hash(it.el.id) });
  }
  const logos = $('#root-logos');
  logos.style.transform = `translate(${Math.round(W / 2 - logos.offsetWidth / 2)}px, ${Math.round(y0 + gap * 3)}px)`;
  dirty = true;
}

function openRoots() {
  if (state.busy || state.view !== 'tree') return;
  state.busy = true;
  hideTreeUI();
  const arrive = () => {
    state.busy = false;
    state.view = 'roots';
    rootsEl.hidden = false;
    showBack();
    layoutRoots();
    requestAnimationFrame(() => rootsEl.classList.add('in'));
    $('#roots-title').focus({ preventScroll: true });
    live.textContent = `The roots. ${EVENT.date}. ${EVENT.venue}. ${EVENT.hosts}.`;
  };
  if (reduced) cut(rootsCam(), 1, arrive);
  else glide(rootsCam(), 1200, 1, arrive);
}

// ---------- back ----------

function close() {
  if (state.busy || !['station', 'register', 'roots'].includes(state.view)) return;
  state.busy = true;
  const from = state.view;
  const id = state.station;
  clearTimers();
  stationEl.classList.remove('in');
  stationBody.querySelectorAll('.lbl').forEach((el) => el.classList.remove('in'));
  revealEl.classList.remove('in');
  rootsEl.classList.remove('in');
  leaders = leaders.filter((l) => l.group === 'tree');
  backBtn.hidden = true;
  const finish = () => {
    state.busy = false;
    state.view = 'tree';
    state.station = null;
    state.focus = null;
    state.twigs = null;
    state.carGrow = 0;
    stationEl.hidden = true;
    revealEl.hidden = true;
    rootsEl.hidden = true;
    showTreeUI();
    const target = from === 'roots' ? $('#roots-btn') : labelEls[id];
    target?.focus({ preventScroll: true });
    live.textContent = 'Back to the full tree.';
  };
  const target = fitCam();
  if (reduced) {
    cut(target, 1, finish);
    state.twigs = null;
    state.carGrow = 0;
    return;
  }
  const tg0 = state.twigGrow;
  const cg0 = state.carGrow;
  glide(target, 1150, 1, finish);
  tween(450, (u) => {
    state.twigGrow = tg0 * (1 - u);
    state.carGrow = cg0 * (1 - u);
  });
}

function showBack() {
  backBtn.hidden = false;
  drawPill(backBtn.querySelector('canvas'), { seed: 3 });
}

backBtn.addEventListener('click', close);
$('#roots-btn').addEventListener('click', openRoots);

// ---------- input ----------

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') close();
  else if ((e.key === 'ArrowDown' || e.key === 'PageDown') && state.view === 'tree') {
    e.preventDefault();
    openRoots();
  } else if ((e.key === 'ArrowUp' || e.key === 'PageUp') && state.view === 'roots') {
    e.preventDefault();
    close();
  }
});

let wheelLock = 0;
window.addEventListener(
  'wheel',
  (e) => {
    if (e.target.closest?.('.card')) return;
    const now = performance.now();
    if (now < wheelLock || Math.abs(e.deltaY) < 6) return;
    if (state.view === 'tree' && e.deltaY > 0) {
      wheelLock = now + 1400;
      openRoots();
    } else if (state.view === 'roots' && e.deltaY < 0) {
      wheelLock = now + 1400;
      close();
    }
  },
  { passive: true },
);

let touch = null;
window.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length === 1) touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  },
  { passive: true },
);
window.addEventListener(
  'touchend',
  (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    touch = null;
    if (Math.abs(dy) < 60 || Math.abs(dy) < Math.abs(dx) * 1.3) return;
    if (state.view === 'tree') openRoots();
    else if (state.view === 'roots' && dy > 0) close();
  },
  { passive: true },
);

// tapping the branch itself, not just its label
let down = null;
canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return;
  down = null;
  if (state.view !== 'tree') return;
  let best = null;
  let bestD = 26;
  for (const spec of BRANCH_SPECS) {
    const br = tree.branches[spec.id];
    for (let i = Math.floor(br.pts.length * 0.3); i < br.pts.length; i += 2) {
      const p = w2s(br.pts[i].x, br.pts[i].y);
      const d = Math.hypot(p.x - e.clientX, p.y - e.clientY);
      if (d < bestD) {
        bestD = d;
        best = spec.id;
      }
    }
  }
  if (best) open(best);
});

// ---------- drawing ----------

function drawLeader(L, now) {
  const p = L.start ? clamp((now - L.start) / L.dur, 0, 1) : 1;
  if (p <= 0) return false;
  const a = w2s(L.ax, L.ay);
  const r = L.rect;
  const ex = clamp(a.x, r.x - 4, r.x + r.w + 4);
  const ey = clamp(a.y, r.y - 3, r.y + r.h + 3);
  const dx = ex - a.x;
  const dy = ey - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 6) return p < 1;
  const rng = mulberry32(L.seed);
  const bend = (rng() - 0.5) * 0.3 * len;
  const mx = (a.x + ex) / 2 - (dy / len) * bend;
  const my = (a.y + ey) / 2 + (dx / len) * bend;
  const step = 2.3;
  const total = len / step;
  const n = Math.floor(total * p);
  const d = view.dpr;
  const sz = Math.max(1, Math.round(1.05 * d));
  ctx.beginPath();
  for (let i = 2; i < n; i++) {
    const jx = (rng() - 0.5) * 1.1;
    const jy = (rng() - 0.5) * 1.1;
    const skip = rng() < 0.1;
    if (skip) continue;
    const t = i / total;
    const it = 1 - t;
    const x = it * it * a.x + 2 * it * t * mx + t * t * ex + jx;
    const y = it * it * a.y + 2 * it * t * my + t * t * ey + jy;
    ctx.rect(Math.round(x * d), Math.round(y * d), sz, sz);
  }
  ctx.fill();
  return p < 1;
}

function draw(now) {
  const { W, H, dpr } = view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const dotPx = clamp(1.25 * cam.s, 0.85, 2.6);
  const dens = density * clamp(0.6 + cam.s * 0.55, 0.6, 1);
  renderLayer(ctx, tree.layers.base, cam, view, state.grow, dens, dotPx, state.focus ? Math.max(state.dim, 0.3) : 1);
  for (const spec of BRANCH_SPECS) {
    const alpha = spec.id === state.focus ? 1 : state.dim;
    renderLayer(ctx, tree.layers[spec.id], cam, view, state.grow, dens, dotPx, alpha);
  }
  if (state.carGrow > 0) renderLayer(ctx, carabiner.layer, cam, view, state.carGrow, Math.min(1, density + 0.1), dotPx);
  if (state.twigs) renderLayer(ctx, state.twigs, cam, view, state.twigGrow, Math.min(1, density + 0.1), dotPx);

  let animating = false;
  ctx.fillStyle = 'rgba(210,188,200,0.7)';
  for (const L of leaders) {
    if (L.group === 'tree' && !state.treeLabels) continue;
    if (drawLeader(L, now)) animating = true;
  }
  return animating;
}

function frame(now) {
  requestAnimationFrame(frame);
  const active = tweens.length > 0;
  runTweens(now);
  if (!dirty && !active && !state.leadersMoving) {
    perf.last = 0;
    return;
  }
  dirty = false;
  state.leadersMoving = draw(now);
  // adapt the dot budget to the device
  if (perf.last) {
    const dt = now - perf.last;
    perf.ema = perf.ema * 0.9 + dt * 0.1;
    if (perf.ema > 24 && density > 0.35) {
      if (++perf.slow > 20) {
        density *= 0.85;
        perf.slow = 0;
        perf.ema = 16;
      }
    } else perf.slow = 0;
  }
  perf.last = now;
}

// ---------- resize ----------

function resize() {
  view.W = window.innerWidth;
  view.H = window.innerHeight;
  view.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(view.W * view.dpr);
  canvas.height = Math.round(view.H * view.dpr);
  if (state.busy) {
    dirty = true;
    return;
  }
  if (state.view === 'tree' || state.view === 'intro') {
    Object.assign(cam, fitCam());
    layoutTreeLabels();
  } else if (state.view === 'station') {
    Object.assign(cam, stationCam(state.station));
    buildStation(state.station, false);
  } else if (state.view === 'register') {
    Object.assign(cam, registerCam());
    positionReveal();
  } else if (state.view === 'roots') {
    Object.assign(cam, rootsCam());
    layoutRoots();
  }
  paintPills();
  dirty = true;
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resize, 80);
});

// ---------- pills, logos, register link ----------

function paintPills() {
  drawPill(backBtn.querySelector('canvas'), { seed: 3 });
  drawPill($('#player > canvas'), { seed: 7 });
  drawPill($('#register-link > canvas'), { color: '198,161,88', fill: 0.2, edge: 1, seed: 11 });
}

document.querySelectorAll('img.logo').forEach((img) => {
  const fail = () => {
    const span = document.createElement('span');
    span.className = 'logo-fallback';
    span.textContent = img.dataset.fallback;
    span.setAttribute('role', 'img');
    span.setAttribute('aria-label', img.alt);
    img.replaceWith(span);
    if (state.view === 'roots') layoutRoots();
  };
  if (img.complete && img.naturalWidth === 0) fail();
  else img.addEventListener('error', fail, { once: true });
  img.addEventListener('load', () => state.view === 'roots' && layoutRoots());
});

(() => {
  const a = $('#register-link');
  if (/^https?:\/\//i.test(REGISTER_URL)) {
    a.href = REGISTER_URL;
    a.setAttribute('aria-label', 'register for the workshop (opens in a new tab)');
  } else {
    a.removeAttribute('href');
    a.setAttribute('aria-disabled', 'true');
    a.querySelector('.pill-text').textContent = 'registration opens soon';
    a.lastElementChild.remove();
  }
})();

// ---------- 512 Hz ----------

const player = $('#player');
const waveCanvas = player.querySelector('.wave');
const wctx = waveCanvas.getContext('2d');
let audio = null;
let tone = null;

function drawWave(phase, amp) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = 28 * dpr;
  const h = 16 * dpr;
  if (waveCanvas.width !== w) {
    waveCanvas.width = w;
    waveCanvas.height = h;
  }
  wctx.clearRect(0, 0, w, h);
  wctx.fillStyle = 'rgba(210,188,200,0.9)';
  wctx.beginPath();
  const sz = Math.max(1, Math.round(dpr));
  for (let x = 0; x < w; x += 2 * dpr) {
    const y = h / 2 + Math.sin(x / (3.2 * dpr) + phase) * amp * (h / 2 - 2 * dpr);
    wctx.rect(x | 0, y | 0, sz, sz);
  }
  wctx.fill();
}

function stopTone() {
  if (!tone) return;
  const t = audio.currentTime;
  tone.gain.gain.cancelScheduledValues(t);
  tone.gain.gain.setValueAtTime(tone.gain.gain.value, t);
  tone.gain.gain.linearRampToValueAtTime(0, t + 0.15);
  tone.osc.stop(t + 0.2);
}

player.addEventListener('click', () => {
  if (tone) {
    stopTone();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audio = audio || new AC();
  audio.resume();
  const t = audio.currentTime + 0.02;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.value = 512;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.06, t + 0.35);
  gain.gain.setValueAtTime(0.06, t + 1.3);
  gain.gain.linearRampToValueAtTime(0, t + 2);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + 2.05);
  tone = { osc, gain, start: performance.now() };
  player.setAttribute('aria-pressed', 'true');
  osc.onended = () => {
    tone = null;
    player.setAttribute('aria-pressed', 'false');
  };
  const animate = (now) => {
    if (!tone) {
      drawWave(0, 0);
      return;
    }
    const el = (now - tone.start) / 1000;
    const amp = Math.min(1, el / 0.35) * Math.min(1, Math.max(0, (2 - el) / 0.7));
    drawWave(reduced ? 0 : el * 14, reduced ? 0.6 : amp);
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
});

// ---------- start ----------

resize();
drawWave(0, 0);
paintPills();
document.fonts?.ready.then(() => {
  if (state.view === 'tree' || state.view === 'intro') layoutTreeLabels();
  paintPills();
});

function revealTree() {
  state.view = 'tree';
  showTreeUI();
}

if (reduced) {
  state.grow = 1;
  revealTree();
} else {
  later(400, () => hint.classList.remove('hidden'));
  tween(
    3000,
    (u) => {
      state.grow = easeOut(u) * 1.001;
      if (u > 0.82 && state.view === 'intro') revealTree();
      dirty = true;
    },
    () => (state.timers = []),
  );
}
requestAnimationFrame(frame);
