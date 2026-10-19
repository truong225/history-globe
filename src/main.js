import Globe from 'globe.gl';
import * as THREE from 'three';
import { geoArea, geoCentroid, geoContains } from 'd3-geo';
import { EVENTS, CATEGORIES } from './events.js';
import { translateName } from './names_vi.js';
import { createFlatMap } from './flat.js';

// ---------- Thời gian ----------
// T = năm thiên văn * 12 + chỉ số tháng (0..11). Năm thiên văn: 1 TCN = 0, 2 TCN = -1, ...
const histToAstro = (y) => (y < 0 ? y + 1 : y);
const astroToHist = (a) => (a <= 0 ? a - 1 : a);
const toT = (histYear, month = 1) => histToAstro(histYear) * 12 + (month - 1);
const fromT = (T) => { const a = Math.floor(T / 12); return { year: astroToHist(a), month: T - a * 12 + 1 }; };
const yearStr = (y) => (y < 0 ? `${-y} TCN` : `${y}`);

const now = new Date();
const T_MIN = toT(-3000, 1);
const T_MAX = toT(now.getFullYear(), now.getMonth() + 1);

// Thước phi tuyến: thời gian gần đây được dành nhiều chỗ hơn.
const KNOTS = [[T_MIN, 0], [toT(-500), 0.16], [toT(500), 0.32], [toT(1500), 0.52], [toT(1800), 0.68], [toT(1900), 0.8], [T_MAX, 1]];
function posToT(p) {
  for (let i = 1; i < KNOTS.length; i++) {
    const [t0, p0] = KNOTS[i - 1], [t1, p1] = KNOTS[i];
    if (p <= p1) return Math.round(t0 + ((p - p0) / (p1 - p0)) * (t1 - t0));
  }
  return T_MAX;
}
function tToPos(T) {
  for (let i = 1; i < KNOTS.length; i++) {
    const [t0, p0] = KNOTS[i - 1], [t1, p1] = KNOTS[i];
    if (T <= t1) return p0 + ((T - t0) / (t1 - t0)) * (p1 - p0);
  }
  return 1;
}

const WORLD_ERAS = [
  [-3000, 'Thời đại đồ đồng'], [-1200, 'Thời đại đồ sắt'], [-500, 'Thời kỳ Cổ điển'], [476, 'Thời Trung đại'],
  [1453, 'Thời Cận đại sớm'], [1789, 'Thời kỳ cách mạng và đế quốc'], [1914, 'Thời kỳ hai cuộc Thế chiến'],
  [1945, 'Thời kỳ hậu Thế chiến'], [1947, 'Thời kỳ Chiến tranh Lạnh'], [1991, 'Thời kỳ đương đại']
];
const VN_ERAS = [
  [-3000, 'văn hóa tiền Đông Sơn'], [-2879, 'nước Văn Lang (theo truyền thuyết)'], [-257, 'nước Âu Lạc'], [-207, 'nước Nam Việt'],
  [-111, 'thời Bắc thuộc'], [40, 'Trưng Vương'], [43, 'thời Bắc thuộc'], [544, 'nước Vạn Xuân'], [602, 'thời Bắc thuộc'],
  [905, 'thời tự chủ họ Khúc'], [939, 'nhà Ngô'], [968, 'nhà Đinh'], [980, 'nhà Tiền Lê'], [1009, 'nhà Lý'], [1226, 'nhà Trần'],
  [1400, 'nhà Hồ'], [1407, 'thời thuộc Minh'], [1428, 'nhà Hậu Lê (Lê sơ)'], [1527, 'Nam - Bắc triều'], [1592, 'Lê trung hưng, Trịnh - Nguyễn'],
  [1778, 'nhà Tây Sơn'], [1802, 'nhà Nguyễn'], [1858, 'thời Pháp xâm lược và đô hộ'], [1945, 'kháng chiến chống Pháp'],
  [1954, 'hai miền chia cắt'], [1975, 'nước Việt Nam thống nhất'], [1986, 'thời kỳ Đổi Mới']
];
const pickEra = (list, y) => { let r = list[0][1]; for (const [s, n] of list) if (y >= s) r = n; return r; };

// ---------- Bản đồ ----------
const SNAPSHOTS = [-3000, -2000, -1500, -1000, -700, -500, -400, -323, -300, -200, -100, -1, 100, 200, 300, 400, 500, 600, 700, 800, 900,
  1000, 1100, 1200, 1279, 1300, 1400, 1492, 1500, 1530, 1600, 1650, 1700, 1715, 1783, 1800, 1815, 1878, 1880, 1900, 1914, 1920,
  1930, 1938, 1945, 1960, 1994, 2000, 2010, 2020];
