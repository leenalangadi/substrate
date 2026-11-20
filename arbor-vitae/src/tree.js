// Procedural stippled tree: every mark is a tiny square dot in world space.
// World units: y points up, the ground line is y = 0, the trunk is x ≈ 0.

export const PALETTE = [
  '#D2BCC8', // 0 lilac
  'rgba(210,188,200,0.46)', // 1 lilac, faded
  '#F7F3EE', // 2 ivory
  '#794C6E', // 3 orchid
  '#A85C71', // 4 rose
  '#C6A158', // 5 champagne gold
];
export const C = { LILAC: 0, DIM: 1, IVORY: 2, ORCHID: 3, ROSE: 4, GOLD: 5 };
const SIZE = [1, 1, 1.25, 1.1, 1.2, 1.2];
const TAU = Math.PI * 2;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const angDiff = (t, a) => {
  let d = t - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
};

// Collects dots, then packs them into typed arrays sorted by colour so a
// whole colour can be drawn with a single fill().
export class Dots {
  constructor(seed) {
    this.rng = mulberry32(seed);
    this.xs = [];
    this.ys = [];
    this.ts = [];
    this.cs = [];
  }
  add(x, y, t, c) {
    this.xs.push(x);
    this.ys.push(y);
    this.ts.push(t);
    this.cs.push(c);
  }
  color(ivory = 0.07, dim = 0.3, orchid = 0) {
    const r = this.rng();
    if (r < ivory) return C.IVORY;
    if (r < ivory + orchid) return C.ORCHID;
    if (r < ivory + orchid + dim) return C.DIM;
    return C.LILAC;
  }
  segment(x0, y0, x1, y1, w0, w1, t0, t1, dens, colorFn) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const L = Math.hypot(dx, dy);
    if (!L) return;
    const nx = -dy / L;
    const ny = dx / L;
    const n = Math.max(1, Math.round(L * (((w0 + w1) / 2) * dens + 0.32)));
    const rng = this.rng;
    for (let i = 0; i < n; i++) {
      const u = rng();
      const w = w0 + (w1 - w0) * u;
      let a = (rng() + rng() - 1) * 0.58 * w;
      if (rng() < 0.035) a *= 2.4; // toner spray
      this.add(x0 + dx * u + nx * a, y0 + dy * u + ny * a, t0 + (t1 - t0) * u, colorFn());
    }
  }
  polyline(pts, wFn, t0, t1, dens, colorFn) {
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (!total) return;
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1];
      const q = pts[i];
      const l = Math.hypot(q.x - p.x, q.y - p.y);
      const u0 = acc / total;
      const u1 = (acc + l) / total;
      this.segment(p.x, p.y, q.x, q.y, wFn(u0), wFn(u1), t0 + (t1 - t0) * u0, t0 + (t1 - t0) * u1, dens, colorFn);
      acc += l;
    }
  }
  cloud(cx, cy, r, n, t0, t1, colorFn) {
    const rng = this.rng;
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU;
      let rr = r * Math.sqrt(rng());
      if (rng() < 0.12) rr *= 1.3;
      this.add(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, t0 + (t1 - t0) * rng(), colorFn());
    }
  }
  // An irregular clump made of a few overlapping dot clouds.
  foliage(cx, cy, r, t0, t1, dens = 0.2) {
    const rng = this.rng;
    const lobes = 3 + Math.floor(rng() * 3);
    for (let k = 0; k < lobes; k++) {
      const a = rng() * TAU;
      const d = r * 0.55 * rng();
      const lr = r * (0.45 + 0.4 * rng());
      const n = Math.round(Math.PI * lr * lr * dens);
      this.cloud(cx + Math.cos(a) * d, cy + Math.sin(a) * d, lr, n, t0, t1, () => this.color(0.09, 0.34, 0.1));
    }
  }
  finish() {
    const n = this.xs.length;
    const counts = new Array(PALETTE.length).fill(0);
    for (const c of this.cs) counts[c]++;
    const starts = [];
    let s = 0;
    for (let k = 0; k < counts.length; k++) {
      starts[k] = s;
      s += counts[k];
    }
    const X = new Float32Array(n);
    const Y = new Float32Array(n);
    const T = new Float32Array(n);
    const R = new Float32Array(n);
    const pos = starts.slice();
    for (let i = 0; i < n; i++) {
      const j = pos[this.cs[i]]++;
      X[j] = this.xs[i];
      Y[j] = this.ys[i];
      T[j] = this.ts[i];
      R[j] = this.rng();
    }
    return { n, X, Y, T, R, ranges: starts.map((st, k) => [st, st + counts[k]]) };
  }
}

