// board3d.js - optional realistic 3D board for Timber Chess (Settings > 3D board).
// ES module, loaded only when 3D is switched on. Uses three.js r160, bundled with the app in
// vendor/three.module.min.js (MIT licence, see vendor/THREE-LICENSE.txt).
//
// SQUARE CONVENTION (same as index.html: nameSq / sqName / engine boardArray()):
//   sq = rank*8 + file, a1 = 0, h1 = 7, a8 = 56, h8 = 63.   nameSq('e4') === 28.
//   Position arrays are 64 entries: '' (empty) or a piece letter, upper case = white
//   ('PNBRQK'), lower case = black ('pnbrqk')  -> exactly what eng.board() returns.
// WORLD: 1 unit = 1 square. Board surface y = 0. File a..h -> x = -3.5..3.5,
//   rank 1..8 -> z = +3.5..-3.5 (White sits at +z).
//
// API: create3DBoard(container, opts) -> board object, or null when WebGL is unavailable.
//   opts.onSquareDown(sq, ev)          sq = -1 off the board. Return true to start dragging
//                                      the piece on sq (lift + follow pointer).
//   opts.onSquareUp(sq, ev, info)      info = {dragged, from}. For a drag, return false to
//                                      make the piece fly back; otherwise call setPosition /
//                                      animateMove (sync or later, e.g. after a promotion pick).
//   opts.onContextLost()               WebGL context lost -> app should go back to 2D.
//   opts.allowSoftware                 default false: software GL (SwiftShader/llvmpipe) -> null.
//   opts.quality 'auto'|'high'|'low'
// Returned object: setPosition(arr64,{hints,ms,instant,captured}), animateMove(from,to,{capture,castleRook,promotion}),
//   setHighlights({lastMove,selected,targets,check,hint,marks:[{sq,color:'green'|'red'|'blue'}]}),
//   setOrientation('w'|'b',instant), setPieceColors({w:{base,dark},b:{base,dark}}), setTheme({light,lightGrain,dark,darkGrain,frame,...}),
//   cycleView(name?,instant) -> 'tilt'|'top'|'low', squareToScreen(sq) -> {x,y} px in container, resize(), isIdle(), stats(), dispose().
import * as THREE from './vendor/three.module.min.js';

const W_BAND = 0.78;              // frame band width
const W = 8 + W_BAND * 2;         // frame outer size
const FRAME_TOP = 0.05;           // frame top above squares
const TABLE_Y = -0.46;            // table surface (board thickness)
const TRAY_SCALE = 0.7;
const TYPES = 'pnbrqk';
const ORDER = { q: 0, r: 1, b: 2, n: 3, p: 4, k: 5 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const isWhite = p => p === p.toUpperCase();
const sqPos = (sq, y = 0) => new THREE.Vector3((sq & 7) - 3.5, y, 3.5 - (sq >> 3));
const squareAt = (x, z) => { const f = Math.floor(x + 4), r = Math.floor(4 - z); return (f < 0 || f > 7 || r < 0 || r > 7) ? -1 : r * 8 + f; };

/* ---------------------------------------------------------------- WebGL check */
function glInfo() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return null;
    let renderer = '';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    return { renderer, software: /swiftshader|llvmpipe|software|basic render/i.test(renderer) };
  } catch (e) { return null; }
}

/* ---------------------------------------------------------------- procedural wood */
function rng(seed) { let s = (Math.imul(seed | 0, 2654435761) >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
// Draws wood with the grain running along the rect's length (horizontal, or vertical if o.vertical).
// Wave frequencies are whole cycles along the length so textures tile.
function drawWood(ctx, x, y, w, h, base, dark, o = {}) {
  const R = rng(o.seed || 1), sc = o.scale || 1, con = o.contrast == null ? 1 : o.contrast;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.translate(x, y);
  let L = w, T = h;
  if (o.vertical) { ctx.translate(w, 0); ctx.rotate(Math.PI / 2); L = h; T = w; }
  ctx.fillStyle = base; ctx.fillRect(0, 0, L, T);
  const wave = (k, ph, amp) => xx => Math.sin(xx / L * Math.PI * 2 * k + ph) * amp;
  // broad soft figure bands
  for (let i = 0; i < 7; i++) {
    const y0 = R() * T, hh = (0.05 + R() * 0.2) * T, f = wave(1 + (R() * 2 | 0), R() * 6.3, hh * 0.12);
    ctx.globalAlpha = (0.04 + R() * 0.07) * con; ctx.fillStyle = R() < 0.6 ? dark : '#ffffff';
    ctx.beginPath(); ctx.moveTo(-2, y0 + f(-2));
    for (let xx = 0; xx <= L + 2; xx += L / 32) ctx.lineTo(xx, y0 + f(xx));
    for (let xx = L + 2; xx >= -2; xx -= L / 32) ctx.lineTo(xx, y0 + hh + f(xx) * 0.8);
    ctx.fill();
  }
  // fine grain lines
  const n = Math.round(T / (2.6 * sc) * (o.density || 1));
  ctx.strokeStyle = dark;
  for (let i = 0; i < n; i++) {
    const y0 = R() * T, f1 = wave(1 + (R() * 3 | 0), R() * 6.3, (0.3 + R() * 1.3) * sc), f2 = wave(3 + (R() * 5 | 0), R() * 6.3, (0.12 + R() * 0.45) * sc);
    ctx.globalAlpha = (0.05 + R() * R() * 0.32) * con; ctx.lineWidth = (0.35 + R() * 1.3) * sc;
    ctx.beginPath();
    for (let xx = -2; xx <= L + 2; xx += L / 48) { const yy = y0 + f1(xx) + f2(xx); xx < 0 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy); }
    ctx.stroke();
  }
  // pores
  ctx.fillStyle = dark;
  const pores = Math.round(L * T / (90 * sc * sc) * (o.pores == null ? 1 : o.pores));
  for (let i = 0; i < pores; i++) { ctx.globalAlpha = (0.08 + R() * 0.2) * con; ctx.fillRect(R() * L, R() * T, (2 + R() * 7) * sc, (0.6 + R() * 0.8) * sc); }
  ctx.restore();
}
function canvasTex(cv, srgb = true) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/* ---------------------------------------------------------------- piece geometry */
// Profile builder (r, y) with per-curve sampling.
class Prof {
  constructor() { this.pts = []; }
  get cur() { return this.pts[this.pts.length - 1]; }
  push(x, y) { const c = this.cur; if (!c || Math.abs(c.x - x) > 1e-6 || Math.abs(c.y - y) > 1e-6) this.pts.push(new THREE.Vector2(Math.max(0, x), y)); return this; }
  M(x, y) { return this.push(x, y); }
  L(x, y) { return this.push(x, y); }
  Q(cx, cy, x, y, n = 8) { const a = this.cur; for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; this.push(u * u * a.x + 2 * u * t * cx + t * t * x, u * u * a.y + 2 * u * t * cy + t * t * y); } return this; }
  C(c1x, c1y, c2x, c2y, x, y, n = 12) { const a = this.cur; for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; this.push(u * u * u * a.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x, u * u * u * a.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y); } return this; }
  A(cx, cy, r, a0, a1, n = 14) { for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; this.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } return this; }
}
// Lathe with crisp creases: corners sharper than `creaseDeg` get split normals.
function lathe(pts, segs, creaseDeg = 32) {
  const n = pts.length, sn = [], cosT = Math.cos(creaseDeg * Math.PI / 180);
  for (let i = 0; i < n - 1; i++) { const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y, l = Math.hypot(dx, dy) || 1; sn.push([dy / l, -dx / l]); }
  const ring = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (i === 0) { ring.push({ r: p.x, y: p.y, n: sn[0] }); continue; }
    if (i === n - 1) { ring.push({ r: p.x, y: p.y, n: sn[n - 2] }); continue; }
    const a = sn[i - 1], b = sn[i], d = a[0] * b[0] + a[1] * b[1];
    if (d < cosT) { ring.push({ r: p.x, y: p.y, n: a, brk: true }); ring.push({ r: p.x, y: p.y, n: b }); }
    else { const nx = a[0] + b[0], ny = a[1] + b[1], l = Math.hypot(nx, ny) || 1; ring.push({ r: p.x, y: p.y, n: [nx / l, ny / l] }); }
  }
  const Lr = ring.length, pos = [], nor = [], uv = [], idx = [];
  for (let s = 0; s <= segs; s++) {
    const ph = s / segs * Math.PI * 2, sn_ = Math.sin(ph), cs = Math.cos(ph);
    for (const e of ring) { pos.push(e.r * sn_, e.y, e.r * cs); nor.push(e.n[0] * sn_, e.n[1], e.n[0] * cs); uv.push(s / segs, e.y); }
  }
  for (let s = 0; s < segs; s++) for (let j = 0; j < Lr - 1; j++) {
    if (ring[j].brk) continue;
    const a = s * Lr + j, b = (s + 1) * Lr + j, c = b + 1, d = a + 1;
    idx.push(a, b, d, c, d, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.length).fill(1), 3));
  g.setIndex(idx);
  return g;
}
// Smooth normals across edges flatter than `deg`, keep sharp edges sharp (non-indexed output).
function creaseNormals(g, deg = 38) {
  g = g.index ? g.toNonIndexed() : g;
  const P = g.attributes.position.array, n = P.length / 3, fn = new Float32Array(n * 3), fa = new Float32Array(n * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    a.fromArray(P, i * 3); b.fromArray(P, i * 3 + 3); c.fromArray(P, i * 3 + 6);
    b.sub(a); c.sub(a); b.cross(c); // area weighted
    for (let k = 0; k < 3; k++) { fa[(i + k) * 3] = b.x; fa[(i + k) * 3 + 1] = b.y; fa[(i + k) * 3 + 2] = b.z; }
    b.normalize();
    for (let k = 0; k < 3; k++) { fn[(i + k) * 3] = b.x; fn[(i + k) * 3 + 1] = b.y; fn[(i + k) * 3 + 2] = b.z; }
  }
  const key = i => `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`;
  const map = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); let l = map.get(k); if (!l) map.set(k, l = []); l.push(i); }
  const cosT = Math.cos(deg * Math.PI / 180), out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0, z = 0;
    for (const j of map.get(key(i))) {
      if (fn[i * 3] * fn[j * 3] + fn[i * 3 + 1] * fn[j * 3 + 1] + fn[i * 3 + 2] * fn[j * 3 + 2] >= cosT) { x += fa[j * 3]; y += fa[j * 3 + 1]; z += fa[j * 3 + 2]; }
    }
    const l = Math.hypot(x, y, z) || 1; out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return g;
}
function withColor(g, v = 1) {
  if (!g.attributes.color) g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(v), 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 2).fill(0), 2));
  return g;
}
function merge(list) {
  const parts = list.map(g => withColor(g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]]) {
    let len = 0; for (const g of parts) len += g.attributes[name].array.length;
    const arr = new Float32Array(len); let o = 0;
    for (const g of parts) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}
