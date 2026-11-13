import puppeteer from 'puppeteer-core'; import path from 'path';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--allow-file-access-from-files', '--window-size=960,540'] });
const page = await browser.newPage(); await page.setViewport({ width: 960, height: 540 });
await page.goto('file://' + path.resolve('dist/index.html'));
await new Promise((r) => setTimeout(r, 3000));
await page.evaluate(() => { __ew.dbg.fixedDt = 0.1; __ew.setIntro(10.55); });
await new Promise((r) => setTimeout(r, 5000));
for (const q of [1.6, 2.2, 2.8, 3.4, 4.6, 5.4]) {
  await page.evaluate((q) => { __ew.dbg.diveFreeze = true; __ew.setDive(q); document.getElementById('title').className = ''; }, q);
  await new Promise((r) => setTimeout(r, 7000));
  await page.screenshot({ path: `/home/claude/shots/rq_${q}.png` }); console.log(q, await page.evaluate(() => Math.round(__ew.dv.alt)));
}
await browser.close();