// A wandering path: curvature drifts like a dendrite, with a gentle pull toward `target`.
function walk(rng, x, y, a, len, step, wiggle, pull, target = Math.PI / 2) {
  const pts = [{ x, y, a }];
  let da = 0;
  for (let d = 0; d < len; d += step) {
    da += (rng() - 0.5) * wiggle;
    da *= 0.8;
    a += da + angDiff(target, a) * pull;
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    pts.push({ x, y, a });
  }
  return pts;
}

const deg = (d) => (d * Math.PI) / 180;

// Main branches: id, label, height on the trunk, side, angle (degrees), length.
export const BRANCH_SPECS = [
  { id: 'vertigo', y: 200, side: -1, a: 165, len: 280 },
  { id: 'hearing', y: 250, side: 1, a: 12, len: 285 },
  { id: 'facial', y: 330, side: -1, a: 140, len: 280 },
  { id: 'tinnitus', y: 400, side: 1, a: 32, len: 260 },
  { id: 'headache', y: 470, side: -1, a: 128, len: 250 },
  { id: 'taste', y: 540, side: 1, a: 45, len: 235 },
  { id: 'about', y: 615, side: -1, a: 120, len: 200 },
  { id: 'speakers', y: 650, side: 1, a: 62, len: 190 },
  { id: 'register', y: 740, side: 0, a: 90, len: 250 },
];

const TRUNK_TOP = 740;
const trunkX = (y) => 7 * Math.sin(y * 0.009 + 0.7) + 3 * Math.sin(y * 0.027 + 2);
const trunkW = (y) => 17 - 11 * (y / TRUNK_TOP) + 12 * Math.exp(-y / 26);
const trunkT = (y) => 0.1 + 0.3 * (y / TRUNK_TOP);

function withLengths(pts) {
  let acc = 0;
  pts[0].l = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    pts[i].l = acc;
  }
  return acc;
}

export function pointAt(br, u) {
  const target = br.length * Math.min(1, Math.max(0, u));
  const pts = br.pts;
  let i = 1;
  while (i < pts.length - 1 && pts[i].l < target) i++;
  const p = pts[i - 1];
  const q = pts[i];
  const k = q.l > p.l ? (target - p.l) / (q.l - p.l) : 0;
  return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
}

function twigs(D, parent, wFn, t0, t1, depth, opts) {
  const rng = D.rng;
  const count = depth === 0 ? opts.count : 1 + Math.floor(rng() * 2);
  for (let k = 0; k < count; k++) {
    const u = opts.uMin + (opts.uMax - opts.uMin) * ((k + rng() * 0.8) / count);
    const idx = Math.min(parent.length - 1, Math.floor(u * (parent.length - 1)));
    const p = parent[idx];
    const side = k % 2 === 0 ? (rng() < 0.7 ? 1 : -1) : rng() < 0.7 ? -1 : 1;
    const a = p.a + side * (0.45 + 0.55 * rng());
    const len = opts.len * (depth === 0 ? 0.6 + 0.5 * rng() : 0.4 + 0.3 * rng());
    const w = Math.max(0.9, wFn(u) * 0.55);
    const pts = walk(rng, p.x, p.y, a, len, 5, 0.16, 0.004);
    const ts = t0 + (t1 - t0) * u;
    const te = ts + 0.13;
    D.polyline(pts, (v) => w * (1 - v) + 0.5 * v, ts, te, 0.55, () => D.color(0.06, 0.32));
    const tip = pts[pts.length - 1];
    if (depth < 1) twigs(D, pts, (v) => w * (1 - v) + 0.5 * v, ts, te, depth + 1, { ...opts, uMin: 0.35, uMax: 0.85 });
    D.foliage(tip.x, tip.y, (depth === 0 ? 15 : 11) + rng() * 9, te - 0.02, te + 0.12);
  }
}