const snapshotFor = (y) => { let s = SNAPSHOTS[0]; for (const k of SNAPSHOTS) if (k <= y) s = k; return s; };
const VN_NAMES = new Set(['Vietnam', 'Đại Việt', 'Annam', 'Champa', 'Champa City States', 'Funan', 'Nan-Yue', 'Cochin China', 'French Indochina', 'French Indo-China']);

const mapCache = new Map();

function rewind(feature) {
  // d3-geo cần vòng ngoài theo chiều kim đồng hồ; đảo vòng nếu diện tích bị hiểu là cả địa cầu.
  const g = feature.geometry;
  if (!g) return feature;
  const fix = (rings) => (geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI ? rings.map((r) => r.slice().reverse()) : rings);
  if (g.type === 'Polygon') g.coordinates = fix(g.coordinates);
  else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map(fix);
  return feature;
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Không tải được ${url} (${r.status})`);
  return r.json();
}

async function loadSnapshot(key) {
  if (mapCache.has(key)) return mapCache.get(key);
  const p = fetchJSON(`./maps/${key}.json`).then((geo) => {
    const feats = geo.features.filter((f) => f.geometry).map((f) => {
      rewind(f);
      const name = f.properties.NAME || null;
      const owner = f.properties.SUBJECTO || name;
      return { kind: name ? 'pol' : 'land', name, owner, vi: name ? translateName(name) : '', ownerVi: owner ? translateName(owner) : '', feature: f, area: geoArea(f) };
    });
    // Nhãn: mỗi tên một nhãn, đặt ở tâm mảnh lớn nhất.
    const byName = new Map();
    for (const d of feats) {
      if (d.kind !== 'pol') continue;
      const g = d.feature.geometry;
      const parts = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
      let best = null, bestA = -1;
      for (const c of parts) { const a = geoArea({ type: 'Polygon', coordinates: c }); if (a > bestA) { bestA = a; best = c; } }
      const [lng, lat] = geoCentroid({ type: 'Polygon', coordinates: best });
      const prev = byName.get(d.name);
      if (!prev) byName.set(d.name, { name: d.name, vi: d.vi, lat, lng, area: d.area, partA: bestA });
      else { prev.area += d.area; if (bestA > prev.partA) Object.assign(prev, { lat, lng, partA: bestA }); }
    }
    const labels = [...byName.values()].sort((a, b) => b.area - a.area);
    labels.forEach((l, i) => { l.rank = i; l.vn = VN_NAMES.has(l.name); });
    return { feats, labels };
  });
  mapCache.set(key, p);
  p.catch(() => mapCache.delete(key));
  return p;
}

function colorFor(key, alpha = 0.94) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  h >>>= 0;
  const hue = h % 360, sat = 48 + ((h >> 9) % 26), light = 46 + ((h >> 17) % 14);
  return `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
}

// ---------- Sự kiện ----------
let allEvents = EVENTS.map(([y, m, lat, lng, cat, title, desc], i) => ({ id: `c${i}`, y, m, lat, lng, cat, title, desc, T: toT(y, m || 1) }));
const enabledCats = new Set(Object.keys(CATEGORIES));

function autoWindowYears(y) {
  if (y < -500) return 100;
  if (y < 500) return 50;
  if (y < 1500) return 25;
  if (y < 1800) return 10;
  if (y < 1900) return 3;
  return 1;
}

// ---------- Trạng thái ----------
const $ = (s) => document.querySelector(s);
const state = { T: toT(1945, 9), playing: false, snapKey: null, data: null, hover: null, selected: null, region: null, labelMode: 'main', overlay: 'soft', cards: [] };

const globeEl = $('#globe');
const overlayAlpha = () => ({ strong: 0.62, soft: 0.34, off: 0 }[state.overlay]);
const globe = Globe({ animateIn: false })(globeEl)
  .globeImageUrl('./textures/earth.jpg')
  .bumpImageUrl('./textures/topology.png')
  .backgroundImageUrl('./textures/sky.jpg')
  .backgroundColor('#03060b')
  .showAtmosphere(true)
  .atmosphereColor('#7db7ff')
  .atmosphereAltitude(0.19)
  .showGraticules(false)
  .polygonCapCurvatureResolution(4)
  .polygonsTransitionDuration(0)
  .polygonAltitude((d) => (d === state.hover || (state.region && d.name === state.region.name) ? 0.012 : 0.004))
  .polygonCapColor((d) => {
    if (state.region && d.name === state.region.name) return 'rgba(232,182,90,0.62)';
    if (d === state.hover) return 'rgba(232,182,90,0.5)';
    return colorFor(d.owner, overlayAlpha());
  })
  .polygonSideColor(() => 'rgba(0,0,0,0)')
  .polygonStrokeColor(() => (state.overlay === 'off' ? 'rgba(255,240,215,0.35)' : 'rgba(255,240,215,0.6)'))
  .onPolygonHover((d) => {
    globeEl.style.cursor = d ? 'pointer' : 'grab';
    setHover(d);
  })
  .onPolygonClick((d) => openRegion(d))
  .pointLat('lat').pointLng('lng')
  .pointColor((e) => CATEGORIES[e.cat].color)
  .pointAltitude(0.006)
  .pointRadius(0.22)
  .pointResolution(10)
  .pointsTransitionDuration(0)
  .pointLabel((e) => `<div class="evtip"><time>${fmtEventDate(e)}</time><b>${esc(e.title)}</b></div>`)
  .onPointClick((e) => selectEvent(e, true))
  .ringLat('lat').ringLng('lng')
  .ringColor((e) => (t) => hexA(CATEGORIES[e.cat].color, 1 - t))
  .ringMaxRadius(3).ringPropagationSpeed(2).ringRepeatPeriod(1500)
  .htmlLat('lat').htmlLng('lng')
  .htmlAltitude((d) => (d.type === 'ev' ? 0.008 : 0.01))
  .htmlTransitionDuration(0)
  .htmlElement((d) => (d.type === 'ev' ? makeCard(d) : makeLabel(d)))
  .htmlElementVisibilityModifier((el, vis) => { el.style.opacity = vis ? '' : '0'; el.classList.toggle('behind', !vis); });