function extrude(shape, depth, bevel, opts = {}) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: opts.bt || bevel, bevelSize: bevel, bevelSegments: opts.bs || 3, curveSegments: opts.cs || 12 });
  g.translate(0, 0, -depth / 2);
  return g;
}
// Standard Staunton foot: rounded torus, cove, small bead. Returns [r, y] where the stem starts.
function foot(P, R, hs = 1) {
  const y = v => v * hs;
  P.M(0, 0).L(R - 0.01, 0).Q(R, 0, R, y(0.012), 3).L(R, y(0.03));
  P.Q(R + 0.014, y(0.078), R - 0.04, y(0.094), 8);
  P.Q(R - 0.092, y(0.1), R - 0.082, y(0.13), 6);
  P.Q(R - 0.05, y(0.146), R - 0.086, y(0.165), 6);
  P.L(R - 0.102, y(0.172));
  return [R - 0.102, y(0.172)];
}
function collar(P, y0, rOut, rIn, h = 0.09) {
  // double collar: wide disc + narrower bead, then neck rIn
  P.L(rOut, y0 + h * 0.12).Q(rOut + 0.024, y0 + h * 0.3, rOut, y0 + h * 0.48, 5).L(rIn + 0.03, y0 + h * 0.56);
  P.L(rOut - 0.04, y0 + h * 0.7).Q(rOut - 0.026, y0 + h * 0.82, rOut - 0.05, y0 + h * 0.94, 4).L(rIn, y0 + h);
  return y0 + h;
}

function buildGeometries(segs) {
  const G = {};
  // ---- Pawn
  {
    const P = new Prof(); const [r0, y0] = foot(P, 0.265, 0.82);
    P.C(r0 - 0.03, y0 + 0.08, 0.1, 0.3, 0.092, 0.39, 12);
    P.L(0.168, 0.405).Q(0.19, 0.42, 0.165, 0.44, 5).L(0.08, 0.45);
    P.A(0, 0.58, 0.135, -1.03, Math.PI / 2, 22);
    G.p = merge([lathe(P.pts, segs)]);
  }
  // ---- Rook
  {
    const P = new Prof(); const [r0, y0] = foot(P, 0.31);
    P.C(r0 - 0.03, y0 + 0.15, 0.162, 0.42, 0.168, 0.58, 14);
    P.L(0.222, 0.595).Q(0.244, 0.612, 0.222, 0.63, 5).L(0.2, 0.636);
    P.Q(0.204, 0.70, 0.232, 0.775, 6).L(0.232, 0.79).L(0.152, 0.79).L(0.152, 0.765).L(0, 0.765);
    const parts = [lathe(P.pts, segs)];
    const N = 6, b = 0.012, ro = 0.232 - b, ri = 0.152 + b, h = 0.115;
    for (let i = 0; i < N; i++) {
      const c = (i + 0.5) / N * Math.PI * 2, half = Math.PI / N * 0.64;
      const s = new THREE.Shape();
      s.absarc(0, 0, ro, c - half + b / ro, c + half - b / ro, false);
      s.absarc(0, 0, ri, c + half - b / ri, c - half + b / ri, true);
      const g = new THREE.ExtrudeGeometry(s, { depth: h - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 8 });
      g.rotateX(-Math.PI / 2); g.translate(0, 0.785 + b, 0);
      parts.push(creaseNormals(g, 40));
    }
    G.r = merge(parts);
  }
  // ---- Vizier (the bishop's place): an onion-dome top with a small ball finial. No mitre, no slit.
  {
    const P = new Prof(); const [r0, y0] = foot(P, 0.3);
    P.C(r0 - 0.03, y0 + 0.13, 0.1, 0.46, 0.094, 0.6, 14);
    collar(P, 0.6, 0.18, 0.088, 0.13);
    P.C(0.25, 0.68, 0.245, 0.86, 0.11, 0.93, 22);   // the dome swells out...
    P.C(0.05, 0.965, 0.026, 0.995, 0.022, 1.04, 12); // ...and draws in to a point
    P.L(0.024, 1.052);
    P.A(0, 1.09, 0.045, -1.0, Math.PI / 2, 14);
    G.b = merge([lathe(P.pts, Math.max(segs, 64))]);
  }
  // ---- Queen (coronet of points with balls)
  {
    const P = new Prof(); const [r0, y0] = foot(P, 0.325);
    P.C(r0 - 0.03, y0 + 0.16, 0.112, 0.52, 0.104, 0.72, 16);
    collar(P, 0.72, 0.198, 0.1, 0.12);
    P.C(0.11, 0.95, 0.21, 1.0, 0.222, 1.085, 14);
    P.L(0.222, 1.1).L(0.205, 1.112).L(0.172, 1.112);
    P.Q(0.15, 1.17, 0.07, 1.19, 8).L(0.045, 1.198);
    P.A(0, 1.25, 0.06, -1.1, Math.PI / 2, 16);
    const g = lathe(P.pts, Math.max(segs, 64));
    const pos = g.attributes.position;
    const K = 9;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), r = Math.hypot(x, z);
      if (y < 1.07 || r < 0.15) continue;
      const ph = Math.atan2(x, z), w = Math.pow(0.5 + 0.5 * Math.cos(K * ph), 2.2);
      const f = smooth(1.07, 1.11, y);
      pos.setY(i, y + 0.07 * w * f);
    }
    const parts = [creaseNormals(g, 50)];
    for (let i = 0; i < K; i++) {
      const ph = i / K * Math.PI * 2, s = new THREE.SphereGeometry(0.03, 12, 8);
      s.translate(Math.sin(ph) * 0.2, 1.205, Math.cos(ph) * 0.2); parts.push(s);
    }
    G.q = merge(parts);
  }
  // ---- King (crown + jewel)
  {
    const P = new Prof(); const [r0, y0] = foot(P, 0.335);
    P.C(r0 - 0.03, y0 + 0.17, 0.12, 0.56, 0.112, 0.79, 16);
    collar(P, 0.79, 0.205, 0.106, 0.13);
    P.C(0.12, 1.02, 0.21, 1.08, 0.218, 1.17, 14);
    P.Q(0.232, 1.19, 0.2, 1.205, 5).L(0.17, 1.205);
    P.Q(0.1, 1.215, 0.075, 1.27, 8).L(0.088, 1.278).L(0.088, 1.296).L(0.05, 1.302).L(0, 1.302);
    const parts = [lathe(P.pts, segs)];
    // a cut jewel on top (8 facets)
    const J = [new THREE.Vector2(0, 1.29), new THREE.Vector2(0.034, 1.292), new THREE.Vector2(0.03, 1.32), new THREE.Vector2(0.078, 1.405), new THREE.Vector2(0.06, 1.425), new THREE.Vector2(0, 1.53)];
    parts.push(creaseNormals(lathe(J, 8, 20), 30));
    G.k = merge(parts);
  }
  // ---- Knight
  G.n = buildKnight(segs);
  return G;
}

