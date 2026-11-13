// Phone emulation: globe in portrait, storm scene in landscape (touch, small screen, DPR 3).
// usage: node test/phone.mjs outDir
import puppeteer from 'puppeteer-core'; import path from 'path';
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--allow-file-access-from-files'] });
const errs = [];
for (const [name, w, h, hash, wait] of [['globe', 390, 844, '#globe', 9000], ['storm', 844, 390, '#storm', 30000]]) {
  const page = await browser.newPage();
  await page.emulate({ viewport: { width: w, height: h, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: w > h }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  page.on('pageerror', (e) => errs.push(name + ': ' + e.message.slice(0, 200)));
  await page.goto('file://' + path.resolve('dist/index.html') + hash);
  await new Promise((r) => setTimeout(r, wait));
  const st = await page.evaluate(() => ({ phone: document.body.classList.contains('phone'), mode: __ew.mode, stick: !document.getElementById('stick').classList.contains('hide'), fps: document.getElementById('fps').textContent }));
  console.log(name, JSON.stringify(st));
  await page.screenshot({ path: `${out}/phone_${name}.png` });
  if (name === 'globe') { await page.evaluate(() => document.querySelector('#gl-info .close').click()); await new Promise((r) => setTimeout(r, 1500)); await page.evaluate(() => document.querySelector('#gl-arch .gh').click()); await new Promise((r) => setTimeout(r, 2500)); await page.screenshot({ path: `${out}/phone_globe_list.png` }); }
  if (name === 'storm') { // push the stick forward and to the right for a while
    const box = await page.evaluate(() => { const r = document.getElementById('stick').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await page.touchscreen.touchStart(box[0], box[1]); await page.touchscreen.touchMove(box[0] + 30, box[1] - 50);
    await new Promise((r) => setTimeout(r, 8000));
    console.log('stick', JSON.stringify(await page.evaluate(() => ({ stick: __ew.input.stick, thr: +__ew.input.throttle.toFixed(2), rud: +__ew.input.rudder.toFixed(2) }))));
    await page.touchscreen.touchEnd();
    await page.screenshot({ path: `${out}/phone_storm2.png` });
  }
  await page.close();
}
console.log('errors', errs);
await browser.close();