function makeLabel(l) {
  const el = document.createElement('div');
  el.className = 'ctry' + (l.rank < 12 ? ' big' : '') + (l.vn ? ' vn' : '');
  el.textContent = l.vi;
  return el;
}

// Thẻ chú thích sự kiện: chấm định vị, cọc nối và thẻ nổi phía trên vùng địa lý.
function makeCard(d) {
  const e = d.e, color = CATEGORIES[e.cat].color;
  const el = document.createElement('div');
  el.className = 'evpin' + (e.exact || (e.now && !e.m) ? ' hot' : e.now ? ' now' : ' far');
  el.style.setProperty('--c', color);
  el.__ev = e;
  el.innerHTML = `<span class="stem"></span><span class="hook"></span><span class="pin"></span>
    <div class="evcard" data-id="${e.id}">
      <button type="button" class="evmain">
        <span class="meta"><span class="cat">${CATEGORIES[e.cat].label}</span><time>${fmtEventDate(e)}</time></span>
        <span class="ttl">${esc(e.title)}</span>
        ${e.desc ? `<span class="dsc">${esc(e.desc)}</span>` : ''}
      </button>
      <div class="more" hidden></div>
    </div>`;
  el.querySelector('.evmain').addEventListener('click', (ev) => { ev.stopPropagation(); selectEvent(e, true); });
  el.querySelector('.more').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-id]'); if (!b) return;
    ev.stopPropagation();
    const m = allEvents.find((x) => x.id === b.dataset.id); if (m) selectEvent(m, true);
  });
  const pin = el.querySelector('.pin');
  pin.title = `${fmtEventDate(e)} · ${e.title}`;
  pin.addEventListener('click', (ev) => { ev.stopPropagation(); selectEvent(e, true); });
  return el;
}

// ---------- Sắp xếp thẻ để không đè lên nhau ----------
// 1. Gom các sự kiện có chấm định vị gần nhau trên màn hình thành một thẻ chung (thẻ chính + danh sách).
// 2. Đặt từng thẻ chính: thử các độ cao cọc và lệch trái/phải; thẻ không được đè lên thẻ khác,
//    lên cọc của thẻ khác, lên chấm sự kiện khác, tiêu đề hay sổ sự kiện.
// 3. Thẻ không còn chỗ được gộp vào thẻ gần nhất thay vì bị ẩn mất.
const CLUSTER_PX = 70, MERGE_PX = 170, MAX_ROWS = 4;
const priOf = (p) => (p.classList.contains('hot') ? 0 : p.classList.contains('now') ? 1 : 2);
const overlap = (a, b, pad = 4) => a.l < b.r + pad && a.r > b.l - pad && a.t < b.b + pad && a.b > b.t - pad;

function setMembers(it) {
  const more = it.p.querySelector('.more');
  const list = it.members.map((m) => m.e).sort((a, b) => a.T - b.T);
  const key = list.map((e) => e.id).join(',');
  if (more.dataset.key === key) return;
  more.dataset.key = key;
  it.p.classList.toggle('group', list.length > 0);
  if (!list.length) { more.hidden = true; more.replaceChildren(); return; }
  const rows = list.slice(0, MAX_ROWS).map((e) => `<button type="button" class="mrow" data-id="${e.id}" title="${esc(e.desc || e.title)}">
      <span class="dot" style="background:${CATEGORIES[e.cat].color}"></span><time>${fmtEventDate(e)}</time><span class="mt">${esc(e.title)}</span></button>`);
  if (list.length > MAX_ROWS) rows.push(`<span class="mmore">và ${list.length - MAX_ROWS} sự kiện khác gần đây</span>`);
  more.innerHTML = `<span class="mhead">Sự kiện lân cận · ${list.length}</span>${rows.join('')}`;
  more.hidden = false;
}