function buildKnight(segs) {
  const P = new Prof(); const [r0, y0] = foot(P, 0.31);
  P.L(r0 - 0.005, y0 + 0.03).Q(r0 + 0.012, y0 + 0.045, r0 - 0.01, y0 + 0.06, 4).L(0.0, y0 + 0.06);
  const baseTop = y0 + 0.05;
  const parts = [lathe(P.pts, segs)];

  // Head silhouette, nose toward +x. Kept plain: no face details, smooth back.
  const pts = [];
  const add = (x, y) => pts.push(new THREE.Vector2(x, y));
  const cub = (a, c1, c2, b, n, fn) => { for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; const x = u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0], y = u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]; fn ? fn(x, y, t) : add(x, y); } };
  const quad = (a, c, b, n) => { for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; add(u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]); } };
  add(-0.2, 0);
  // back of the neck
  const back = [];
  cub([-0.2, 0], [-0.25, 0.16], [-0.27, 0.33], [-0.2, 0.49], 22, (x, y) => back.push([x, y]));
  cub([-0.2, 0.49], [-0.15, 0.58], [-0.11, 0.64], [-0.06, 0.675], 12, (x, y) => back.push([x, y]));
  for (const [x, y] of back) add(x, y); // smooth back of the neck (no mane)
  // ears
  quad([-0.06, 0.675], [-0.07, 0.73], [-0.045, 0.785], 5);
  quad([-0.045, 0.785], [-0.005, 0.75], [0.015, 0.69], 5);
  // forehead and face
  cub([0.015, 0.69], [0.07, 0.68], [0.15, 0.6], [0.2, 0.5], 12);
  cub([0.2, 0.5], [0.235, 0.44], [0.272, 0.39], [0.278, 0.338], 8);
  quad([0.278, 0.338], [0.285, 0.288], [0.245, 0.282], 5);
  add(0.19, 0.296); add(0.214, 0.262);
  quad([0.214, 0.262], [0.222, 0.232], [0.175, 0.232], 5);
  // jaw -> throat -> chest
  cub([0.175, 0.232], [0.12, 0.232], [0.06, 0.262], [0.035, 0.298], 8);
  cub([0.035, 0.298], [0.04, 0.2], [0.17, 0.14], [0.19, 0.0], 12);
  const shape = new THREE.Shape(pts);
  const depth = 0.14, bt = 0.055, bs = 0.028;
  let g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bt, bevelSize: bs, bevelSegments: 4, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  // taper: narrower muzzle and top of head, fuller neck
  const pa = g.attributes.position;
  const taper = (x, y) => (1 - 0.34 * smooth(0.04, 0.27, x) * smooth(0.2, 0.36, y)) * (1 - 0.18 * smooth(0.52, 0.78, y)) * (1 + 0.12 * (1 - smooth(0.0, 0.3, y)));
  for (let i = 0; i < pa.count; i++) pa.setZ(i, pa.getZ(i) * taper(pa.getX(i), pa.getY(i)));
  g = creaseNormals(g, 48);
  g.translate(0.01, baseTop - 0.02, 0);
  parts.push(g);
  const geo = merge(parts);
  return geo;
}

