// Live storms: serve dist over http (fetch needs it), open the globe with the demo replay (#livedemo) or the
// plain live feed, screenshot the panel and globe, then dive into the first live storm at its latest fix.
// usage: node test/live.mjs outDir [demo|live] [dive]
import puppeteer from 'puppeteer-core';
import http from 'http'; import fs from 'fs'; import path from 'path';
const [outDir, which = 'demo', dive] = process.argv.slice(2);
const root = path.resolve('dist');
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': f.endsWith('.json') ? 'application/json' : f.endsWith('.jpg') ? 'image/jpeg' : 'text/html' }); fs.createReadStream(f).pipe(r); }).listen(8765);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--window-size=1100,620'] });
const page = await browser.newPage(); await page.setViewport({ width: 1100, height: 620 });
const errs = []; page.on('response', (r) => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url()); }); page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 300))); page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 300)); });
await page.goto('http://localhost:8765/index.html' + (which === 'demo' ? '#livedemo' : '#globe'));
await new Promise((r) => setTimeout(r, 6000));
const info = await page.evaluate(() => ({ live: document.getElementById('gl-live').innerText, info: document.getElementById('gl-info').innerText.slice(0, 900), sel: __ew.gui.sel?.id }));
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: `${outDir}/live_${which}_globe.png` });
const [fl, fo, fd] = (process.env.FLY || '26,-88,1.6').split(',').map(Number); await page.evaluate((a, b, c) => __ew.globe.flyTo(a, b, c, 0.01), fl, fo, fd); await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: `${outDir}/live_${which}_close.png` });
if (dive) {
  const ok = await page.evaluate(() => { const g = document.getElementById('gl-go'); if (!g || g.disabled) return document.querySelector('#gl-pt')?.innerText; g.click(); return 'launched'; });
  console.log('dive:', ok);
  await new Promise((r) => setTimeout(r, 3500));
  await page.evaluate(() => { __ew.startStorm(); __ew.dbg.fixedDt = 0.25; __ew.LT.on = false; });
  await new Promise((r) => setTimeout(r, 12000));
  const st = await page.evaluate(() => { const E = __ew, s = E.st; return { cur: E.cur.id, live: !!E.cur.live, t: new Date(E.clock.t).toISOString(), vmax: Math.round(s.vmaxKt), cat: s.cat, time: document.getElementById('time').innerText.replace(/\s+/g, ' '), hud: document.querySelector('#hud .hd')?.textContent }; });
  console.log('storm', JSON.stringify(st));
  await page.screenshot({ path: `${outDir}/live_${which}_sea.png` });
  await page.evaluate(() => __ew.setSpeed(3)); await new Promise((r) => setTimeout(r, 8000));
  console.log('after run:', await page.evaluate(() => [new Date(__ew.clock.t).toISOString(), document.getElementById('time').innerText.replace(/\s+/g, ' ')]));
}
console.log('errors:', errs.filter((e) => !/GPU stall|ReadPixels/.test(e)).slice(0, 8));
await browser.close(); srv.close();