// Short dendritic spines along a branch.
function spines(D, pts, t0, t1) {
  const rng = D.rng;
  for (let i = 2; i < pts.length - 2; i++) {
    if (rng() > 0.3) continue;
    const p = pts[i];
    const a = p.a + (rng() < 0.5 ? 1 : -1) * (0.8 + 0.6 * rng());
    const l = 3 + rng() * 7;
    const t = t0 + ((t1 - t0) * i) / pts.length;
    D.segment(p.x, p.y, p.x + Math.cos(a) * l, p.y + Math.sin(a) * l, 0.9, 0.3, t, t + 0.03, 0.6, () => D.color(0.1, 0.4));
  }
}

export function buildTree(seed = 20261205) {
  const branches = {};
  const layers = {};
  let minX = Infinity;
  let maxX = -Infinity;

  for (const spec of BRANCH_SPECS) {
    const D = new Dots(seed ^ hash(spec.id));
    const rng = D.rng;
    const x0 = trunkX(spec.y);
    const isReg = spec.id === 'register';
    // curve gently upward: start at the spec angle, drift toward a steeper one
    const aim = deg(spec.a + (90 - spec.a) * 0.45);
    const pts = walk(rng, x0, spec.y, deg(spec.a), spec.len, 6, isReg ? 0.02 : 0.1, isReg ? 0.08 : 0.03, aim);
    const length = withLengths(pts);
    const w0 = isReg ? 6.5 : trunkW(spec.y) * 0.6;
    const w1 = isReg ? 2.4 : 1.7;
    const wFn = (u) => w0 + (w1 - w0) * Math.pow(u, 0.8);
    const t0 = trunkT(spec.y);
    const t1 = t0 + 0.3;
    D.polyline(pts, wFn, t0, t1, 0.6, () => D.color(0.07, 0.28));
    spines(D, pts, t0, t1);
    twigs(D, pts, wFn, t0, t1, 0, {
      count: isReg ? 3 : spec.id === 'about' || spec.id === 'speakers' ? 3 : 4,
      uMin: 0.22,
      uMax: isReg ? 0.62 : 0.72,
      len: spec.len * 0.32,
    });
    const tip = pts[pts.length - 1];
    // a bud at the tip marks the tappable end
    D.cloud(tip.x, tip.y, 3.2, 26, t1 - 0.02, t1 + 0.04, () =>
      rng() < 0.5 ? C.IVORY : isReg ? C.GOLD : C.ROSE,
    );
    const layer = D.finish();
    for (let i = 0; i < layer.n; i++) {
      if (layer.X[i] < minX) minX = layer.X[i];
      if (layer.X[i] > maxX) maxX = layer.X[i];
    }
    branches[spec.id] = { ...spec, pts, length, tip: { x: tip.x, y: tip.y }, tipA: tip.a };
    layers[spec.id] = layer;
  }

  // trunk, roots, ground
  const D = new Dots(seed);
  const rng = D.rng;
  const trunk = [];
  for (let y = -6; y <= TRUNK_TOP; y += 6) trunk.push({ x: trunkX(y), y, a: Math.PI / 2 });
  D.polyline(
    trunk,
    (u) => trunkW(-6 + u * (TRUNK_TOP + 6)),
    0.1,
    0.4,
    0.62,
    () => D.color(0.06, 0.24),
  );
  spines(D, trunk.slice(20), 0.15, 0.4);

  const rootTips = [];
  const rootCount = 9;
  for (let k = 0; k < rootCount; k++) {
    const spread = (k / (rootCount - 1) - 0.5) * 2; // -1 … 1
    const a = -Math.PI / 2 + spread * 1.15 + (rng() - 0.5) * 0.2;
    const len = 120 + rng() * 110 - Math.abs(spread) * 30;
    const pts = walk(rng, spread * 10, -4, a, len, 5, 0.18, 0.006, -Math.PI / 2);
    const w0 = 5 + rng() * 3;
    D.polyline(pts, (u) => w0 * (1 - u) + 0.5 * u, 0.02, 0.26, 0.5, () => D.color(0.05, 0.45));
    rootTips.push(pts[pts.length - 1]);
    for (let j = 0; j < 3; j++) {
      const p = pts[Math.floor((0.25 + 0.55 * rng()) * pts.length)];
      const sub = walk(rng, p.x, p.y, p.a + (rng() - 0.5) * 1.6, 30 + rng() * 50, 4, 0.3, 0.01, -Math.PI / 2);
      D.polyline(sub, (u) => 1.6 * (1 - u) + 0.3 * u, 0.1, 0.3, 0.5, () => D.color(0.03, 0.55));
      const st = sub[sub.length - 1];
      rootTips.push(st);
      // hair roots
      for (let q = 0; q < 2; q++) {
        const h = walk(rng, st.x, st.y, st.a + (rng() - 0.5) * 2, 8 + rng() * 14, 3, 0.5, 0, -Math.PI / 2);
        D.polyline(h, () => 0.5, 0.22, 0.3, 0.5, () => C.DIM);
      }
    }
  }

  // ground line, soil speckle and grass
  const gx0 = Math.min(minX, -300) - 20;
  const gx1 = Math.max(maxX, 300) + 20;
  const gw = gx1 - gx0;
  for (let i = 0; i < gw * 2.4; i++) {
    const x = gx0 + rng() * gw;
    D.add(x, (rng() - 0.6) * 3, rng() * 0.15, D.color(0.04, 0.5));
  }
  for (let i = 0; i < gw * 1.1; i++) {
    const x = gx0 + rng() * gw;
    D.add(x, -Math.pow(rng(), 2.2) * 34, rng() * 0.2, rng() < 0.8 ? C.DIM : C.ORCHID);
  }
  const blades = Math.round(gw * 0.5);
  for (let i = 0; i < blades; i++) {
    const x = gx0 + rng() * gw;
    const edge = Math.min(x - gx0, gx1 - x) / 60;
    const h = (3 + rng() * 11) * Math.min(1, edge) * (rng() < 0.08 ? 1.8 : 1);
    const lean = (rng() - 0.5) * 0.9;
    const t = rng() * 0.16;
    const n = Math.max(2, Math.round(h * 1.3));
    for (let j = 0; j < n; j++) {
      const v = j / n;
      D.add(x + lean * h * v * v + (rng() - 0.5) * 0.6, h * v, t + v * 0.05, D.color(0.06, 0.35));
    }
  }
  // a few small plants
  const plants = [-0.82, -0.55, -0.3, 0.27, 0.58, 0.86];
  for (const f of plants) {
    const px = f * (gw / 2 - 30);
    const stem = walk(rng, px, 0, Math.PI / 2 + (rng() - 0.5) * 0.4, 16 + rng() * 26, 3, 0.25, 0.04);
    D.polyline(stem, () => 0.9, 0.08, 0.22, 0.7, () => D.color(0.05, 0.3));
    for (let j = 0; j < 3; j++) {
      const p = stem[Math.floor((0.35 + 0.65 * rng()) * (stem.length - 1))];
      const side = j % 2 ? 1 : -1;
      D.cloud(p.x + side * (3 + rng() * 3), p.y + rng() * 2, 2.2 + rng() * 2.4, 22, 0.2, 0.3, () => D.color(0.1, 0.3, 0.1));
    }
    const top = stem[stem.length - 1];
    if (f === -0.55 || f === 0.58) D.cloud(top.x, top.y + 1.5, 2.6, 22, 0.28, 0.33, () => (rng() < 0.6 ? C.ROSE : C.IVORY));
    else D.cloud(top.x, top.y, 2.4, 16, 0.26, 0.32, () => D.color(0.15, 0.3));
  }
  layers.base = D.finish();

  const reg = branches.register;
  const bounds = { minX: gx0 + 10, maxX: gx1 - 10, minY: -120, maxY: reg.tip.y + 40 };
  return { branches, layers, rootTips, bounds, ground: { x0: gx0, x1: gx1 } };
}