/* ---------------------------------------------------------------- textures */
function boardTexture(size, theme) {
  const cv = makeCanvas(size, size), ctx = cv.getContext('2d'), s = size / 8;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const light = (r + f) % 2 === 1, x = f * s, y = (7 - r) * s;
    drawWood(ctx, x, y, s, s, light ? theme.light : theme.dark, light ? theme.lightGrain : theme.darkGrain,
      { vertical: true, seed: 17 + r * 8 + f, scale: size / 1024, contrast: light ? 0.9 : 1.1, density: 1.1 });
    // per-square tone variation
    const R = rng(91 + r * 8 + f)(); ctx.globalAlpha = Math.abs(R - .5) * 0.12; ctx.fillStyle = R > .5 ? '#fff' : '#000'; ctx.fillRect(x, y, s, s); ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = 'rgba(25,10,0,.35)'; ctx.lineWidth = Math.max(1, size / 900);
  for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, size); ctx.moveTo(0, i * s); ctx.lineTo(size, i * s); ctx.stroke(); }
  return cv;
}
function frameTexture(size, theme, orient) {
  const cv = makeCanvas(size, size), ctx = cv.getContext('2d'), k = size / W, B = W_BAND * k, S = size;
  const sides = [
    { poly: [[0, 0], [S, 0], [S - B, B], [B, B]], rect: [0, 0, S, B], v: false },
    { poly: [[0, S], [S, S], [S - B, S - B], [B, S - B]], rect: [0, S - B, S, B], v: false },
    { poly: [[0, 0], [B, B], [B, S - B], [0, S]], rect: [0, 0, B, S], v: true },
    { poly: [[S, 0], [S - B, B], [S - B, S - B], [S, S]], rect: [S - B, 0, B, S], v: true },
  ];
  sides.forEach((sd, i) => {
    ctx.save(); ctx.beginPath(); sd.poly.forEach(([x, y], j) => j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.clip();
    drawWood(ctx, ...sd.rect, theme.frame, theme.frameGrain, { vertical: sd.v, seed: 300 + i * 13, scale: size / 1024, contrast: 0.85 });
    ctx.restore();
  });
  // mitre joints
  ctx.strokeStyle = 'rgba(40,20,5,.35)'; ctx.lineWidth = size / 900;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(B, B); ctx.moveTo(S, 0); ctx.lineTo(S - B, B); ctx.moveTo(0, S); ctx.lineTo(B, S - B); ctx.moveTo(S, S); ctx.lineTo(S - B, S - B); ctx.stroke();
  // inlay: dark line near the squares, thin dark line near the outer edge
  const inl = (off, wid, col) => { ctx.strokeStyle = col; ctx.lineWidth = wid * k; const o = off * k; ctx.strokeRect(o, o, S - 2 * o, S - 2 * o); };
  inl(W_BAND - 0.1, 0.05, theme.inlay);
  inl(W_BAND - 0.162, 0.014, theme.inlay);
  inl(0.12, 0.016, theme.inlay);
  // coordinates
  const fs = Math.round(0.34 * k);
  ctx.font = `600 ${fs}px Georgia, "Times New Roman", serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const put = (txt, x, y) => {
    ctx.save(); ctx.translate(x, y); if (orient === 'b') ctx.rotate(Math.PI);
    ctx.fillStyle = 'rgba(255,240,215,.45)'; ctx.fillText(txt, 0, fs * 0.05 + 1);
    ctx.fillStyle = theme.text; ctx.fillText(txt, 0, 0); ctx.restore();
  };
  const band = (W_BAND - 0.1) / 2 * k + 0.02 * k;
  for (let f = 0; f < 8; f++) { const x = (f + 0.5 + W_BAND) * k; put('ABCDEFGH'[f], x, S - band); put('ABCDEFGH'[f], x, band); }
  for (let r = 0; r < 8; r++) { const y = (W_BAND + 7.5 - r) * k; put(String(r + 1), band, y); put(String(r + 1), S - band, y); }
  return cv;
}
function pieceTexture(base, dark, seed) {
  const cv = makeCanvas(256, 512), ctx = cv.getContext('2d');
  drawWood(ctx, 0, 0, 256, 512, base, dark, { vertical: true, seed, scale: 0.5, contrast: 0.75, density: 0.55, pores: 0.4 });
  return cv;
}
function glowTexture(color, core, fill) {
  const S = 256, cv = makeCanvas(S, S), ctx = cv.getContext('2d');
  const inset = S * 0.12 / 1.24 + 5, rr = 14;
  const rrect = () => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(inset, inset, S - 2 * inset, S - 2 * inset, rr) : ctx.rect(inset, inset, S - 2 * inset, S - 2 * inset); };
  if (fill) { ctx.fillStyle = fill; rrect(); ctx.fill(); }
  ctx.shadowColor = color; ctx.strokeStyle = color;
  for (const [b, w] of [[26, 9], [14, 8], [6, 7]]) { ctx.shadowBlur = b; ctx.lineWidth = w; rrect(); ctx.stroke(); }
  ctx.shadowBlur = 0; ctx.strokeStyle = core; ctx.lineWidth = 3.5; rrect(); ctx.stroke();
  return canvasTex(cv);
}
function radialTexture(stops) {
  const S = 128, cv = makeCanvas(S, S), ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return canvasTex(cv);
}

const DEFAULT_THEME = {
  light: '#efd7ab', lightGrain: '#b98d55', dark: '#4a2a17', darkGrain: '#1c0c04',
  frame: '#d8b583', frameGrain: '#a87b47', inlay: '#2a1608', text: '#3a200c',
  table: '#5b3720', tableGrain: '#24110a',
};
const DEFAULT_PIECES = { w: { base: '#f0d6a6', dark: '#b88a52' }, b: { base: '#4c2a18', dark: '#1a0b04' } };

/* ---------------------------------------------------------------- views */
const VIEWS = {
  tilt: { el: 44, az: 0, fov: 30 },
  top: { el: 78, az: 0, fov: 26 },
  low: { el: 25, az: 0.38, fov: 30 },
};
const VIEW_ORDER = ['tilt', 'top', 'low'];

/* ================================================================ main */
export function create3DBoard(container, opts = {}) {
  const info = glInfo();
  if (!info) return null;
  if (info.software && !opts.allowSoftware) return null;
  let renderer;
  const dpr0 = window.devicePixelRatio || 1;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: dpr0 < 2, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
  } catch (e) { return null; }
  if (!renderer.getContext()) return null;

  const cb = { onSquareDown: opts.onSquareDown || (() => false), onSquareUp: opts.onSquareUp || (() => {}), onContextLost: opts.onContextLost || (() => {}) };
  const small = Math.min(screen.width || 1000, screen.height || 1000) < 700;
  let quality = opts.quality || 'auto';
  let maxPR = Math.min(2, dpr0);
  renderer.setPixelRatio(maxPR);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;-webkit-tap-highlight-color:transparent';
  container.appendChild(canvas);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const hiTex = !small && quality !== 'low';

  const scene = new THREE.Scene();
  const BG = new THREE.Color('#1a0f08');
  scene.background = BG;
  scene.fog = new THREE.Fog(BG, 20, 45);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);

  // ---- environment (tiny warm room -> PMREM) for glossy reflections
  {
    const pm = new THREE.PMREMGenerator(renderer);
    const env = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(30, 14, 30), new THREE.MeshBasicMaterial({ color: new THREE.Color('#3b2618'), side: THREE.BackSide }));
    room.position.y = 5; env.add(room);
    const panel = (w, h, col, k, x, y, z, rx, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); env.add(m); };
    panel(5, 5, '#ffd9a8', 9, -5, 11.5, 6, Math.PI / 2, 0);     // the lamp
    panel(10, 5, '#ffeedd', 1.3, 0, 6, -14.5, 0, 0);            // a soft window far away
    panel(8, 3, '#ffe8cc', 2.2, 14.5, 5, 0, 0, -Math.PI / 2);   // warm wall bounce
    panel(30, 30, '#4a2c18', 1, 0, -1.9, 0, -Math.PI / 2, 0);   // table bounce
    scene.environment = pm.fromScene(env, 0.035).texture;
    pm.dispose(); env.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  }

  // ---- lights
  const hemi = new THREE.HemisphereLight('#fff0dc', '#4a2b16', 0.55); scene.add(hemi);
  const key = new THREE.DirectionalLight('#ffd7a6', 2.6);
  key.castShadow = true;
  const sc = key.shadow.camera; sc.left = -7.5; sc.right = 7.5; sc.top = 7.5; sc.bottom = -7.5; sc.near = 2; sc.far = 40;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.025; key.shadow.radius = 4;
  scene.add(key); scene.add(key.target);
  const fill = new THREE.DirectionalLight('#ffe6cc', 0.3); scene.add(fill);
  const LIGHT_POS = new THREE.Vector3(-6.5, 13, 7.5), FILL_POS = new THREE.Vector3(7, 6, -6);
  function setShadowSize(n) { if (key.shadow.mapSize.x === n) return; key.shadow.mapSize.set(n, n); if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; } }

  // ---- materials
  let theme = Object.assign({}, DEFAULT_THEME, opts.theme || {});
  const texSize = hiTex ? 2048 : 1024;
  const disposables = [];
  const boardMat = new THREE.MeshPhysicalMaterial({ roughness: 0.34, clearcoat: 0.85, clearcoatRoughness: 0.12, envMapIntensity: 0.8 });
  const frameMat = new THREE.MeshPhysicalMaterial({ roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.18, envMapIntensity: 0.8 });
  const frameSideMat = new THREE.MeshPhysicalMaterial({ roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.8 });
  const tableMat = new THREE.MeshPhysicalMaterial({ roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.35, envMapIntensity: 0.5 });
  const pieceMat = {
    w: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.2, envMapIntensity: 0.9 }),
    b: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.16, envMapIntensity: 1.0 }),
  };
  let orient = 'w';
  function setMap(mat, cv, repeat) {
    if (mat.map) mat.map.dispose();
    const t = canvasTex(cv); t.anisotropy = aniso; if (repeat) t.repeat.set(repeat[0], repeat[1]); if (repeat && repeat[2] != null) t.offset.set(repeat[2], repeat[3]);
    mat.map = t; mat.needsUpdate = true;
  }
  function applyBoardTheme() {
    setMap(boardMat, boardTexture(texSize, theme));
    setMap(frameMat, frameTexture(texSize, theme, orient), [1 / W, 1 / W, 0.5, 0.5]);
    const side = makeCanvas(512, 128); drawWood(side.getContext('2d'), 0, 0, 512, 128, theme.frame, theme.frameGrain, { seed: 77, scale: 0.5, contrast: 0.9 });
    setMap(frameSideMat, side, [0.25, 2]);
    const tc = makeCanvas(1024, 1024); drawWood(tc.getContext('2d'), 0, 0, 1024, 1024, theme.table, theme.tableGrain, { seed: 5, scale: 1.0, contrast: 0.6, density: 0.9 });
    setMap(tableMat, tc, [7, 7]);
  }
  let pieceColors = JSON.parse(JSON.stringify(DEFAULT_PIECES));
  function applyPieceColors() {
    setMap(pieceMat.w, pieceTexture(pieceColors.w.base, pieceColors.w.dark, 11), [1, 1.4]);
    setMap(pieceMat.b, pieceTexture(pieceColors.b.base, pieceColors.b.dark, 23), [1, 1.4]);
  }
  applyBoardTheme(); applyPieceColors();

  // ---- board meshes
  const boardGroup = new THREE.Group(); scene.add(boardGroup);
  const squares = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), boardMat);
  squares.rotation.x = -Math.PI / 2; squares.receiveShadow = true; boardGroup.add(squares);
  const under = new THREE.Mesh(new THREE.PlaneGeometry(8.3, 8.3), new THREE.MeshBasicMaterial({ color: '#160a03' }));
  under.rotation.x = -Math.PI / 2; under.position.y = -0.012; boardGroup.add(under);
  {
    const bev = 0.065, depth = (FRAME_TOP - TABLE_Y) - 2 * bev;
    const s = new THREE.Shape(); const o = W / 2 - bev; s.moveTo(-o, -o); s.lineTo(o, -o); s.lineTo(o, o); s.lineTo(-o, o); s.lineTo(-o, -o);
    const h = new THREE.Path(); const i = 4 + bev * 0.75; h.moveTo(-i, -i); h.lineTo(-i, i); h.lineTo(i, i); h.lineTo(i, -i); h.lineTo(-i, -i); s.holes.push(h);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 4, curveSegments: 1 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, FRAME_TOP - depth - bev, 0);
    const frame = new THREE.Mesh(g, [frameMat, frameSideMat]);
    frame.castShadow = true; frame.receiveShadow = true; boardGroup.add(frame);
  }
  const table = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), tableMat);
  table.rotation.x = -Math.PI / 2; table.position.y = TABLE_Y; table.receiveShadow = true; scene.add(table);

  // ---- highlights
  const hlGroup = new THREE.Group(); scene.add(hlGroup);
  const flat = (geo, mat, y = 0.004) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.y = y; m.visible = false; m.renderOrder = 2; hlGroup.add(m); return m; };
  const hlMat = (tex, extra = {}) => new THREE.MeshBasicMaterial(Object.assign({ map: tex, transparent: true, depthWrite: false, toneMapped: false }, extra));
  const glowGeo = new THREE.PlaneGeometry(1.24, 1.24);
  const lastTex = glowTexture('#ff8a1e', '#ffd9a0', 'rgba(255,150,40,.12)');
  const selTex = glowTexture('#ffd23a', '#fff6c8', 'rgba(255,215,60,.28)');
  const hovTex = glowTexture('#ffffff', '#ffffff', 'rgba(255,255,255,.14)');
  const lastHL = [flat(glowGeo, hlMat(lastTex)), flat(glowGeo, hlMat(lastTex))];
  const selHL = flat(glowGeo, hlMat(selTex), 0.005);
  const hovHL = flat(glowGeo, hlMat(hovTex), 0.006);
  const checkHL = flat(new THREE.PlaneGeometry(1.5, 1.5), hlMat(radialTexture([[0, 'rgba(255,40,20,.95)'], [0.45, 'rgba(230,20,10,.55)'], [1, 'rgba(200,0,0,0)']])), 0.0035);
  const dotGeo = new THREE.CircleGeometry(0.15, 28), ringGeo = new THREE.RingGeometry(0.39, 0.47, 40);
  const dotMat = new THREE.MeshBasicMaterial({ color: '#1b0d04', transparent: true, opacity: 0.42, depthWrite: false });
  const ringMat = new THREE.MeshBasicMaterial({ color: '#1b0d04', transparent: true, opacity: 0.4, depthWrite: false });
  const dots = [];
  let HL = { lastMove: null, selected: -1, targets: new Set(), check: -1, marks: [] };
  // extra coloured square marks (hint, learn goals, right/wrong flashes)
  const MARK_COLORS = { green: ['#5fd35a', '#d9ffd0', 'rgba(90,210,80,.22)'], red: ['#ff3b2f', '#ffd0c8', 'rgba(255,60,40,.25)'], blue: ['#4aa8ff', '#d6ecff', 'rgba(70,160,255,.22)'] };
  const markMats = {}, marks = [];
  const markMat = c => markMats[c] || (markMats[c] = hlMat(glowTexture(...(MARK_COLORS[c] || MARK_COLORS.green))));
  const blobTex = radialTexture([[0, 'rgba(0,0,0,.75)'], [0.5, 'rgba(0,0,0,.35)'], [1, 'rgba(0,0,0,0)']]);
  const blobGeo = new THREE.PlaneGeometry(1, 1); blobGeo.rotateX(-Math.PI / 2);

  // ---- pieces
  const GEOS = buildGeometries(small ? 40 : 52);
  const BASE_R = { p: 0.265, n: 0.31, b: 0.3, r: 0.31, q: 0.325, k: 0.335 };
  const YAW = { n: -2.55, b: 0.5, k: 0.15, q: 0, r: 0.26, p: 0 }; // knight nose faces left/forward from its own side
  const recs = []; // {p, sq, state:'board'|'tray', obj, mesh, blob, pos, tw, sc, morph, lean}
  let curArr = new Array(64).fill('');
  function newRec(p) {
    const t = p.toLowerCase(), col = isWhite(p) ? 'w' : 'b';
    const obj = new THREE.Group();
    const mesh = new THREE.Mesh(GEOS[t], pieceMat[col]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.rotation.y = YAW[t] + (col === 'b' ? Math.PI : 0);
    obj.add(mesh); scene.add(obj);
    const blob = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.4 }));
    blob.renderOrder = 1; scene.add(blob);
    const r = { p, sq: -1, state: 'board', obj, mesh, blob, pos: new THREE.Vector3(), scale: 1, tw: null, sc: null, lean: new THREE.Vector2() };
    mesh.userData.rec = r;
    recs.push(r);
    return r;
  }
  function groundAt(x, z) { const ax = Math.abs(x), az = Math.abs(z); if (ax <= 4 && az <= 4) return 0; if (ax <= W / 2 && az <= W / 2) return FRAME_TOP; return TABLE_Y; }
  function placeRec(r) {
    r.obj.position.copy(r.pos);
    r.obj.scale.setScalar(r.scale);
    r.obj.rotation.set(r.lean.x, 0, r.lean.y);
    const g = groundAt(r.pos.x, r.pos.z), h = Math.max(0, r.pos.y - g);
    const t = r.p.toLowerCase();
    r.blob.position.set(r.pos.x + h * 0.12, g + 0.003, r.pos.z - h * 0.05);
    r.blob.scale.setScalar(BASE_R[t] * 2.7 * r.scale * (1 + h * 0.55));
    r.blob.material.opacity = 0.42 * Math.max(0.25, 1 - h * 0.9) * Math.min(1, r.scale);
  }
  function removeRec(r) {
    const i = recs.indexOf(r); if (i >= 0) recs.splice(i, 1);
    scene.remove(r.obj); scene.remove(r.blob); r.blob.material.dispose();
  }
  function swapType(r, p) {
    r.p = p; const t = p.toLowerCase(), col = isWhite(p) ? 'w' : 'b';
    r.mesh.geometry = GEOS[t]; r.mesh.material = pieceMat[col]; r.mesh.rotation.y = YAW[t] + (col === 'b' ? Math.PI : 0);
  }

  // ---- tray layout
  let trayMode = 'sides';
  function trayPos(p, idx, count) {
    const captorWhite = !isWhite(p), s = captorWhite ? 1 : -1;
    if (trayMode === 'sides') {
      const col = Math.floor(idx / 8), row = idx % 8;
      return new THREE.Vector3(s * (W / 2 + 0.5 + col * 0.56), TABLE_Y, s * (3.45 - row * 0.62));
    }
    const row = Math.floor(idx / 8), col = idx % 8, n = Math.min(8, count - row * 8);
    return new THREE.Vector3(s * ((col - (n - 1) / 2) * 0.58), TABLE_Y, s * (W / 2 + 0.48 + row * 0.62));
  }
  function deriveLost(arr) {
    const full = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 }, cnt = {};
    for (const p of arr) if (p) cnt[p] = (cnt[p] || 0) + 1;
    const out = [];
    for (const t of 'qrbnp') for (const c of [t.toUpperCase(), t]) { const k = full[t] - (cnt[c] || 0); for (let i = 0; i < k; i++) out.push(c); }
    return out;
  }

  // ---- tweens / render loop
  let raf = 0, lastT = 0, dirty = true;
  const now = () => performance.now();
  function wake() { dirty = true; if (!raf && !disposed) raf = requestAnimationFrame(frame); }
  function moveRec(r, to, o = {}) {
    r.tw = { from: r.pos.clone(), to: to.clone(), t0: now() + (o.delay || 0), dur: o.dur || 300, hop: o.hop || 0, ease: o.ease || easeIO, s0: r.scale, s1: o.scale == null ? r.scale : o.scale, lean: o.lean || 0, done: o.done };
  }
  function scaleRec(r, s0, s1, dur, done, delay = 0) { r.scale = s0; r.sc = { s0, s1, t0: now() + delay, dur, done }; }
  function stepTweens(t) {
    let active = false;
    for (const r of recs.slice()) {
      if (r.tw) {
        const w = r.tw, k = clamp((t - w.t0) / w.dur, 0, 1); active = true;
        if (t >= w.t0) {
          const e = w.ease(k);
          r.pos.lerpVectors(w.from, w.to, e);
          r.pos.y += w.hop * Math.sin(Math.PI * k);
          r.scale = lerp(w.s0, w.s1, e);
          if (w.lean) { const dx = w.to.x - w.from.x, dz = w.to.z - w.from.z, l = Math.hypot(dx, dz) || 1, a = Math.sin(Math.PI * k) * w.lean; r.lean.set(dz / l * a, -dx / l * a); }
          if (k >= 1) { r.tw = null; r.lean.set(0, 0); if (w.done) w.done(); }
        }
      }
      if (r.sc) {
        const w = r.sc, k = clamp((t - w.t0) / w.dur, 0, 1); active = true;
        if (t >= w.t0) { r.scale = lerp(w.s0, w.s1, k < 1 ? easeOut(k) * (1 + 0.12 * Math.sin(Math.PI * k)) : 1); if (k >= 1) { r.scale = w.s1; r.sc = null; if (w.done) w.done(); } }
      }
      placeRec(r);
    }
    return active;
  }

  // ---- camera
  let view = 'tilt', aspect = 1, camCur = null, camGoal = null, camTw = null;
  function boundsPts() {
    const pts = [], h = W / 2;
    for (const x of [-h, h]) for (const z of [-h, h]) { pts.push(new THREE.Vector3(x, FRAME_TOP, z), new THREE.Vector3(x, TABLE_Y, z)); }
    for (const x of [-3.6, 3.6]) for (const z of [-3.6, 3.6]) pts.push(new THREE.Vector3(x, 1.45, z));
    if (trayMode === 'ends') for (const s of [-1, 1]) for (const x of [-2.3, 2.3]) { const z = s * (W / 2 + 0.85); pts.push(new THREE.Vector3(x, TABLE_Y, z), new THREE.Vector3(x, 0.5, z)); }
    else for (const s of [-1, 1]) for (const z of [-3.7, 3.7]) { const x = s * (W / 2 + 0.85); pts.push(new THREE.Vector3(x, TABLE_Y, z), new THREE.Vector3(x, 0.5, z)); }
    return pts;
  }
  const tmpCam = new THREE.PerspectiveCamera();
  function applyCamTo(cam, c) {
    const el = c.el * Math.PI / 180, az = c.oaz + c.az;
    cam.fov = c.fov; cam.aspect = aspect;
    cam.position.set(c.T.x + c.d * Math.sin(az) * Math.cos(el), c.T.y + c.d * Math.sin(el), c.T.z + c.d * Math.cos(az) * Math.cos(el));
    cam.up.set(0, 1, 0);
    if (c.el > 85) cam.up.set(-Math.sin(az), 0, -Math.cos(az));
    cam.lookAt(c.T); cam.near = Math.max(0.1, c.d * 0.25); cam.far = c.d * 4 + 30; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  }
  function fitCam(vname, o) {
    const V = VIEWS[vname];
    // widen vertical fov on tall screens so the horizontal angle stays natural
    const fov = clamp(2 * Math.atan(Math.tan(V.fov * Math.PI / 360) * Math.max(1, 0.85 / aspect)) * 180 / Math.PI, V.fov, 40);
    const c = { el: V.el + (vname === 'top' ? 0 : clamp((0.9 - aspect) * 16, 0, 8)), az: V.az, oaz: o === 'w' ? 0 : Math.PI, fov, d: 20, T: new THREE.Vector3(0, 0, 0) };
    const pts = boundsPts(), v = new THREE.Vector3();
    const mx = aspect < 0.8 ? 0.03 : 0.06, my = 0.05;
    const extent = () => { let x0 = 9, x1 = -9, y0 = 9, y1 = -9; for (const p of pts) { v.copy(p).project(tmpCam); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); } return [x0, x1, y0, y1]; };
    for (let it = 0; it < 4; it++) {
      let lo = 3, hi = 120;
      for (let i = 0; i < 28; i++) { const mid = (lo + hi) / 2; c.d = mid; applyCamTo(tmpCam, c); const [x0, x1, y0, y1] = extent(); if (x0 >= -1 + mx && x1 <= 1 - mx && y0 >= -1 + my && y1 <= 1 - my) hi = mid; else lo = mid; }
      c.d = hi; applyCamTo(tmpCam, c);
      const [x0, x1, y0, y1] = extent();
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hh = c.d * Math.tan(c.fov * Math.PI / 360), hw = hh * aspect;
      const right = new THREE.Vector3().setFromMatrixColumn(tmpCam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(tmpCam.matrixWorld, 1);
      c.T.addScaledVector(right, cx * hw).addScaledVector(up, cy * hh);
    }
    return c;
  }
  function applyCam(c) {
    applyCamTo(camera, c);
    const fogD = c.d;
    scene.fog.near = fogD * 1.05; scene.fog.far = fogD * 2.3;
    key.position.copy(LIGHT_POS).applyAxisAngle(new THREE.Vector3(0, 1, 0), c.oaz); key.target.position.set(0, 0, 0);
    fill.position.copy(FILL_POS).applyAxisAngle(new THREE.Vector3(0, 1, 0), c.oaz);
  }
  function setCamGoal(animate) {
    camGoal = fitCam(view, orient);
    if (!camCur || !animate) { camCur = cloneCam(camGoal); camTw = null; applyCam(camCur); }
    else camTw = { from: cloneCam(camCur), t0: now(), dur: 750 };
    wake();
  }
  const cloneCam = c => ({ el: c.el, az: c.az, oaz: c.oaz, fov: c.fov, d: c.d, T: c.T.clone() });
  function stepCam(t) {
    if (!camTw) return false;
    const k = clamp((t - camTw.t0) / camTw.dur, 0, 1), e = easeIO(k), a = camTw.from, b = camGoal;
    camCur = { el: lerp(a.el, b.el, e), az: lerp(a.az, b.az, e), oaz: lerp(a.oaz, b.oaz, e), fov: lerp(a.fov, b.fov, e), d: lerp(a.d, b.d, e) + Math.sin(Math.PI * k) * (Math.abs(b.oaz - a.oaz) > 1 ? b.d * 0.15 : 0), T: a.T.clone().lerp(b.T, e) };
    applyCam(camCur);
    if (k >= 1) { camTw = null; camCur = cloneCam(camGoal); applyCam(camCur); return false; }
    return true;
  }

  // ---- pointer / drag
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  const drag = { active: false, rec: null, from: -1, pid: null, moved: false, touch: false, sx: 0, sy: 0, goal: new THREE.Vector3(), lift: 0, hover: -1, vel: new THREE.Vector2(), dropInfo: null, consumed: false };
  function setRay(ev) { const r = canvas.getBoundingClientRect(); ndc.set((ev.clientX - r.left) / r.width * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); }
  function groundHit(ev, y = 0) { setRay(ev); plane.constant = -y; return ray.ray.intersectPlane(plane, hit) ? hit.clone() : null; }
  function pick(ev) {
    setRay(ev);
    plane.constant = 0;
    const g = ray.ray.intersectPlane(plane, hit) ? squareAt(hit.x, hit.z) : -1;
    const hits = ray.intersectObjects(recs.filter(r => r.state === 'board').map(r => r.mesh), false);
    const pSq = hits.length ? hits[0].object.userData.rec.sq : -1;
    if (g >= 0 && HL.selected >= 0 && HL.targets.has(g)) return g; // tapping a target behind a tall piece
    return pSq >= 0 ? pSq : g;
  }
  const recAt = sq => recs.find(r => r.state === 'board' && r.sq === sq);
  function onDown(ev) {
    if (ev.button > 0 || drag.active) return;
    ev.preventDefault();
    const sq = pick(ev);
    const res = cb.onSquareDown(sq, ev);
    if (res === true && sq >= 0) {
      const r = recAt(sq); if (!r) return;
      r.tw = null; r.sc = null; r.scale = 1;
      Object.assign(drag, { active: true, rec: r, from: sq, pid: ev.pointerId, moved: false, touch: ev.pointerType !== 'mouse', sx: ev.clientX, sy: ev.clientY, lift: r.pos.y, hover: -1 });
      drag.goal.copy(sqPos(sq));
      try { canvas.setPointerCapture(ev.pointerId); } catch (_) {}
      wake();
    }
  }
  function onMove(ev) {
    if (!drag.active || ev.pointerId !== drag.pid) return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 6) drag.moved = true;
    if (!drag.moved) return;
    const g = groundHit(ev, drag.touch ? 0 : 0.25);
    if (g) {
      if (drag.touch) { // keep the piece visible above the finger
        const f = new THREE.Vector3().subVectors(camCur.T, camera.position); f.y = 0; f.normalize(); g.addScaledVector(f, 0.62);
      }
      g.x = clamp(g.x, -4.4, 4.4); g.z = clamp(g.z, -4.4, 4.4);
      drag.goal.set(g.x, 0, g.z);
    }
    wake();
  }
  function stepDrag() {
    if (!drag.active) return false;
    const r = drag.rec;
    const liftT = drag.moved ? (drag.touch ? 0.75 : 0.45) : 0.16;
    drag.lift += (liftT - drag.lift) * 0.25;
    const px = r.pos.x, pz = r.pos.z;
    const k = drag.moved ? 0.4 : 0.3;
    r.pos.x += (drag.goal.x - r.pos.x) * k; r.pos.z += (drag.goal.z - r.pos.z) * k; r.pos.y = drag.lift;
    drag.vel.set(r.pos.x - px, r.pos.z - pz);
    r.lean.x += (clamp(drag.vel.y * 1.6, -0.35, 0.35) - r.lean.x) * 0.2;
    r.lean.y += (clamp(-drag.vel.x * 1.6, -0.35, 0.35) - r.lean.y) * 0.2;
    r.scale += ((drag.moved ? 1.06 : 1.02) - r.scale) * 0.3;
    placeRec(r);
    const h = drag.moved ? squareAt(r.pos.x, r.pos.z) : -1, hv = (h >= 0 && HL.targets.has(h)) ? h : -1;
    if (hv !== drag.hover) { drag.hover = hv; updateHL(); }
    return true;
  }
  function settleBack(r, bounce) {
    moveRec(r, sqPos(r.sq), { dur: bounce ? 380 : 160, ease: bounce ? (t => 1 - Math.pow(1 - t, 3) * Math.cos(t * 4)) : easeOut, scale: 1 });
    r.lean.set(0, 0);
  }
  function endDrag(ev, cancel) {
    if (!drag.active || (ev && ev.pointerId !== drag.pid)) return;
    drag.active = false;
    try { canvas.releasePointerCapture(drag.pid); } catch (_) {}
    const r = drag.rec, from = drag.from, moved = drag.moved;
    drag.hover = -1; updateHL();
    if (!moved) { settleBack(r, false); if (!cancel) cb.onSquareUp(pick(ev), ev, { dragged: false, from }); wake(); return; }
    const to = cancel ? -1 : squareAt(r.pos.x, r.pos.z);
    drag.dropInfo = { rec: r, from, to }; drag.consumed = false;
    let res = false;
    if (to >= 0 && to !== from) res = cb.onSquareUp(to, ev, { dragged: true, from });
    if (!drag.consumed) {
      if (res === false || to < 0 || to === from) { drag.dropInfo = null; settleBack(r, to !== from && to >= 0); }
      else moveRec(r, sqPos(to), { dur: 120, ease: easeOut, scale: 1 }); // wait on the target for setPosition/animateMove
    }
    wake();
  }
  const onUp = e => endDrag(e, false), onCancel = e => endDrag(e, true), onLost = e => { if (drag.active) endDrag(e, false); };
  const noCtx = e => e.preventDefault();
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('lostpointercapture', onLost);
  canvas.addEventListener('contextmenu', noCtx);
  const onCtxLost = e => { e.preventDefault(); cb.onContextLost(); };
  canvas.addEventListener('webglcontextlost', onCtxLost);

  // ---- position sync (diff like renderPieces)
  function sync(arr, o = {}) {
    arr = Array.from(arr, x => x || '');
    const instant = !!o.instant, ms = o.ms || 300;
    const want = []; for (let s = 0; s < 64; s++) if (arr[s]) want.push({ s, p: arr[s], rec: null });
    const onBoard = recs.filter(r => r.state === 'board'), inTray = recs.filter(r => r.state === 'tray');
    const used = new Set(), pair = (w, r) => { w.rec = r; used.add(r); };
    const dropInfo = drag.dropInfo; drag.dropInfo = null; if (dropInfo) drag.consumed = true;
    const hints = (o.hints || []).slice(); if (dropInfo && dropInfo.to >= 0) hints.unshift([dropInfo.from, dropInfo.to]);
    for (const [a, b] of hints) { // hinted movers (type may change: promotion)
      const w = want.find(x => x.s === b && !x.rec); if (!w) continue;
      const r = onBoard.find(r => r.sq === a && !used.has(r) && r.p === w.p) || onBoard.find(r => r.sq === a && !used.has(r) && isWhite(r.p) === isWhite(w.p) && r.p.toLowerCase() === 'p');
      if (r) pair(w, r);
    }
    for (const w of want) { if (w.rec) continue; const r = onBoard.find(r => !used.has(r) && r.sq === w.s && r.p === w.p); if (r) pair(w, r); }
    for (const w of want) {
      if (w.rec) continue; let best = null, bd = 1e9;
      for (const r of onBoard) { if (used.has(r) || r.p !== w.p) continue; const d = Math.abs((r.sq & 7) - (w.s & 7)) + Math.abs((r.sq >> 3) - (w.s >> 3)); if (d < bd) { bd = d; best = r; } }
      if (best && bd <= 7) pair(w, best);
    }
    const lostList = o.captured ? [...(o.captured.w || []).map(c => c.toUpperCase()), ...(o.captured.b || []).map(c => c.toLowerCase())] : deriveLost(arr);
    const trayWant = lostList.map(p => ({ p, rec: null }));
    for (const t of trayWant) { const r = inTray.find(r => !used.has(r) && r.p === t.p); if (r) { t.rec = r; used.add(r); } }
    const capturedNow = [];
    for (const t of trayWant) { if (t.rec) continue; const r = onBoard.find(r => !used.has(r) && r.p === t.p); if (r) { t.rec = r; used.add(r); capturedNow.push(r); } }
    for (const w of want) { if (w.rec) continue; const r = inTray.find(r => !used.has(r) && r.p === w.p); if (r) pair(w, r); }
    const born = new Set();
    for (const w of want) if (!w.rec) { w.rec = newRec(w.p); born.add(w.rec); used.add(w.rec); }
    for (const t of trayWant) if (!t.rec) { t.rec = newRec(t.p); born.add(t.rec); used.add(t.rec); }
    for (const r of recs.slice()) if (!used.has(r)) {
      if (instant) removeRec(r); else { r.tw = null; scaleRec(r, r.scale, 0, 200, () => removeRec(r)); }
    }
    let hopping = false;
    for (const w of want) {
      const r = w.rec, to = sqPos(w.s), wasTray = r.state === 'tray', changed = r.p !== w.p;
      r.state = 'board'; r.sq = w.s;
      if (drag.active && drag.rec === r) { if (drag.from === w.s) continue; drag.active = false; }
      if (born.has(r)) { r.pos.copy(to); if (instant) { r.scale = 1; placeRec(r); } else scaleRec(r, 0, 1, 260); if (changed) swapType(r, w.p); continue; }
      if (changed) { const np = w.p; r.p = np; r._morph = np; }
      if (instant) { r.tw = null; r.pos.copy(to); r.scale = 1; if (r._morph) { swapType(r, r._morph); r._morph = null; } placeRec(r); continue; }
      if (r.tw && r.tw.to.distanceTo(to) < 1e-3) continue;
      if (r.pos.distanceTo(to) < 1e-3 && r.scale === 1) { if (r._morph) { swapType(r, r._morph); r._morph = null; } continue; }
      const morph = () => { if (r._morph) { swapType(r, r._morph); r._morph = null; scaleRec(r, 0.6, 1, 220); } };
      if (dropInfo && dropInfo.rec === r) { const ok = dropInfo.to === w.s; moveRec(r, to, { dur: ok ? 110 : 380, ease: easeOut, scale: 1, done: morph }); r.lean.set(0, 0); continue; }
      const dist = Math.hypot(r.pos.x - to.x, r.pos.z - to.z);
      hopping = true;
      moveRec(r, to, { dur: (o.ms ? ms : 260 + dist * 38) * (wasTray ? 1.4 : 1), hop: 0.28 + dist * 0.07 + (r.p.toLowerCase() === 'n' ? 0.2 : 0), scale: 1, lean: 0.12, done: morph });
    }
    // tray
    trayWant.sort((a, b) => (isWhite(a.p) - isWhite(b.p)) || (ORDER[a.p.toLowerCase()] - ORDER[b.p.toLowerCase()]));
    const idx = { w: 0, b: 0 }, total = { w: trayWant.filter(t => isWhite(t.p)).length, b: trayWant.filter(t => !isWhite(t.p)).length };
    for (const t of trayWant) {
      const c = isWhite(t.p) ? 'w' : 'b', r = t.rec, to = trayPos(t.p, idx[c]++, total[c]);
      const wasBoard = r.state === 'board'; r.state = 'tray'; r.sq = -1;
      if (drag.active && drag.rec === r) drag.active = false;
      if (born.has(r)) { r.pos.copy(to); if (instant) { r.scale = TRAY_SCALE; placeRec(r); } else scaleRec(r, 0, TRAY_SCALE, 260); continue; }
      if (instant) { r.tw = null; r.pos.copy(to); r.scale = TRAY_SCALE; placeRec(r); continue; }
      if (r.tw && r.tw.to.distanceTo(to) < 1e-3) continue;
      if (r.pos.distanceTo(to) < 1e-3) continue;
      if (wasBoard) moveRec(r, to, { dur: 620, delay: hopping ? 170 : 0, hop: 0.35, scale: TRAY_SCALE, lean: 0.08 });
      else moveRec(r, to, { dur: 320, scale: TRAY_SCALE });
    }
    curArr = arr;
    wake();
  }

  // ---- highlights
  function put(m, sq, y) { const v = sqPos(sq); m.position.set(v.x, y == null ? m.position.y : y, v.z); m.visible = true; }
  function updateHL() {
    lastHL.forEach(m => m.visible = false); selHL.visible = hovHL.visible = checkHL.visible = false; dots.forEach(d => d.visible = false);
    if (HL.lastMove) { put(lastHL[0], HL.lastMove[0]); put(lastHL[1], HL.lastMove[1]); }
    if (HL.selected >= 0) put(selHL, HL.selected);
    if (HL.check >= 0) put(checkHL, HL.check);
    marks.forEach(m => m.visible = false);
    HL.marks.forEach((mk, j) => { let m = marks[j]; if (!m) { m = flat(glowGeo, markMat('green'), 0.0045); marks.push(m); } m.material = markMat(mk.color); put(m, mk.sq); });
    if (drag.hover >= 0) put(hovHL, drag.hover);
    let i = 0;
    for (const t of HL.targets) {
      const occ = !!curArr[t] && !(drag.active && t === drag.from);
      let d = dots[i]; if (!d) { d = flat(dotGeo, dotMat, 0.007); dots.push(d); }
      d.geometry = occ ? ringGeo : dotGeo; d.material = occ ? ringMat : dotMat; put(d, t); i++;
    }
    wake();
  }
  const toSq = v => typeof v === 'string' ? (v.charCodeAt(0) - 97) + (v.charCodeAt(1) - 49) * 8 : v;

  // ---- resize / quality
  let disposed = false, prCur = maxPR, slowFrames = 0, frames = 0;
  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    aspect = w / h;
    renderer.setPixelRatio(prCur); renderer.setSize(w, h, false);
    const newMode = aspect >= 1.3 ? 'sides' : 'ends'; // captured pieces beside the board only on clearly wide views
    if (newMode !== trayMode) { trayMode = newMode; if (recs.length) sync(curArr, { instant: true }); }
    setShadowSize(quality === 'low' ? 1024 : (Math.max(w, h) * prCur > 1300 || quality === 'high') ? 2048 : 1024);
    camera.aspect = aspect;
    setCamGoal(!!camTw);
    wake();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(container); else window.addEventListener('resize', resize);

  let renderCount = 0;
  function frame(t) {
    raf = 0;
    if (degradeNext) { degradeNext = false; degrade(); }
    const dt = lastT ? t - lastT : 16; lastT = t;
    const a1 = stepTweens(t), a2 = stepDrag(), a3 = stepCam(t);
    const active = a1 || a2 || a3;
    if (active || dirty) { renderer.render(scene, camera); renderCount++; dirty = false; }
    // adaptive: if animation runs slowly, lower resolution and shadow map
    if (active && quality === 'auto') {
      frames++; if (dt > 40) slowFrames++;
      if (frames >= 30) { if (slowFrames > 18 && prCur > 1) degradeNext = true; frames = slowFrames = 0; }
    }
    if (active && !raf) raf = requestAnimationFrame(frame); else if (!active) lastT = 0;
  }
  let degradeNext = false;
  function degrade() { prCur = Math.max(1, prCur - 0.5); resize(); setShadowSize(1024); }

  resize();
  sync(new Array(64).fill(''), { instant: true });

  const api = {
    setPosition(arr, o = {}) { sync(arr, o); updateHL(); },
    animateMove(from, to, o = {}) {
      from = toSq(from); to = toSq(to);
      const arr = curArr.slice(), p = arr[from]; if (!p) return;
      const cap = o.capture === true ? to : (o.capture != null && o.capture !== false ? toSq(o.capture) : -1);
      if (cap >= 0 && cap !== to) arr[cap] = '';
      arr[from] = ''; arr[to] = o.promotion ? (isWhite(p) ? o.promotion.toUpperCase() : o.promotion.toLowerCase()) : p;
      const hints = [[from, to]];
      if (o.castleRook) { const rf = toSq(o.castleRook[0]), rt = toSq(o.castleRook[1]); arr[rt] = arr[rf]; arr[rf] = ''; hints.push([rf, rt]); }
      sync(arr, { hints, ms: o.ms });
      updateHL();
    },
    setHighlights(h = {}) {
      HL = {
        lastMove: h.lastMove ? [toSq(h.lastMove[0]), toSq(h.lastMove[1])] : null,
        selected: h.selected == null ? -1 : toSq(h.selected),
        targets: new Set(h.targets ? Array.from(h.targets instanceof Map ? h.targets.keys() : h.targets, toSq) : []),
        check: h.check == null ? -1 : toSq(h.check),
        marks: [...(h.hint ? [{ sq: toSq(h.hint[0]), color: 'green' }, { sq: toSq(h.hint[1]), color: 'green' }] : []), ...(h.marks || []).map(m => ({ sq: toSq(m.sq), color: m.color || 'green' }))],
      };
      updateHL();
    },
    setOrientation(o, instant) { if (o !== 'w' && o !== 'b' || o === orient) return; orient = o; setMap(frameMat, frameTexture(texSize, theme, orient), [1 / W, 1 / W, 0.5, 0.5]); setCamGoal(!instant); },
    setPieceColors(c = {}) { for (const k of ['w', 'b']) if (c[k]) pieceColors[k] = Object.assign({}, pieceColors[k], c[k]); applyPieceColors(); wake(); },
    setTheme(t = {}) { theme = Object.assign({}, theme, t); applyBoardTheme(); wake(); },
    cycleView(name, instant) { view = name && VIEWS[name] ? name : VIEW_ORDER[(VIEW_ORDER.indexOf(view) + 1) % VIEW_ORDER.length]; setCamGoal(!instant); return view; },
    getView: () => view,
    pickAt(clientX, clientY) { return pick({ clientX, clientY }); }, // which square a tap at this screen point selects
    squareToScreen(sq, height) { const v = sqPos(toSq(sq)).clone(); v.y = height || 0; v.project(camera); const r = canvas.getBoundingClientRect(); return { x: (v.x + 1) / 2 * r.width, y: (1 - v.y) / 2 * r.height }; },
    resize,
    _degrade: () => { degradeNext = true; wake(); },
    isIdle: () => !raf && !drag.active,
    stats: () => ({ renderCount, pixelRatio: prCur, shadow: key.shadow.mapSize.x, tris: renderer.info.render.triangles, calls: renderer.info.render.calls, gl: info.renderer }),
    dispose() {
      disposed = true; if (raf) cancelAnimationFrame(raf); raf = 0;
      if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel); canvas.removeEventListener('lostpointercapture', onLost); canvas.removeEventListener('contextmenu', noCtx);
      canvas.removeEventListener('webglcontextlost', onCtxLost);
      scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } });
      Object.values(GEOS).forEach(g => g.dispose());
      if (scene.environment) scene.environment.dispose();
      key.shadow.map && key.shadow.map.dispose();
      renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss();
      canvas.remove();
    },
  };
  return api;
}
