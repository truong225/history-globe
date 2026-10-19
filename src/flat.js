// Chế độ bản đồ 2D: phép chiếu trụ đều (equirectangular) vẽ trên canvas,
// cùng hiệu ứng "trải phẳng" địa cầu (nội suy giữa phép chiếu trực giao và phép chiếu trụ).
import * as THREE from 'three';
import { geoPath, geoEquirectangular, geoGraticule10, geoContains, geoBounds } from 'd3-geo';

const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const wrapLng = (l) => ((((l + 180) % 360) + 360) % 360) - 180;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createFlatMap(deps) {
  const { stage, globe, globeEl, state, colorFor, overlayAlpha, categories, hexA, makeLabel, makeCard, onHover, onRegion, onEvent, labelFilter } = deps;

  // Lớp: nền (ảnh + lãnh thổ), lớp động (điểm, vòng sóng), lớp HTML (nhãn, thẻ), canvas cho hiệu ứng chuyển.
  const root = document.createElement('div'); root.id = 'flat'; root.hidden = true;
  const base = document.createElement('canvas'); base.className = 'flat-base';
  const fx = document.createElement('canvas'); fx.className = 'flat-fx';
  const html = document.createElement('div'); html.className = 'flat-html';
  const scrim = document.createElement('div'); scrim.className = 'flat-scrim';
  root.append(base, fx, scrim, html);
  stage.insertBefore(root, globeEl.nextSibling);

  const img = new Image(); img.src = './textures/earth.jpg'; img.onload = () => drawBase();
  const graticule = geoGraticule10();
  let W = 0, H = 0, dpr = 1;
  const view = { lng: 100, lat: 20, k: 200 };
  let active = false, items = [], frame = 0;

  function resize() {
    const r = stage.getBoundingClientRect();
    W = r.width; H = r.height; dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [base, fx]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px'; }
    clampView();
    if (active) { drawBase(); placeHtml(); }
  }
  new ResizeObserver(resize).observe(stage);

  const kFit = () => Math.min(W / (2 * Math.PI), H / Math.PI);
  const kMax = () => kFit() * 28;
  function clampView() {
    if (!W) return;
    view.k = Math.max(kFit(), Math.min(kMax(), view.k));
    view.lng = wrapLng(view.lng);
    const half = (H / 2 / view.k) * DEG;
    view.lat = half >= 90 ? 0 : Math.max(-(90 - half), Math.min(90 - half, view.lat));
  }

  const projection = () => geoEquirectangular().rotate([-view.lng, 0]).scale(view.k).translate([W / 2, H / 2 + view.k * view.lat * RAD]).precision(0.3);

  // ---------- Bán kính địa cầu trên màn hình (để chuyển cảnh liền mạch) ----------
  function globeScreenRadius(alt) {
    const cam = globe.camera(), r = globe.getGlobeRadius(), d = r * (1 + alt);
    return (H / 2) * Math.tan(Math.asin(r / d)) / Math.tan((cam.fov * RAD) / 2);
  }
  function altitudeForRadius(R) {
    const cam = globe.camera();
    const q = (R * Math.tan((cam.fov * RAD) / 2)) / (H / 2);
    return Math.max(0.12, Math.min(5, 1 / Math.sin(Math.atan(q)) - 1));
  }

  // ---------- Vẽ lớp nền ----------
  function drawBase() {
    if (!active || !W) return;
    const ctx = base.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#03060b'; ctx.fillRect(0, 0, W, H);
    const k = view.k, top = H / 2 + k * view.lat * RAD - (k * Math.PI) / 2, mapW = 2 * Math.PI * k;
    let x0 = W / 2 + k * (-180 - view.lng) * RAD;
    x0 -= Math.ceil(x0 / mapW) * mapW;
    if (img.complete && img.naturalWidth) {
      for (let x = x0; x < W; x += mapW) ctx.drawImage(img, x, top, mapW, k * Math.PI);
    } else {
      ctx.fillStyle = '#123a5c'; ctx.fillRect(0, top, W, k * Math.PI);
    }
    const p = projection(), path = geoPath(p, ctx);
    ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); path(graticule); ctx.stroke();
    const alpha = overlayAlpha();
    for (const d of globe.polygonsData()) {
      const hot = d === state.hover || (state.region && d.name === state.region.name);
      const fill = hot ? (d === state.hover ? 'rgba(232,182,90,0.5)' : 'rgba(232,182,90,0.62)') : alpha > 0 ? colorFor(d.owner, alpha) : null;
      ctx.beginPath(); path(d.feature);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.lineWidth = hot ? 1.6 : 0.8;
      ctx.strokeStyle = hot ? 'rgba(255,226,160,0.95)' : state.overlay === 'off' ? 'rgba(255,240,215,0.4)' : 'rgba(255,240,215,0.62)';
      ctx.stroke();
    }
  }

  // ---------- Lớp động: điểm sự kiện và vòng sóng ----------
  function drawFx(ts) {
    if (!active) return;
    const ctx = fx.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const p = projection();
    const ringR = Math.max(16, view.k * 3 * RAD);
    for (const e of globe.ringsData()) {
      const xy = p([e.lng, e.lat]); if (!xy) continue;
      for (const off of [0, 0.5]) {
        const t = ((ts / 1500) + off) % 1;
        ctx.beginPath(); ctx.arc(xy[0], xy[1], 4 + t * ringR, 0, 2 * Math.PI);
        ctx.strokeStyle = hexA(categories[e.cat].color, 1 - t); ctx.lineWidth = 2; ctx.stroke();
      }
    }
    for (const e of globe.pointsData()) {
      const xy = p([e.lng, e.lat]); if (!xy) continue;
      ctx.beginPath(); ctx.arc(xy[0], xy[1], 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = categories[e.cat].color; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
    }
    frame = requestAnimationFrame(drawFx);
  }

  // ---------- Lớp HTML: nhãn quốc gia và thẻ sự kiện ----------
  function syncHtml() {
    html.replaceChildren();
    items = globe.htmlElementsData().map((d) => {
      const wrap = document.createElement('div'); wrap.className = 'flat-item';
      wrap.style.zIndex = d.type === 'ev' ? '2' : '1';
      const el = d.type === 'ev' ? makeCard(d) : makeLabel(d);
      wrap.append(el); html.append(wrap);
      return { d, wrap, el };
    });
    placeHtml();
  }
  function placeHtml() {
    if (!active) return;
    const p = projection();
    // Càng phóng to càng hiện nhiều nhãn.
    const limit = 22 * Math.pow(view.k / kFit(), 1.4);
    for (const it of items) {
      const xy = p([it.d.lng, it.d.lat]);
      let vis = !!xy && xy[0] > -40 && xy[0] < W + 40 && xy[1] > -20 && xy[1] < H + 20;
      if (vis && it.d.type !== 'ev' && !labelFilter(it.d, limit)) vis = false;
      if (xy) it.wrap.style.transform = `translate(${xy[0]}px, ${xy[1]}px)`;
      it.el.style.opacity = vis ? '' : '0';
      it.el.classList.toggle('behind', !vis);
    }
  }

  function redraw() { drawBase(); placeHtml(); }
  let pending = 0;
  function schedule() { if (!pending) pending = requestAnimationFrame(() => { pending = 0; redraw(); }); }

  // ---------- Tương tác: kéo, cuộn, chụm hai ngón ----------
  const pointers = new Map();
  let downAt = null, moved = 0, pinch = null;
  function featureAt(x, y) {
    const ll = projection().invert([x, y]);
    if (!ll || Math.abs(ll[1]) > 90) return null;
    const list = globe.polygonsData();
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      const b = d.bounds || (d.bounds = geoBounds(d.feature));
      const inLat = ll[1] >= b[0][1] && ll[1] <= b[1][1];
      const inLng = b[0][0] <= b[1][0] ? ll[0] >= b[0][0] && ll[0] <= b[1][0] : ll[0] >= b[0][0] || ll[0] <= b[1][0];
      if (inLat && inLng && geoContains(d.feature, ll)) return d;
    }
    return null;
  }
  function pointAt(x, y) {
    const p = projection();
    let best = null, bd = 10;
    for (const e of globe.pointsData()) {
      const xy = p([e.lng, e.lat]); if (!xy) continue;
      const dd = Math.hypot(xy[0] - x, xy[1] - y);
      if (dd < bd) { bd = dd; best = e; }
    }
    return best;
  }
  function zoomAt(x, y, factor) {
    const ll = projection().invert([x, y]);
    view.k *= factor; clampView();
    if (ll) {
      view.lng = ll[0] - ((x - W / 2) / view.k) * DEG;
      view.lat = ll[1] + ((y - H / 2) / view.k) * DEG;
      clampView();
    }
    schedule();
  }
  const local = (e) => { const r = base.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  base.addEventListener('pointerdown', (e) => {
    base.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1) { downAt = local(e); moved = 0; }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]) };
    }
    base.style.cursor = 'grabbing';
  });
  base.addEventListener('pointermove', (e) => {
    const xy = local(e);
    if (!pointers.has(e.pointerId)) {
      const pt = pointAt(...xy);
      const d = pt ? null : featureAt(...xy);
      base.style.cursor = pt || d ? 'pointer' : 'grab';
      base.title = pt ? `${pt.title}` : '';
      if (d !== state.hover) { onHover(d); }
      return;
    }
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, xy);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, dist / pinch.dist);
      pinch.dist = dist; moved += 10;
      return;
    }
    const dx = xy[0] - prev[0], dy = xy[1] - prev[1];
    moved += Math.abs(dx) + Math.abs(dy);
    view.lng -= (dx / view.k) * DEG;
    view.lat += (dy / view.k) * DEG;
    clampView(); schedule();
  });
  const up = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    base.style.cursor = 'grab';
    if (pointers.size === 0 && moved < 5 && e.type === 'pointerup') {
      const xy = local(e);
      const pt = pointAt(...xy);
      if (pt) { onEvent(pt); return; }
      const d = featureAt(...xy);
      if (d) onRegion(d);
    }
  };
  base.addEventListener('pointerup', up);
  base.addEventListener('pointercancel', up);
  base.addEventListener('pointerleave', () => { if (!pointers.size && state.hover) onHover(null); });
  base.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = local(e);
    zoomAt(x, y, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  // ---------- Hiệu ứng trải phẳng / cuộn tròn (WebGL) ----------
  // Một lưới phẳng mang ảnh vệ tinh + lớp lãnh thổ; mỗi đỉnh nội suy giữa vị trí trên mặt cầu
  // và vị trí trên mặt phẳng vuông góc với hướng nhìn, nên địa cầu "mở" ra đúng thành bản đồ 2D.
  const GR = globe.getGlobeRadius();
  const texCanvas = document.createElement('canvas');
  texCanvas.width = 4096; texCanvas.height = 2048;
  const tex = new THREE.CanvasTexture(texCanvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const uniforms = {
    map: { value: tex }, t: { value: 0 }, lng0: { value: 0 }, latC: { value: 0 }, S: { value: 1 }, R: { value: GR },
    D: { value: new THREE.Vector3() }, E: { value: new THREE.Vector3() }, N: { value: new THREE.Vector3() }
  };
  const morphMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1, 256, 128),
    new THREE.ShaderMaterial({
      uniforms, side: THREE.DoubleSide,
      vertexShader: `
        uniform float t, lng0, latC, S, R; uniform vec3 D, E, N;
        varying vec2 vLL; varying float vShade;
        const float PI = 3.141592653589793;
        void main() {
          float rel = (uv.x - 0.5) * 2.0 * PI;
          float lat = (uv.y - 0.5) * PI;
          float lng = lng0 + rel;
          float phi = 0.5 * PI - lat, theta = 0.5 * PI - lng;
          vec3 sp = R * vec3(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta));
          vec3 fp = D * R + E * (rel * S) + N * ((lat - latC) * S);
          // Phần giữa phẳng ra trước, rìa phẳng sau: trông như tấm bản đồ được trải dần.
          float k = clamp(t * 1.35 - abs(rel) / PI * 0.35, 0.0, 1.0);
          k = k * k * (3.0 - 2.0 * k);
          vec3 p = mix(sp, fp, k);
          vLL = vec2(lng, lat);
          vShade = mix(0.55 + 0.45 * max(dot(normalize(sp), D), 0.0), 1.0, k);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vLL; varying float vShade;
        const float PI = 3.141592653589793;
        void main() {
          vec2 uv = vec2(fract((vLL.x + PI) / (2.0 * PI)), vLL.y / PI + 0.5);
          vec4 c = texture2D(map, uv);
          gl_FragColor = vec4(c.rgb * vShade, 1.0);
          #include <colorspace_fragment>
        }`
    })
  );
  morphMesh.frustumCulled = false; morphMesh.visible = false; morphMesh.raycast = () => {};
  globe.scene().add(morphMesh);

  let globeRoot = null;
  function findGlobeRoot() {
    if (globeRoot) return globeRoot;
    const mat = globe.globeMaterial();
    globe.scene().traverse((o) => { if (o.material === mat) globeRoot = o; });
    while (globeRoot && globeRoot.parent && globeRoot.parent !== globe.scene()) globeRoot = globeRoot.parent;
    return globeRoot;
  }

  function paintTexture() {
    const ctx = texCanvas.getContext('2d'), w = texCanvas.width, h = texCanvas.height;
    if (img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, w, h);
    else { ctx.fillStyle = '#123a5c'; ctx.fillRect(0, 0, w, h); }
    const path = geoPath(geoEquirectangular().scale(w / (2 * Math.PI)).translate([w / 2, h / 2]).precision(0.2), ctx);
    const alpha = overlayAlpha();
    for (const d of globe.polygonsData()) {
      const hot = state.region && d.name === state.region.name;
      ctx.beginPath(); path(d.feature);
      if (hot) { ctx.fillStyle = 'rgba(232,182,90,0.62)'; ctx.fill(); }
      else if (alpha > 0) { ctx.fillStyle = colorFor(d.owner, alpha); ctx.fill(); }
      ctx.lineWidth = hot ? 4 : 2.2;
      ctx.strokeStyle = hot ? 'rgba(255,226,160,0.95)' : state.overlay === 'off' ? 'rgba(255,240,215,0.4)' : 'rgba(255,240,215,0.62)';
      ctx.stroke();
    }
    tex.needsUpdate = true;
  }

  const P = (lat, lng) => {
    const phi = (90 - lat) * RAD, theta = (90 - lng) * RAD;
    return new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
  };
  // Đặt mặt phẳng đích: vuông góc với hướng camera, tỉ lệ khớp đúng với bản đồ 2D (k điểm ảnh / radian).
  function setupMorph(povLat, povLng, alt) {
    const cam = globe.camera();
    const dist = GR * (1 + alt);
    const ppu = (H / 2) / ((dist - GR) * Math.tan((cam.fov * RAD) / 2));
    uniforms.lng0.value = view.lng * RAD;
    uniforms.latC.value = view.lat * RAD;
    uniforms.S.value = view.k / ppu;
    uniforms.D.value.copy(P(povLat, povLng));
    uniforms.E.value.copy(P(0, povLng + 90));
    uniforms.N.value.copy(P(povLat + 90, povLng));
  }
  let saved = null;
  function beginMorph() {
    const root = findGlobeRoot();
    saved = { root: root && root.visible, clouds: deps.clouds ? deps.clouds.visible : false };
    if (root) root.visible = false;
    if (deps.clouds) deps.clouds.visible = false;
    globeEl.classList.add('morphing');
    morphMesh.visible = true;
  }
  function endMorph() {
    morphMesh.visible = false;
    const root = findGlobeRoot();
    if (root) root.visible = true;
    if (deps.clouds) deps.clouds.visible = saved ? saved.clouds : true;
    globeEl.classList.remove('morphing');
  }
  function animate(dir, done) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dur = reduce ? 1 : 1400, t0 = performance.now();
    (function step(now) {
      const u = Math.min(1, (now - t0) / dur), e = ease(u);
      uniforms.t.value = dir > 0 ? e : 1 - e;
      if (u < 1) requestAnimationFrame(step); else done();
    })(t0);
  }

  let busy = false;
  function toFlat() {
    if (active || busy) return Promise.resolve();
    busy = true; resize();
    const pov = globe.pointOfView();
    Object.assign(view, { lng: pov.lng, lat: pov.lat, k: globeScreenRadius(pov.altitude) }); clampView();
    paintTexture(); setupMorph(pov.lat, pov.lng, pov.altitude);
    uniforms.t.value = 0; beginMorph();
    return new Promise((res) => {
      animate(1, () => {
        active = true; root.classList.add('enter'); root.hidden = false;
        syncHtml(); drawBase(); frame = requestAnimationFrame(drawFx);
        requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('enter')));
        setTimeout(() => { globe.pauseAnimation(); globeEl.hidden = true; endMorph(); busy = false; res(); }, 380);
      });
    });
  }
  function toGlobe() {
    if (!active || busy) return Promise.resolve();
    busy = true;
    const alt = altitudeForRadius(Math.max(view.k, kFit() * 1.6));
    globeEl.hidden = false; globe.resumeAnimation();
    globe.pointOfView({ lat: view.lat, lng: view.lng, altitude: alt });
    paintTexture(); setupMorph(view.lat, view.lng, alt);
    uniforms.t.value = 1; beginMorph();
    root.classList.add('enter');
    return new Promise((res) => {
      setTimeout(() => {
        active = false; cancelAnimationFrame(frame);
        root.hidden = true; root.classList.remove('enter'); html.replaceChildren(); items = [];
        animate(-1, () => { endMorph(); busy = false; res(); });
      }, 360);
    });
  }

  function flyTo(lat, lng) {
    const s = { lng: view.lng, lat: view.lat }, dl = wrapLng(lng - s.lng), t0 = performance.now();
    const k = Math.max(view.k, kFit() * 2.2);
    const k0 = view.k;
    (function step(now) {
      const u = Math.min(1, (now - t0) / 800), e = ease(u);
      view.lng = s.lng + dl * e; view.lat = s.lat + (lat - s.lat) * e; view.k = k0 + (k - k0) * e;
      clampView(); redraw();
      if (u < 1 && active) requestAnimationFrame(step);
    })(t0);
  }
  function zoomBy(f) { zoomAt(W / 2, H / 2, f); }

  return {
    get active() { return active; },
    get busy() { return busy; },
    toFlat, toGlobe, flyTo, zoomBy,
    refresh() { if (active) drawBase(); },
    sync() { if (active) { syncHtml(); drawBase(); } },
    container: html
  };
}