function layoutCards() {
  const host = flat.active ? flat.container : globeEl;
  if (host.offsetParent === null || globeEl.classList.contains('morphing')) return;
  const stage = $('#stage').getBoundingClientRect();
  const all = [...host.querySelectorAll('.evpin')];
  const vis = [];
  for (const p of all) {
    if (p.classList.contains('behind')) { p.classList.remove('member', 'crowded'); continue; }
    const r = p.getBoundingClientRect();
    if (r.left < stage.left - 20 || r.left > stage.right + 20 || r.top < stage.top - 20 || r.top > stage.bottom + 20) { p.classList.add('crowded'); continue; }
    vis.push({ p, e: p.__ev, x: r.left, y: r.top, pri: priOf(p), members: [] });
  }
  vis.sort((a, b) => a.pri - b.pri || a.e.T - b.e.T);

  // Gom cụm theo khoảng cách trên màn hình.
  let leaders = [];
  for (const it of vis) {
    const L = leaders.find((l) => Math.hypot(l.x - it.x, l.y - it.y) < CLUSTER_PX);
    if (L) L.members.push(it); else leaders.push(it);
  }

  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
  const fixed = [rectOf($('#masthead')), rectOf($('#viewbar'))];
  if (!$('#panel').hidden) fixed.push(rectOf($('#panel')));

  function place(list) {
    const placed = [...fixed];
    const failed = [];
    for (const L of list) {
      setMembers(L);
      L.p.classList.remove('member', 'crowded');
      const c = L.p.querySelector('.evcard');
      const w = c.offsetWidth, h = c.offsetHeight;
      const own = new Set([L, ...L.members]);
      const pinsElse = vis.filter((v) => !own.has(v)).map((v) => ({ l: v.x - 7, r: v.x + 7, t: v.y - 7, b: v.y + 7 }));
      const shift = w / 2 - 16;
      const cands = [];
      if (L.p.__slot) cands.push(L.p.__slot);
      // Ưu tiên thẻ nằm trên chấm; nếu chật thì thử treo thẻ xuống dưới chấm.
      for (let lvl = 0; lvl < 7; lvl++) for (const down of [false, true]) for (const dx of [0, -shift, shift, -2 * shift, 2 * shift]) cands.push({ stem: 20 + lvl * 34, dx, down });
      let best = null;
      for (const cd of cands) {
        const cx = L.x + cd.dx;
        const box = cd.down
          ? { l: cx - w / 2, r: cx + w / 2, t: L.y + cd.stem, b: L.y + cd.stem + h }
          : { l: cx - w / 2, r: cx + w / 2, b: L.y - cd.stem, t: L.y - cd.stem - h };
        if (box.t < stage.top + 4 || box.b > stage.bottom - 4 || box.l < stage.left + 4 || box.r > stage.right - 4) continue;
        // Cọc đi từ chấm tới cạnh thẻ; nếu thẻ lệch hẳn sang bên thì có thêm đoạn ngang.
        const edge = cd.down ? box.t : box.b;
        const stemV = { l: L.x - 2, r: L.x + 2, t: Math.min(edge, L.y), b: Math.max(edge, L.y) };
        const hx = cd.dx > 0 ? Math.max(0, cd.dx - w / 2 + 14) : Math.min(0, cd.dx + w / 2 - 14);
        const hook = { l: L.x + Math.min(0, hx), r: L.x + Math.max(0, hx), t: edge - 1, b: edge + 1 };
        if (placed.some((q) => overlap(box, q) || overlap(stemV, q, 0) || (hx && overlap(hook, q, 0)))) continue;
        if (pinsElse.some((q) => overlap(box, q, 2) || overlap(stemV, q, -1))) continue;
        best = { cd, box, stemV, hook, hx };
        break;
      }
      if (!best) { failed.push(L); continue; }
      placed.push(best.box, best.stemV, best.hook);
      L.p.__slot = best.cd; L.box = best.box;
      L.p.style.setProperty('--stem', best.cd.stem + 'px');
      L.p.style.setProperty('--dx', best.cd.dx + 'px');
      L.p.classList.toggle('down', !!best.cd.down);
      // Đường kẻ ngang nối đỉnh cọc với thẻ khi thẻ lệch hẳn sang bên.
      L.p.style.setProperty('--hl', Math.min(0, best.hx) + 'px');
      L.p.style.setProperty('--hw', Math.abs(best.hx) + 'px');
    }
    return { failed, placed };
  }

  let { failed } = place(leaders);
  if (failed.length) {
    // Gộp thẻ không có chỗ vào thẻ chính gần nhất, rồi xếp lại một lần.
    const ok = leaders.filter((l) => !failed.includes(l));
    for (const F of failed) {
      let target = null, bd = MERGE_PX;
      for (const l of ok) { const d = Math.hypot(l.x - F.x, l.y - F.y); if (d < bd) { bd = d; target = l; } }
      if (target) target.members.push(F, ...F.members), F.merged = true;
    }
    leaders = leaders.filter((l) => !l.merged);
    ({ failed } = place(leaders));
  }
  for (const L of leaders) {
    const out = failed.includes(L);
    L.p.classList.toggle('crowded', out);
    for (const m of L.members) { m.p.classList.add('member'); m.p.classList.remove('crowded', 'group'); m.p.__slot = null; }
  }
  for (const L of failed) { L.p.__slot = null; }
}
function cardLoop() { try { layoutCards(); } catch (err) { console.error(err); } requestAnimationFrame(cardLoop); }