// Station twigs, generated on demand once the camera has arrived.
export function buildTwigs({ seed, twigs: list, buds, clouds }) {
  const D = new Dots(seed);
  for (const tw of list) {
    D.polyline(tw.pts, (u) => tw.w0 + (tw.w1 - tw.w0) * u, tw.t0, tw.t1, tw.dens, () => D.color(0.08, 0.26));
    if (tw.spines) spines(D, tw.pts.map((p, i, a) => ({ ...p, a: Math.atan2(a[Math.min(i + 1, a.length - 1)].y - p.y, a[Math.min(i + 1, a.length - 1)].x - p.x) })), tw.t0, tw.t1);
  }
  for (const b of buds) D.cloud(b.x, b.y, b.r, b.n, b.t, b.t + 0.06, () => (D.rng() < 0.55 ? C.IVORY : b.c));
  for (const c of clouds) D.foliage(c.x, c.y, c.r, c.t, c.t + 0.2, c.dens);
  return D.finish();
}

// A climbing carabiner at the top of the register branch, with two ropes
// draped over it and falling away to either side.
export function buildCarabiner(tip, seed = 512) {
  const D = new Dots(seed);
  const rng = D.rng;
  const rx = 17;
  const ry = 27;
  const cx = tip.x;
  const cy = tip.y + ry - 2;
  const col = () => {
    const r = rng();
    return r < 0.5 ? C.GOLD : r < 0.68 ? C.IVORY : C.LILAC;
  };
  // the body: an oval ring, with the gate opening on the right
  const steps = 160;
  for (let i = 0; i < steps; i++) {
    const th0 = (i / steps) * TAU;
    const th1 = ((i + 1) / steps) * TAU;
    const gate = Math.cos(th0) > 0.55 && Math.abs(Math.sin(th0)) < 0.62;
    if (gate) continue;
    const w = 3.4 + 1.6 * Math.max(0, -Math.cos(th0)); // spine is heavier
    const t = 0.05 + (i / steps) * 0.4;
    D.segment(cx + Math.cos(th0) * rx, cy + Math.sin(th0) * ry, cx + Math.cos(th1) * rx, cy + Math.sin(th1) * ry, w, w, t, t + 0.02, 0.9, col);
  }
  // gate: a straight bar set slightly inside the ring
  const gA = { x: cx + rx * 0.62, y: cy - ry * 0.6 };
  const gB = { x: cx + rx * 0.78, y: cy + ry * 0.58 };
  D.segment(gA.x, gA.y, gB.x, gB.y, 2.2, 2.2, 0.4, 0.5, 0.9, col);
  D.cloud(gB.x, gB.y, 1.8, 14, 0.48, 0.52, () => C.IVORY);

  // ropes: twisted strands, dots thinned along a diagonal lay
  const rope = (sgn) => {
    const P0 = { x: cx + sgn * 3, y: cy + ry - 4 };
    const P1 = { x: cx + sgn * 40, y: cy + ry + 34 };
    const P2 = { x: cx + sgn * 120, y: cy + 30 };
    const P3 = { x: cx + sgn * 150, y: cy - 420 };
    const w = 6;
    const N = 220;
    let prev = P0;
    for (let i = 1; i <= N; i++) {
      const u = i / N;
      const it = 1 - u;
      const p = {
        x: it * it * it * P0.x + 3 * it * it * u * P1.x + 3 * it * u * u * P2.x + u * u * u * P3.x,
        y: it * it * it * P0.y + 3 * it * it * u * P1.y + 3 * it * u * u * P2.y + u * u * u * P3.y,
      };
      const dx = p.x - prev.x;
      const dy = p.y - prev.y;
      const L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L;
      const ny = dx / L;
      const n = Math.round(L * w * 1.0);
      for (let j = 0; j < n; j++) {
        const v = rng();
        const a = (rng() - 0.5) * w;
        const along = (i - 1 + v) * L;
        if (Math.sin(along * 0.55 + a * 1.25) > 0.35) continue; // the lay of the rope
        const t = 0.35 + u * 0.6;
        D.add(prev.x + dx * v + nx * a, prev.y + dy * v + ny * a, t, rng() < 0.2 ? C.IVORY : rng() < 0.5 ? C.LILAC : C.DIM);
      }
      prev = p;
    }
  };
  rope(-1);
  rope(1);
  return { layer: D.finish(), center: { x: cx, y: cy }, rx, ry };
}

