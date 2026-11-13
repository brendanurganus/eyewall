// Launch storms at their NASA photo's pass time and freeze the dive at altitude, to check the photo.
// usage: node test/divephoto.mjs outDir ID...
import puppeteer from 'puppeteer-core'; import path from 'path';
const [outDir, ...ids] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files', '--window-size=800,450'] });
const p = await b.newPage(); await p.setViewport({ width: 800, height: 450 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await p.goto('file://' + path.resolve('dist/index.html') + '#globe'); await new Promise((r) => setTimeout(r, 3000));
for (const id of ids) {
  const r = await p.evaluate((id) => {
    const E = __ew; if (document.getElementById('gl-arch').classList.contains('hide')) E.startGlobe();
    const s = E.ARCHIVE.find((x) => x.id === id); E.gui.select(s, null, false);
    const tt = (x) => Date.UTC(+x.slice(0, 4), +x.slice(4, 6) - 1, +x.slice(6, 8), +x.slice(8, 10), +x.slice(10, 12));
    const m = E.SATIDX[id], sl = document.getElementById('gl-slide');
    sl.value = Math.round((m.t - tt(s.t[0])) / (tt(s.t[s.t.length - 1]) - tt(s.t[0])) * 1000); sl.dispatchEvent(new Event('input'));
    const photo = document.querySelector('#gl-info p.dim:nth-last-of-type(2)')?.textContent;
    document.getElementById('gl-go').click(); return { name: s.name, photo };
  }, id);
  await new Promise((r) => setTimeout(r, 2500));
  await p.evaluate((dt) => { __ew.dbg.diveFreeze = true; __ew.dbg.fixedDt = 0.25; __ew.setDive(dt); __ew.LT.on = false; }, +(process.env.DT || 2.5));
  await new Promise((r) => setTimeout(r, 9000));
  const s = await p.evaluate(() => { const E = __ew, b = new Uint16Array(4); E.sim.r.readRenderTargetPixels(E.post.exp[E.post.ei], 0, 0, 1, 1, b); const f = (v) => E.THREE.DataUtils.fromHalfFloat(v); return { e: f(b[0]).toFixed(3), scot: f(b[1]).toFixed(2), pre: E.post.pre.toFixed(1), key: E.env.key, fade: E.post.fade.toFixed(2), photo: E.dive.u.uPhoto.value.toFixed(2), useSat: E.sky.u.uUseSat.value, alt: Math.round(E.dv.alt / 1e3) + ' km' }; });
  await p.screenshot({ path: `${outDir}/dive_${id}_${process.env.DT || 2.5}.png` });
  console.log(id, r.name, JSON.stringify(s));
}
console.log('errors', errs.slice(0, 5)); await b.close();