globe.pointOfView({ lat: 22, lng: 100, altitude: 2.1 });
const controls = globe.controls();
controls.autoRotate = false;
controls.zoomSpeed = 0.8;

// Bóng phản chiếu trên mặt nước và lớp mây.
const loader = new THREE.TextureLoader();
loader.load('./textures/water.png', (tex) => {
  const m = globe.globeMaterial();
  m.specularMap = tex; m.specular = new THREE.Color('#5c6670'); m.shininess = 18; m.needsUpdate = true;
});
const clouds = new THREE.Mesh(
  new THREE.SphereGeometry(globe.getGlobeRadius() * 1.006, 72, 72),
  new THREE.MeshPhongMaterial({ transparent: true, opacity: 0.42, depthWrite: false })
);
clouds.raycast = () => {};
loader.load('./textures/clouds.webp', (tex) => { clouds.material.map = tex; clouds.material.needsUpdate = true; globe.scene().add(clouds); });
(function spin() { clouds.rotation.y -= 0.00006; requestAnimationFrame(spin); })();

new ResizeObserver(() => { const r = $('#stage').getBoundingClientRect(); globe.width(r.width).height(r.height); }).observe($('#stage'));

// ---------- Chế độ bản đồ 2D ----------
function setHover(d) {
  state.hover = d || null;
  refreshPolygons();
  showTip();
}
const flat = createFlatMap({
  stage: $('#stage'), globe, globeEl, state, clouds, colorFor, overlayAlpha, categories: CATEGORIES, hexA, makeLabel, makeCard,
  onHover: setHover,
  onRegion: (d) => openRegion(d),
  onEvent: (e) => selectEvent(e, true),
  labelFilter: (l, limit) => l.vn || l.rank < limit
});

async function setMode(mode) {
  if (flat.busy || (mode === '2d') === flat.active) return;
  $('#mode3d').setAttribute('aria-pressed', mode === '3d');
  $('#mode2d').setAttribute('aria-pressed', mode === '2d');
  state.hover = null; showTip();
  document.body.dataset.mode = mode;
  if (mode === '2d') await flat.toFlat();
  else { globe.polygonsData(globe.polygonsData()); await flat.toGlobe(); }
  try { localStorage.setItem('dcls-mode', mode); } catch (_) { /* không lưu được thì bỏ qua */ }
}
$('#mode3d').addEventListener('click', () => setMode('3d'));
$('#mode2d').addEventListener('click', () => setMode('2d'));
function zoom(f) {
  if (flat.active) flat.zoomBy(f);
  else { const p = globe.pointOfView(); globe.pointOfView({ altitude: Math.max(0.12, Math.min(5, p.altitude / f)) }, 400); }
}
$('#zoom-in').addEventListener('click', () => zoom(1.6));
$('#zoom-out').addEventListener('click', () => zoom(1 / 1.6));

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
function fmtEventDate(e) { return e.m ? `T${e.m}/${yearStr(e.y)}` : yearStr(e.y); }

function refreshPolygons() { if (flat.active) flat.refresh(); else globe.polygonsData(globe.polygonsData()); }

// ---------- Hiển thị ----------
async function applySnapshot(year) {
  const key = snapshotFor(year);
  if (key === state.snapKey) return;
  state.snapKey = key;
  $('#map-note').innerHTML = `Biên giới theo bản đồ năm <b>${key === 2020 ? 'hiện đại (Natural Earth)' : yearStr(key)}</b> · đang tải…`;
  try {
    const data = await loadSnapshot(key);
    if (state.snapKey !== key) return;
    state.data = data; state.hover = null;
    globe.polygonsData(data.feats.filter((d) => d.kind === 'pol'));
    applyLabels();
    $('#map-note').innerHTML = `Biên giới theo bản đồ năm <b>${key === 2020 ? 'hiện đại (Natural Earth)' : yearStr(key)}</b> · ${data.labels.length} quốc gia, lãnh thổ, nền văn hóa`;
  } catch (err) {
    $('#map-note').textContent = `${err.message}. Kiểm tra kết nối rồi kéo thanh thời gian để thử lại.`;
    state.snapKey = null;
  }
}

