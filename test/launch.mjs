// Globe -> launch -> storm scene for chosen storms. Reports launch checks, errors, and screenshots.
// usage: node test/launch.mjs outDir "Name|year|frac(0-1 along track, or 'peak')" ...
import puppeteer from 'puppeteer-core';
import path from 'path';
const [outDir, ...specs] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--allow-file-access-from-files', '--window-size=1100,620'] });
const page = await browser.newPage(); await page.setViewport({ width: 1100, height: 620 });
const errs = []; page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 300))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
await page.goto('file://' + path.resolve('dist/index.html') + '#globe');
await new Promise((r) => setTimeout(r, 3000));
for (const spec of specs) {
  const [name, year, frac] = spec.split('|');
  const info = await page.evaluate((name, year, frac) => {
    const E = __ew; if (E.cur && document.getElementById('gl-arch').classList.contains('hide')) E.startGlobe();
    const s = E.ARCHIVE.find((x) => x.name === name && x.year === +year); if (!s) return { err: 'not found' };
    E.gui.select(s, null, false);
    if (frac !== 'peak') { const sl = document.getElementById('gl-slide'); sl.value = Math.round(+frac * 1000); sl.dispatchEvent(new Event('input')); }
    const go = document.getElementById('gl-go'), msg = document.querySelector('#gl-pt p').textContent;
    const r = { id: s.id, t: new Date(E.gui.pt.t).toISOString().slice(0, 16), kt: Math.round(E.gui.pt.v), ok: !go.disabled, msg };
    if (!go.disabled) go.click();
    return r;
  }, name, year, frac);
  await page.screenshot({ path: `${outDir}/glb_${name}.png` });
  console.log(name, year, JSON.stringify(info));
  if (!info.ok) continue;
  await new Promise((r) => setTimeout(r, 3500));
  await page.evaluate(() => { __ew.startStorm(); __ew.dbg.fixedDt = 0.25; __ew.setPaused(true); __ew.LT.on = false; });
  await new Promise((r) => setTimeout(r, 12000));
  const st = await page.evaluate(() => { const E = __ew, s = E.st, c = E.center, b = E.boat; return { mode: E.cur.name, cat: s.cat, vmax: Math.round(s.vmaxKt), eyeR: +(s.eyeR / 1e3).toFixed(1), src: s.eyeSrc, distNm: +(Math.hypot(b.x - c.x, b.z - c.z) / 1852).toFixed(1), sat: E.sky.u.uUseSat.value, hud: document.querySelector('#hud .hd').textContent }; });
  await page.screenshot({ path: `${outDir}/sea_${name}.png` });
  console.log('   storm', JSON.stringify(st));
}
console.log('errors:', errs.slice(0, 8));
await browser.close();
