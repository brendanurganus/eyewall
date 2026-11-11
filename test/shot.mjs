// usage: node test/shot.mjs out.png [w h] [waitMs] [js-to-eval-before-wait]
import puppeteer from 'puppeteer-core';
import path from 'path';
const [out = 'shot.png', w = '960', h = '540', wait = '4000', pre = '', post = ''] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--allow-file-access-from-files', `--window-size=${w},${h}`] });
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (!/GPU stall|Automatic fallback/.test(t)) logs.push(m.type() + ': ' + t.slice(0, 1500)); });
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message.slice(0, 1500)));
await page.goto('file://' + path.resolve('dist/index.html') + (process.env.HASH || ''));
if (pre) { await new Promise((r) => setTimeout(r, 1500)); await page.evaluate(pre); }
await new Promise((r) => setTimeout(r, +wait));
if (post) console.log('EVAL:', JSON.stringify(await page.evaluate(post)));
await page.screenshot({ path: out });
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