function applyLabels() {
  if (!state.data) return;
  const mode = state.labelMode;
  const labels = mode === 'none' ? [] : mode === 'all' ? state.data.labels : state.data.labels.filter((l) => l.rank < 70 || l.vn);
  globe.htmlElementsData([...labels, ...state.cards]);
  flat.sync();
}

function windowYears(y) {
  const v = $('#window').value;
  return v === 'auto' ? autoWindowYears(y) : Number(v);
}

function eventsInWindow() {
  const { year, month } = fromT(state.T);
  const w = windowYears(year);
  const a0 = histToAstro(year);
  return allEvents.filter((e) => enabledCats.has(e.cat)).map((e) => {
    const dy = Math.abs(histToAstro(e.y) - a0);
    if (dy > w) return null;
    const near = w === 0 ? 1 : 1 - dy / (w + 1);
    return Object.assign(e, { near, now: e.y === year, exact: e.y === year && e.m === month });
  }).filter(Boolean).sort((a, b) => a.T - b.T);
}

function render() {
  const { year, month } = fromT(state.T);
  const yr = Math.abs(year);
  $('#date-big').innerHTML = `Tháng ${month} · ${yr}<span class="era">${year < 0 ? 'TCN' : 'CN'}</span>`;
  $('#era-name').textContent = `${pickEra(WORLD_ERAS, year)} · Việt Nam: ${pickEra(VN_ERAS, year)}`;
  $('#track').value = Math.round(tToPos(state.T) * 10000);
  $('#j-month').value = String(month);
  $('#j-year').value = String(yr);
  $('#j-era').value = year < 0 ? 'bce' : 'ce';
  applySnapshot(year);

  const evs = eventsInWindow();
  const a0 = histToAstro(year);
  const ranked = evs.slice().sort((a, b) => (b.exact - a.exact) || (b.now - a.now) || (Math.abs(histToAstro(a.y) - a0) - Math.abs(histToAstro(b.y) - a0)));
  const cardEvs = ranked.slice(0, window.innerWidth < 820 ? 6 : 12);
  state.cards = cardEvs.map((e) => ({ type: 'ev', e, lat: e.lat, lng: e.lng }));
  globe.pointsData(evs.filter((e) => !cardEvs.includes(e)));
  globe.ringsData(evs.filter((e) => e.exact || (e.now && !e.m)));
  applyLabels();
  if (!state.region) renderTimeList(evs, year);
}

function renderTimeList(evs, year) {
  const w = windowYears(year);
  $('#panel-title').textContent = 'Sự kiện quanh thời điểm này';
  $('#panel-sub').textContent = w === 0 ? `Trong năm ${yearStr(year)} · ${evs.length} sự kiện` : `Từ ${yearStr(astroToHist(histToAstro(year) - w))} đến ${yearStr(astroToHist(histToAstro(year) + w))} · ${evs.length} sự kiện`;
  const list = $('#list');
  if (!evs.length) {
    list.innerHTML = `<div class="empty">Chưa có sự kiện nào trong bộ dữ liệu cho khoảng này. Hãy mở rộng phạm vi ở thanh dưới, hoặc bấm “Tải thêm sự kiện từ Wikidata”.</div>`;
    return;
  }
  list.innerHTML = evs.map(evHTML).join('');
  const cur = list.querySelector('.ev.now');
  if (cur && state.playing) cur.scrollIntoView({ block: 'nearest' });
}

function evHTML(e) {
  const link = e.url ? ` <a href="${esc(e.url)}" target="_blank" rel="noopener">Wikidata</a>` : '';
  return `<button type="button" class="ev${e.now ? ' now' : ''}${state.selected === e.id ? ' sel' : ''}" data-id="${e.id}">
    <time>${fmtEventDate(e)}</time>
    <div><div class="t"><span class="dot" style="background:${CATEGORIES[e.cat].color}"></span>${esc(e.title)}</div>
    ${e.desc || link ? `<div class="d">${esc(e.desc || '')}${link}</div>` : ''}</div></button>`;
}

function selectEvent(e, fly) {
  state.selected = e.id;
  if (fly) {
    if (flat.active) flat.flyTo(e.lat, e.lng);
    else globe.pointOfView({ lat: e.lat, lng: e.lng, altitude: Math.min(globe.pointOfView().altitude, 1.6) }, 900);
  }
  document.querySelectorAll('.ev.sel, .evcard.sel').forEach((n) => n.classList.remove('sel'));
  document.querySelectorAll(`.evcard[data-id="${e.id}"]`).forEach((n) => n.classList.add('sel'));
  const n = document.querySelector(`.ev[data-id="${e.id}"]`);
  if (n) { n.classList.add('sel'); n.scrollIntoView({ block: 'nearest' }); }
}