// Draw one layer. cam: {x, y, s}; view: {W, H, dpr} in CSS px.
export function renderLayer(ctx, L, cam, view, grow, density, dotPx, alpha = 1) {
  if (!L || alpha <= 0.002) return;
  const { W, H, dpr } = view;
  const s = cam.s * dpr;
  const ox = (W / 2) * dpr - cam.x * s;
  const oy = (H / 2) * dpr + cam.y * s;
  const maxX = W * dpr + 4;
  const maxY = H * dpr + 4;
  const { X, Y, T, R } = L;
  ctx.globalAlpha = alpha;
  for (let ci = 0; ci < L.ranges.length; ci++) {
    const [a, b] = L.ranges[ci];
    if (a === b) continue;
    const size = Math.max(1, Math.round(dotPx * dpr * SIZE[ci]));
    const half = size / 2;
    ctx.fillStyle = PALETTE[ci];
    ctx.beginPath();
    for (let i = a; i < b; i++) {
      if (T[i] > grow || R[i] > density) continue;
      const sx = ox + X[i] * s;
      const sy = oy - Y[i] * s;
      if (sx < -4 || sy < -4 || sx > maxX || sy > maxY) continue;
      ctx.rect((sx - half) | 0, (sy - half) | 0, size, size);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// A stippled pill outline + faint fill, for HTML buttons.
export function drawPill(canvas, { color = '210,188,200', fill = 0.12, edge = 0.9, seed = 1 } = {}) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (!rect.width) return;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const rng = mulberry32(seed);
  const r = h / 2;
  const size = Math.max(1, Math.round(dpr));
  const inside = (x, y) => {
    const cx = Math.min(Math.max(x, r), w - r);
    return Math.hypot(x - cx, y - r) <= r - 1;
  };
  ctx.fillStyle = `rgba(${color},${fill})`;
  ctx.beginPath();
  const nf = Math.round((w * h) / (dpr * dpr) * 0.45);
  for (let i = 0; i < nf; i++) {
    const x = rng() * w;
    const y = rng() * h;
    if (inside(x, y)) ctx.rect(x | 0, y | 0, size, size);
  }
  ctx.fill();
  // perimeter
  const straight = w - 2 * r;
  const per = 2 * straight + TAU * r;
  const ne = Math.round((per / dpr) * 2.2);
  ctx.fillStyle = `rgba(${color},${edge})`;
  ctx.beginPath();
  for (let i = 0; i < ne; i++) {
    let d = rng() * per;
    let x;
    let y;
    let nx;
    let ny;
    if (d < straight) {
      x = r + d;
      y = 1;
      nx = 0;
      ny = 1;
    } else if ((d -= straight) < Math.PI * r) {
      const a = -Math.PI / 2 + d / r;
      x = w - r + Math.cos(a) * (r - 1);
      y = r + Math.sin(a) * (r - 1);
      nx = -Math.cos(a);
      ny = -Math.sin(a);
    } else if ((d -= Math.PI * r) < straight) {
      x = w - r - d;
      y = h - 1;
      nx = 0;
      ny = -1;
    } else {
      d -= straight;
      const a = Math.PI / 2 + d / r;
      x = r + Math.cos(a) * (r - 1);
      y = r + Math.sin(a) * (r - 1);
      nx = -Math.cos(a);
      ny = -Math.sin(a);
    }
    const j = Math.abs(rng() + rng() - 1) * 2.2 * dpr;
    ctx.rect((x + nx * j) | 0, (y + ny * j) | 0, size, size);
  }
  ctx.fill();
}
