// Archive browser around the globe: filters, storm list, info panel (peak, human toll, NOAA report),
// path selector (scrubber + drag on the track) and the launch button. DOM only; the globe draws.
import { CAT_COLORS, catOf } from './globe.js';
import TOLL from './toll.js';

const $ = (id) => document.getElementById(id);
const BASIN = { AL: 'Atlantic', EP: 'Eastern Pacific', CP: 'Central Pacific' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const tOf = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12));
const p2 = (v) => String(v).padStart(2, '0');
const fmtT = (t) => { const d = new Date(t); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC`; };
const catName = (c) => (c === 'TD' ? 'Tropical depression' : c === 'TS' ? 'Tropical storm' : `Category ${c} hurricane`);
const CLS = { HU: 'Hurricane', TS: 'Tropical Storm', TD: 'Tropical Depression', STS: 'Subtropical Storm', SD: 'Subtropical Depression', PTC: 'Potential Tropical Cyclone', PC: 'Post-Tropical Cyclone', RL: 'Remnants of' };
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const ago = (t) => { const h = (Date.now() - t) / 3600e3; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`; };
export const title = (s) => s.live ? `${CLS[s.live.cls] || s.live.cls} ${s.name}` : (s.cat === 'TD' ? `Tropical Depression ${s.name}` : s.cat === 'TS' ? `Tropical Storm ${s.name}` : `Hurricane ${s.name}`);
const span = (s) => {
  const a = new Date(tOf(s.t[0])), b = new Date(tOf(s.t[s.t.length - 1]));
  return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${b.getUTCDate()} ${MON[b.getUTCMonth()]} ${b.getUTCFullYear()}` : `${a.getUTCDate()} ${MON[a.getUTCMonth()]} – ${b.getUTCDate()} ${MON[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
};
const chip = (c) => `<i class="cc" style="background:${CAT_COLORS[c]}"></i>`;
const CAT_RANK = { TD: 0, TS: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6 };

// position and intensity at fix i + fraction f (linear between NOAA fixes)
export function pointAt(s, i, f) {
  const j = Math.min(i + 1, s.t.length - 1), L = (a, b) => a + (b - a) * f;
  const t = L(tOf(s.t[i]), tOf(s.t[j]));
  return { t, lat: L(s.lat[i], s.lat[j]) / 10, lon: L(s.lon[i], s.lon[j]) / 10, v: L(s.v[i], s.v[j]), p: s.p[i] != null && s.p[j] != null ? L(s.p[i], s.p[j]) : null, i, f };
}
export function pointAtTime(s, t) {
  let i = 0; while (i < s.t.length - 2 && tOf(s.t[i + 1]) <= t) i++;
  const a = tOf(s.t[i]), b = tOf(s.t[Math.min(i + 1, s.t.length - 1)]);
  return pointAt(s, i, b > a ? Math.min(1, Math.max(0, (t - a) / (b - a))) : 0);
}

export class GlobeUI {
  constructor(globe, storms, canvas, hooks) {
    this.g = globe; this.storms = storms; this.hooks = hooks; this.sel = null; this.pt = null;
    this.f = { year: 'all', basins: new Set(['AL', 'EP', 'CP']), minCat: 'TD', q: '' };
    const years = [...new Set(storms.map((s) => s.year))].sort((a, b) => b - a);
    $('gl-arch').innerHTML = `<div class="gh"><b>Storm archive</b><span>2005–2025 · NOAA best track</span></div>
      <div class="gf"><select id="gl-year"><option value="all">All years</option>${years.map((y) => `<option>${y}</option>`).join('')}</select>
      <input id="gl-q" placeholder="Search name" autocomplete="off"></div>
      <div class="gf" id="gl-basins">${Object.entries(BASIN).map(([k, v]) => `<button data-b="${k}" class="on">${v}</button>`).join('')}</div>
      <div class="gf" id="gl-cats">${['TD', 'TS', '1', '3'].map((c) => `<button data-c="${c}" class="${c === 'TD' ? 'on' : ''}">${c === 'TD' ? 'All' : c === 'TS' ? 'Named' : c === '1' ? 'Hurricanes' : 'Major'}</button>`).join('')}</div>
      <div id="gl-live"></div><div id="gl-count"></div><div id="gl-list"></div>`;
    $('gl-legend').innerHTML = ['TD', 'TS', '1', '2', '3', '4', '5'].map((c) => `<span>${chip(c)}${c === 'TD' ? 'Depression' : c === 'TS' ? 'Trop. storm' : 'Cat ' + c}</span>`).join('') +
      '<em>Track colours: Wikipedia track-map scheme (NHC has no colour standard) · <a href="methodology.html" target="_blank" rel="noopener">Methodology and sources</a></em>';
    $('gl-arch').querySelector('.gh').onclick = () => { if (innerWidth <= 760) $('gl-arch').classList.toggle('collapsed'); };
    if (innerWidth <= 760) $('gl-arch').classList.add('collapsed');
    $('gl-info').addEventListener('click', (e) => { if (e.target.classList.contains('close')) this.select(null); });
    $('gl-year').onchange = (e) => { this.f.year = e.target.value; this.apply(); };
    $('gl-q').oninput = (e) => { this.f.q = e.target.value.trim().toLowerCase(); this.apply(); };
    $('gl-basins').onclick = (e) => { const b = e.target.dataset.b; if (!b) return; const S = this.f.basins; S.has(b) ? S.delete(b) : S.add(b); if (!S.size) S.add(b); this.apply(); };
    $('gl-cats').onclick = (e) => { const c = e.target.dataset.c; if (!c) return; this.f.minCat = c; this.apply(); };
    $('gl-live').onclick = (e) => { if (e.target.dataset.reload != null) { setTimeout(() => location.reload()); return; } const r = e.target.closest('[data-l]'); if (r) this.select(this.live[+r.dataset.l], null, true); };
    this.live = []; this.liveDoc = null;
    $('gl-list').onclick = (e) => { const r = e.target.closest('[data-i]'); if (r) this.select(this.storms[+r.dataset.i], null, true); };
    // pointer: drag to turn, wheel to zoom, click a track to select, drag along the selected track to pick a time
    let down = null, last = null, moved = 0, scrub = false, hovT = 0; const pts = new Map(); let pinch = 0;
    canvas.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); down = null; moved = 99; return; } });
    canvas.addEventListener('pointerdown', (e) => { if (!this.active || pts.size > 1) return; down = last = [e.clientX, e.clientY]; moved = 0; scrub = !!(this.sel && this.g.pick(e.clientX, e.clientY, true)); if (scrub) this.scrubTo(e); });
    addEventListener('pointermove', (e) => {
      if (!this.active) return;
      if (pts.has(e.pointerId)) { pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch && d) this.g.zoom(pinch / d); pinch = d; return; } }
      if (e.pointerType === 'touch' && !down) return;
      if (down) { const dx = e.clientX - last[0], dy = e.clientY - last[1]; moved += Math.abs(dx) + Math.abs(dy); last = [e.clientX, e.clientY]; if (scrub) this.scrubTo(e); else this.g.drag(dx, dy); this.dragging = true; return; }
      const now = performance.now(); if (now - hovT < 40) return; hovT = now;
      const h = this.g.pick(e.clientX, e.clientY); this.g.hover(h?.storm || null);
      const tip = $('gl-tip');
      if (h) { const p = pointAt(h.storm, h.i, h.f); tip.style.display = 'block'; tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 12 + 'px'; tip.innerHTML = `${chip(catOf(p.v))}<b>${h.storm.name}</b> ${h.storm.year} · ${Math.round(p.v)} kt`; canvas.style.cursor = 'pointer'; }
      else { tip.style.display = 'none'; canvas.style.cursor = 'grab'; }
    });
    const lift = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
    addEventListener('pointercancel', lift);
    addEventListener('pointerup', (e) => {
      lift(e);
      if (!this.active || !down) return;
      if (moved < 5 && !scrub) { const h = this.g.pick(e.clientX, e.clientY); if (h) { this.touched = true; this.select(h.storm, pointAt(h.storm, h.i, h.f)); } }
      down = null; scrub = false; this.dragging = false;
    });
    canvas.addEventListener('wheel', (e) => { if (!this.active) return; e.preventDefault(); this.g.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    this.apply();
  }
  // live storms from NHC (live.json, refreshed by the scheduled task), or the labelled demo replay
  setLive(doc) {
    this.liveDoc = doc; this.live = doc?.storms || [];
    const demo = this.live.some((s) => s.live.demo), chk = doc?.checked ? Date.parse(doc.checked) : null;
    const head = `<div class="lh"><i class="dot${this.live.length ? ' on' : ''}"></i><b>${demo ? 'Live storms · demo' : 'Live storms'}</b><span>${demo ? 'not live' : chk ? `checked ${ago(chk)}` : ''}</span></div>`;
    let body;
    if (!doc || doc.error) body = '<p>Live NHC data could not be loaded.</p>';
    else if (!doc.checked) body = '<p>Live feed not set up in this copy.</p>';
    else if (!this.live.length) body = '<p>No active tropical cyclones in the Atlantic, eastern or central Pacific. <a href="#livedemo" data-reload>See a demo replay</a></p>';
    else body = this.live.map((s, i) => `<div class="row" data-l="${i}">${chip(catOf(s.live.v))}<b>${s.name}</b><span>${s.live.cls} · ${s.live.v} kt · adv ${+s.live.adv || '—'}</span></div>`).join('');
    if (demo) body += '<p><a href="#globe" data-reload>Back to the live feed</a></p>';
    const stale = chk && this.live.length && !demo && Date.now() - chk > 9 * 3600e3 ? '<p class="warn">Not refreshed for over 9 hours: may be out of date. Check nhc.noaa.gov.</p>' : '';
    $('gl-live').innerHTML = head + body + stale;
  }
  scrubTo(e) { const h = this.g.pick(e.clientX, e.clientY, true); if (h) this.setPoint(pointAt(this.sel, h.i, h.f)); }
  apply() {
    const f = this.f, mc = CAT_RANK[f.minCat];
    const ok = (s) => (f.year === 'all' || s.year === +f.year) && f.basins.has(s.basin) && CAT_RANK[s.cat] >= mc && (!f.q || s.name.toLowerCase().includes(f.q));
    this.g.setVisible(ok);
    for (const b of document.querySelectorAll('#gl-basins button')) b.classList.toggle('on', f.basins.has(b.dataset.b));
    for (const b of document.querySelectorAll('#gl-cats button')) b.classList.toggle('on', b.dataset.c === f.minCat);
    const rows = []; let n = 0;
    this.storms.forEach((s, i) => { if (!ok(s)) return; n++; rows.push(`<div class="row${s === this.sel ? ' sel' : ''}" data-i="${i}">${chip(s.cat)}<b>${s.name}</b><span>${s.year} · ${s.basin} · ${s.peak} kt</span></div>`); });
    $('gl-list').innerHTML = rows.reverse().join(''); $('gl-count').textContent = `${n} storm${n === 1 ? '' : 's'}`;
  }
  select(s, pt, fly) {
    if (fly === true) this.touched = true;
    this.sel = s; this.g.select(s);
    for (const r of document.querySelectorAll('#gl-list .row')) r.classList.toggle('sel', this.storms[+r.dataset.i] === s);
    if (!s) { $('gl-info').classList.add('hide'); return; }
    for (const r of document.querySelectorAll('#gl-live .row')) r.classList.toggle('sel', this.live[+r.dataset.l] === s);
    if (!pt) { let k = 0; s.v.forEach((v, i) => { if (v > s.v[k]) k = i; }); if (s.live) k = s.t.length - 1; pt = pointAt(s, k, 0); } // default: peak, or the latest fix if live
    if (s.live) return this.selectLive(s, pt, fly);
    const T = TOLL[s.id];
    const toll = !T ? '<p class="dim">Not compiled yet.</p>' :
      `<div class="row2"><span class="k">Deaths</span><b>${T.deaths}</b></div><div class="row2"><span class="k">Damage</span><b>${T.damage}</b></div>${T.note ? `<p class="dim">${T.note}</p>` : ''}`;
    const rep = T?.pdf ? `<a href="https://www.nhc.noaa.gov/data/tcr/${T.pdf}" target="_blank" rel="noopener">NOAA Tropical Cyclone Report (PDF)</a>` : '';
    $('gl-info').innerHTML = `<button class="close" aria-label="Close">×</button><div class="gh"><b>${title(s)}</b><span>${BASIN[s.basin]} · ${span(s)}</span></div>
      <div class="row2"><span class="k">Peak</span><b>${s.peak} kt · ${s.pmin ?? '—'} mb · ${s.cat === 'TD' || s.cat === 'TS' ? catName(s.cat) : 'Cat ' + s.cat}</b></div>
      <div class="sec">Human toll and damage</div>${toll}<div class="src">${rep}</div>
      <div class="sec">Start point</div>
      <input type="range" id="gl-slide" min="0" max="1000" step="1">
      <div id="gl-pt"></div>
      <p class="dim">${this.hooks.photo ? this.hooks.photo(s) : ''}</p>
      <button id="gl-go">Dive in</button>
      <p class="dim">Conditions are reconstructed from NOAA best-track measurements, not recorded.</p>`;
    $('gl-info').classList.remove('hide');
    const t0 = tOf(s.t[0]), t1 = tOf(s.t[s.t.length - 1]);
    $('gl-slide').oninput = (e) => this.setPoint(pointAtTime(s, t0 + (t1 - t0) * (+e.target.value / 1000)), true);
    $('gl-go').onclick = () => this.pt && this.hooks.launch(s, this.pt);
    this.setPoint(pt);
    if (fly !== false) { const P = s.lat.map((la, i) => [la / 10, s.lon[i] / 10]); const lat = P.reduce((a, p) => a + p[0], 0) / P.length; let lon = P.reduce((a, p) => a + p[1], 0) / P.length; this.g.flyTo(lat, lon, Math.max(this.g.view.dist, 2.4)); }
  }
  selectLive(s, pt, fly) {
    const L = s.live, it = Date.parse(L.issued), mv = L.dir != null ? `${COMPASS[Math.round(L.dir / 22.5) % 16]} at ${L.spd} kt` : '—';
    const fpk = L.fc.reduce((a, f) => (f.tau > 0 && f.v > (a?.v ?? -1) ? f : a), null);
    const lnk = [[L.pub, 'Public advisory'], [L.disc, 'Forecast discussion'], [L.gfx, 'NHC graphics']].filter((x) => x[0]).map(([u, n]) => `<a href="${u}" target="_blank" rel="noopener">${n}</a>`).join(' · ');
    const ok = s.t.length > 1;
    $('gl-info').innerHTML = `<button class="close" aria-label="Close">×</button><div class="gh"><b>${title(s)}</b><span>${BASIN[s.basin]} · <em class="${L.demo ? 'demo' : 'live'}">${L.demo ? 'Demo replay' : 'Live'}</em> · advisory ${+L.adv || '—'}</span></div>
      ${L.demo ? `<p class="warn">${L.demo}</p>` : ''}
      <div class="row2"><span class="k">Issued</span><b>${fmtT(it)}${L.demo ? '' : ` · ${ago(it)}`}</b></div>
      <div class="row2"><span class="k">Now</span><b>${chip(catOf(L.v))}${L.v} kt (${Math.round(L.v * 1.15078)} mph) · ${L.p ?? '—'} mb</b></div>
      <div class="row2"><span class="k">Moving</span><b>${mv}</b></div>
      <div class="row2"><span class="k">Position</span><b>${Math.abs(L.lat).toFixed(1)}°${L.lat >= 0 ? 'N' : 'S'} ${Math.abs(L.lon).toFixed(1)}°${L.lon < 0 ? 'W' : 'E'}</b></div>
      ${fpk ? `<div class="row2"><span class="k">Forecast peak</span><b>${chip(catOf(fpk.v))}${fpk.v} kt in ${fpk.tau} h</b></div>` : ''}
      <p class="dim">Dashed line and white area on the globe: NHC's official forecast track and cone (the centre stays inside it about two thirds of the time; impacts reach well beyond it).</p>
      <div class="src">${lnk}</div>
      <div class="sec">Impacts</div><p class="dim">Still unfolding. Deaths and damage are compiled in NHC's report after the storm. For safety decisions use the National Hurricane Center and your local National Weather Service office, not this visualiser.</p>
      <div class="sec">Start point</div>
      ${ok ? '<input type="range" id="gl-slide" min="0" max="1000" step="1"><div id="gl-pt"></div>' : '<p class="dim">NHC has not published a best-track file for this storm yet.</p><div id="gl-pt"></div>'}
      <p class="dim">No NASA photo for live storms yet; clouds come from the storm model.</p>
      <button id="gl-go"${ok ? '' : ' disabled'}>Dive in</button>
      <p class="dim">Conditions are reconstructed from NHC's operational best track up to the latest fix, not recorded. The dive stops at the latest fix; it does not play out the forecast.</p>`;
    $('gl-info').classList.remove('hide');
    $('gl-go').onclick = () => this.pt && this.hooks.launch(s, this.pt);
    if (ok) {
      const t0 = tOf(s.t[0]), t1 = tOf(s.t[s.t.length - 1]);
      $('gl-slide').oninput = (e) => this.setPoint(pointAtTime(s, t0 + (t1 - t0) * (+e.target.value / 1000)), true);
      this.setPoint(pt);
    } else { this.pt = null; this.g.setPoint(L.lat, L.lon); }
    if (fly !== false) this.g.flyTo(L.lat, L.lon, Math.max(this.g.view.dist, 2.4));
  }
  setPoint(p, fromSlider) {
    const s = this.sel; this.pt = p; this.g.setPoint(p.lat, p.lon);
    const t0 = tOf(s.t[0]), t1 = tOf(s.t[s.t.length - 1]);
    if (!fromSlider) $('gl-slide').value = Math.round(((p.t - t0) / (t1 - t0 || 1)) * 1000);
    const c = catOf(p.v), chk = this.hooks.check(s, p);
    $('gl-pt').innerHTML = `<div class="row2"><span class="k">Time</span><b>${fmtT(p.t)}</b></div>
      <div class="row2"><span class="k">Strength</span><b>${chip(c)}${catName(c)}</b></div>
      <div class="row2"><span class="k">Wind</span><b>${Math.round(p.v)} kt (${Math.round(p.v * 1.15078)} mph)</b></div>
      <div class="row2"><span class="k">Pressure</span><b>${p.p != null ? Math.round(p.p) + ' mb' : '—'}</b></div>
      <div class="row2"><span class="k">Position</span><b>${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(1)}°${p.lon < 0 ? 'W' : 'E'}</b></div>
      <p class="${chk.ok ? 'dim' : 'warn'}">${chk.msg}</p>`;
    $('gl-go').disabled = !chk.ok;
  }
  show(on) { this.active = on; for (const id of ['gl-arch', 'gl-legend']) $(id).classList.toggle('hide', !on); $('gl-info').classList.toggle('hide', !on || !this.sel); if (!on) $('gl-tip').style.display = 'none'; }
}
