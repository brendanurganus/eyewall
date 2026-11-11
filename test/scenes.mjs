// Renders storm-scene stills at chosen storm times and spots, and reports exposure/light levels.
// usage: node test/scenes.mjs outDir "label|ISO time|spot(1-4)|wait s" ...
import puppeteer from 'puppeteer-core';
import path from 'path';
const [outDir, ...specs] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--allow-file-access-from-files', `--window-size=${process.env.W||800},${process.env.H||450}`] });
const page = await browser.newPage(); await page.setViewport({ width: +(process.env.W||800), height: +(process.env.H||450) });
const logs = []; page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message.slice(0, 500)));
page.on('console', (m) => { if (m.type() === 'error') logs.push('console: ' + m.text().slice(0, 300)); });
await page.goto('file://' + path.resolve('dist/index.html') + '#storm');
await new Promise((r) => setTimeout(r, 2000));
for (const spec of specs) {
  const [label, iso, spot, wait = '12', extra = ''] = spec.split('|');
  await page.evaluate((iso, spot, extra) => { const E = __ew; E.setPaused(true); E.clock.t = Date.parse(iso); E.dbg.fixedDt = 0.25; E.SPOTS['Digit' + spot](); E.LT.on = false; if (extra) eval(extra); }, iso, spot, extra);
  await new Promise((r) => setTimeout(r, +wait * 1000));
  const info = await page.evaluate(() => {
    const E = __ew, r = E.sim.r, b = new Uint16Array(4), rt = E.post.exp[E.post.ei];
    r.readRenderTargetPixels(rt, 0, 0, 1, 1, b); const f = (v) => E.THREE.DataUtils.fromHalfFloat(v);
    const e = f(b[0]), sc = f(b[1]), key = E.env.key;
    return { e: +e.toPrecision(3), scot: +sc.toFixed(2), lumIfUndimmed: +(key / e).toPrecision(3), La: +(key / e / E.post.pre).toPrecision(3), pre: +E.post.pre.toPrecision(3), lux: +E.sky$.lux.toPrecision(3), moonKey: E.LV.moonKey,
      sunEl: +(E.sky$.sun.el * 57.3).toFixed(1), moonEl: +(E.sky$.moon.el * 57.3).toFixed(1), lit: +E.sky$.moon.lit.toFixed(2), cat: E.st.cat, sat: E.sky.u.uUseSat.value };
  });
  await page.screenshot({ path: `${outDir}/${label}.png` });
  console.log(label, JSON.stringify(info));
}
console.log(logs.slice(0, 20).join('\n'));
await browser.close();