$('#list').addEventListener('click', (ev) => {
  if (ev.target.closest('a')) return;
  const b = ev.target.closest('.ev'); if (!b) return;
  const e = allEvents.find((x) => x.id === b.dataset.id); if (!e) return;
  if (state.region && e.T !== state.T) { setT(e.T); }
  selectEvent(e, true);
});

// ---------- Lãnh thổ ----------
function openRegion(d) {
  state.region = d;
  refreshPolygons();
  const inside = allEvents.filter((e) => enabledCats.has(e.cat) && geoContains(d.feature, [e.lng, e.lat])).sort((a, b) => a.T - b.T);
  const { year } = fromT(state.T);
  $('#panel-title').textContent = d.vi;
  const owner = d.owner && d.owner !== d.name ? ` · thuộc ${d.ownerVi}` : '';
  const orig = d.vi !== d.name ? `${d.name}${owner}` : owner.replace(/^ · /, '');
  $('#panel-sub').innerHTML = `${esc(orig)}${orig ? ' · ' : ''}lãnh thổ năm ${yearStr(snapshotFor(year))} · ${inside.length} sự kiện mọi thời kỳ trong vùng này · <a href="https://vi.wikipedia.org/w/index.php?search=${encodeURIComponent(d.vi)}" target="_blank" rel="noopener" style="color:var(--brass)">Tra Wikipedia</a> · <a href="#" id="back" style="color:var(--brass)">Quay lại dòng thời gian</a>`;
  $('#list').innerHTML = inside.length ? inside.map(evHTML).join('') : '<div class="empty">Bộ dữ liệu chưa có sự kiện nằm trong lãnh thổ này.</div>';
  $('#back').addEventListener('click', (ev) => { ev.preventDefault(); closeRegion(); });
  $('#panel').classList.remove('closed');
}
function closeRegion() { state.region = null; refreshPolygons(); render(); }

