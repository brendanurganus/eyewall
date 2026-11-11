import { build } from 'esbuild';
import fs from 'fs';
const r = await build({ entryPoints: ['src/main.js'], bundle: true, minify: !process.argv.includes('--dev'), format: 'iife', write: false, loader: { '.jpg': 'dataurl', '.png': 'dataurl' }, target: 'es2020', legalComments: 'none' });
const js = r.outputFiles[0].text.replace(/<\/script>/g, '<\\/script>');
const html = fs.readFileSync('src/index.html', 'utf8').replace('/*__JS__*/', () => js);
fs.mkdirSync('dist', { recursive: true }); fs.writeFileSync('dist/index.html', html);
console.log('built', (html.length / 1024).toFixed(0), 'KB');
