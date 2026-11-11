// Runs storm time forward at a chosen speed and logs how the storm, sea and light evolve.
// usage: node test/timerun.mjs <startISO> <speedIndex 0-3> <fixedDt> <seconds> [spot]
import puppeteer from 'puppeteer-core';
import path from 'path';
const [start, si = '3', fdt = '0.5', secs = '60', spot = '1'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--allow-file-access-from-files', '--window-size=480,270'] });
const page = await browser.newPage(); await page.setViewport({ width: 480, height: 270 });
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
await page.evaluateOnNewDocument((f) => { window.FOLLOW_ON = f; }, !!process.env.FOLLOW);
await page.goto('file://' + path.resolve('dist/index.html') + '#low');
await new Promise((r) => setTimeout(r, 2500));
await page.evaluate((start, si, fdt, spot) => { const E = __ew; E.startStorm(); E.clock.t = Date.parse(start); E.SPOTS['Digit' + spot](); E.dbg.fixedDt = +fdt; E.setSpeed(+si); if (window.FOLLOW_ON) E.clock.follow = true; window.__log = []; let n = 0;
  const orig = E.sim.setScale.bind(E.sim); E.sim.setScale = (L) => { window.__log.push('RESCALE L0=' + L[0].toFixed(0) + ' at ' + new Date(E.clock.t).toISOString().slice(5, 16)); return orig(L); };
  setInterval(() => { const s = E.st, c = E.center, b = E.boat, d = Math.hypot(b.x - c.x, b.z - c.z); window.__log.push(`${new Date(E.clock.t).toISOString().slice(5, 16)} cat ${s.cat} vmax ${s.vmaxKt.toFixed(0)}kt lat ${s.lat.toFixed(2)} lon ${s.lon.toFixed(2)} eyeR ${(s.eyeR / 1e3).toFixed(1)}km (${s.eyeSrc}) boat-centre ${(d / 1852).toFixed(0)}nm L0 ${E.sim.L[0].toFixed(0)} lux ${E.sky$.lux.toPrecision(2)} moonKey ${E.LV.moonKey} paused ${E.clock.paused}`); }, 4000); }, start, si, fdt, spot);
await new Promise((r) => setTimeout(r, +secs * 1000));
console.log((await page.evaluate(() => window.__log)).join('\n'));
console.log('errors:', errs.slice(0, 10));
await browser.close();
