// intro frames at chosen times with a fixed step (software GL is slow): rise and reveal
import puppeteer from 'puppeteer-core'; import path from 'path';
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--allow-file-access-from-files', '--window-size=960,540'] });
const page = await browser.newPage(); await page.setViewport({ width: 960, height: 540 });
const errs = []; page.on('pageerror', (e) => errs.push(e.message.slice(0, 300)));
await page.goto('file://' + path.resolve('dist/index.html'));
await new Promise((r) => setTimeout(r, 4000));
const snap = async (name) => { await page.screenshot({ path: `${out}/intro_${name}.png` }); console.log(name, JSON.stringify(await page.evaluate(() => ({ mode: __ew.mode, alt: Math.round(__ew.dv.alt), title: document.getElementById('title').className, year: document.getElementById('year').textContent })))); };
// jump the shore to its end, then step the rise
await page.evaluate(() => { __ew.dbg.fixedDt = 0.12; __ew.setIntro(10.5); });
for (const [name, wait] of [['rise_a', 9000], ['rise_b', 14000], ['rise_c', 14000], ['rise_d', 14000]]) { await new Promise((r) => setTimeout(r, wait)); await snap(name); }
for (const [name, wait] of [['rev_a', 3000], ['rev_b', 6000], ['rev_c', 8000], ['rev_d', 8000], ['rev_e', 12000]]) { await new Promise((r) => setTimeout(r, wait)); await snap(name); }
console.log('errors', errs);
await browser.close();