// Hộp thông tin khi rê chuột
let mouse = { x: 0, y: 0 };
$('#stage').addEventListener('pointermove', (e) => { const r = $('#stage').getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; positionTip(); });
function showTip() {
  const tip = $('#tip'), d = state.hover;
  if (!d) { tip.hidden = true; return; }
  const sub = [d.vi !== d.name ? d.name : '', d.owner && d.owner !== d.name ? `thuộc ${d.ownerVi}` : ''].filter(Boolean).join(' · ');
  tip.innerHTML = `<b>${esc(d.vi)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
  tip.hidden = false; positionTip();
}
function positionTip() {
  const tip = $('#tip'); if (tip.hidden) return;
  const r = $('#stage').getBoundingClientRect();
  tip.style.left = Math.min(mouse.x + 14, r.width - tip.offsetWidth - 8) + 'px';
  tip.style.top = Math.min(mouse.y + 14, r.height - tip.offsetHeight - 8) + 'px';
}

// ---------- Điều khiển ----------
let raf = 0;
function setT(T) {
  state.T = Math.max(T_MIN, Math.min(T_MAX, T));
  if (state.region) { state.region = null; refreshPolygons(); }
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(render);
}
$('#track').addEventListener('input', (e) => setT(posToT(Number(e.target.value) / 10000)));
document.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => setT(state.T + Number(b.dataset.step))));

const monthSel = $('#j-month');
for (let m = 1; m <= 12; m++) monthSel.insertAdjacentHTML('beforeend', `<option value="${m}">Tháng ${m}</option>`);
$('#jump').addEventListener('submit', (e) => {
  e.preventDefault();
  const y = Math.abs(parseInt($('#j-year').value, 10));
  if (!y) return;
  setT(toT($('#j-era').value === 'bce' ? -y : y, Number(monthSel.value)));
});
$('#window').addEventListener('change', render);
$('#labels').addEventListener('change', (e) => { state.labelMode = e.target.value; applyLabels(); });
$('#overlay').addEventListener('change', (e) => { state.overlay = e.target.value; refreshPolygons(); });
$('#clouds').addEventListener('change', (e) => { clouds.visible = e.target.checked; });

let timer = null;
$('#play').addEventListener('click', () => {
  state.playing = !state.playing;
  $('#play').textContent = state.playing ? '❚❚ Dừng' : '▶ Chạy';
  clearInterval(timer);
  if (state.playing) {
    if (state.T >= T_MAX) setT(T_MIN);
    timer = setInterval(() => {
      const next = state.T + Number($('#speed').value);
      if (next >= T_MAX) { setT(T_MAX); $('#play').click(); return; }
      setT(next);
    }, 450);
  }
});

$('#panel-toggle').addEventListener('click', () => {
  const p = $('#panel'); p.classList.toggle('closed');
  $('#panel-toggle').textContent = p.classList.contains('closed') ? 'Mở sổ sự kiện' : 'Thu gọn';
});

// Bộ lọc loại sự kiện
const filters = $('#filters');
for (const [k, c] of Object.entries(CATEGORIES)) {
  filters.insertAdjacentHTML('beforeend', `<button type="button" class="chip" aria-pressed="true" data-cat="${k}"><span class="dot" style="background:${c.color}"></span>${c.label}</button>`);
}
filters.addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  const k = b.dataset.cat;
  if (enabledCats.has(k)) enabledCats.delete(k); else enabledCats.add(k);
  b.setAttribute('aria-pressed', enabledCats.has(k));
  state.region ? openRegion(state.region) : render();
});

// Vạch thước
const ticks = $('#ticks');
[[-3000, 1], [-2000, 0], [-500, 1], [1, 0], [500, 1], [1000, 0], [1500, 1], [1700, 0], [1800, 1], [1850, 0], [1900, 1], [1950, 0], [now.getFullYear(), 1]]
  .forEach(([y, major], i, arr) => ticks.insertAdjacentHTML('beforeend', `<span class="${major ? 'era' : ''}${i === 0 ? ' first' : ''}${i === arr.length - 1 ? ' last' : ''}${y === -500 || y === 1800 ? ' opt' : ''}" style="left:${(tToPos(toT(y)) * 100).toFixed(2)}%">${y === now.getFullYear() ? 'Nay' : yearStr(y)}</span>`));

// ---------- Wikidata ----------
const wdSeen = new Set();
$('#wd-btn').addEventListener('click', async () => {
  const { year } = fromT(state.T);
  const w = Math.min(Math.max(windowYears(year), 1), 25);
  const a0 = histToAstro(year);
  const pad = (a) => (a < 0 ? '-' + String(-a).padStart(4, '0') : String(a).padStart(4, '0'));
  const from = `${pad(a0 - w)}-01-01T00:00:00Z`, to = `${pad(a0 + w + 1)}-01-01T00:00:00Z`;
  const q = `SELECT ?e ?eLabel ?eDescription ?date ?coord ?sl WHERE {
  { ?e wdt:P585 ?date } UNION { ?e wdt:P580 ?date }
  FILTER(?date >= "${from}"^^xsd:dateTime && ?date < "${to}"^^xsd:dateTime)
  ?e wdt:P625 ?coord ; wikibase:sitelinks ?sl .
  FILTER(?sl >= 8)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "vi,en". }
} ORDER BY DESC(?sl) LIMIT 150`;
  const status = $('#wd-status');
  status.textContent = `Đang truy vấn Wikidata cho ${yearStr(astroToHist(a0 - w))} – ${yearStr(astroToHist(a0 + w))}…`;
  try {
    const r = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: { Accept: 'application/sparql-results+json' } });
    if (!r.ok) throw new Error(`máy chủ trả về mã ${r.status}`);
    const js = await r.json();
    let added = 0;
    for (const b of js.results.bindings) {
      const id = b.e.value.split('/').pop();
      if (wdSeen.has(id)) continue;
      const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value); if (!m) continue;
      const dm = /^(-?\d+)-(\d\d)/.exec(b.date.value); if (!dm) continue;
      const hy = astroToHist(parseInt(dm[1], 10));
      const mo = parseInt(dm[2], 10);
      wdSeen.add(id);
      allEvents.push({ id: 'w' + id, y: hy, m: mo === 1 && /-01-01T/.test(b.date.value) ? 0 : mo, lat: +m[2], lng: +m[1], cat: 'wd',
        title: b.eLabel ? b.eLabel.value : id, desc: b.eDescription ? b.eDescription.value : '', url: b.e.value, T: toT(hy, mo) });
      added++;
    }
    status.textContent = `Đã thêm ${added} sự kiện từ Wikidata (tên lấy tiếng Việt nếu có, nếu không là tiếng Anh). Nguồn: query.wikidata.org`;
    render();
  } catch (err) {
    status.textContent = `Không kết nối được Wikidata (${err.message}). Trang web đã xuất bản không được phép gọi máy chủ bên ngoài; hãy chạy bản mã nguồn trên máy của ngài để dùng tính năng này.`;
  }
});

// ---------- Khởi động ----------
if (window.matchMedia('(max-width: 820px)').matches) { $('#panel').classList.add('closed'); $('#panel-toggle').textContent = 'Mở sổ sự kiện'; }

globe.polygonGeoJsonGeometry((d) => d.feature.geometry);
render();
requestAnimationFrame(cardLoop);
try { if (localStorage.getItem('dcls-mode') === '2d') setTimeout(() => setMode('2d'), 600); } catch (_) { /* bỏ qua */ }
window.__app = { state, setT, toT, fromT, render, globe, setMode, flat };
