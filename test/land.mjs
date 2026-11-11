// Launch-point land check at known landfall times.
import puppeteer from 'puppeteer-core'; import path from 'path';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
const p = await b.newPage(); await p.goto('file://' + path.resolve('dist/index.html') + '#globe'); await new Promise((r) => setTimeout(r, 3000));
console.log(await p.evaluate(() => {
  const E = __ew, out = [];
  for (const [n, y, iso] of [['Ian', 2022, '2022-09-29T00:00Z'], ['Ian', 2022, '2022-09-28T18:00Z'], ['Katrina', 2005, '2005-08-29T18:00Z'], ['Katrina', 2005, '2005-08-29T11:00Z'], ['Harvey', 2017, '2017-08-27T12:00Z'], ['Otis', 2023, '2023-10-25T06:45Z']]) {
    const s = E.ARCHIVE.find((x) => x.name === n && x.year === y); E.gui.select(s, null, false);
    const t = Date.parse(iso), sl = document.getElementById('gl-slide'), t0 = s.t[0], tt = (x) => Date.UTC(+x.slice(0,4), +x.slice(4,6)-1, +x.slice(6,8), +x.slice(8,10), +x.slice(10,12));
    sl.value = Math.round((t - tt(s.t[0])) / (tt(s.t[s.t.length-1]) - tt(s.t[0])) * 1000); sl.dispatchEvent(new Event('input'));
    out.push(`${n} ${iso} water@centre=${E.globe.isWater(E.gui.pt.lat, E.gui.pt.lon)} launch=${!document.getElementById('gl-go').disabled} :: ${document.querySelector('#gl-pt p').textContent}`);
  }
  return out.join('\n');
}));
await b.close();
