// Build app.js and stamp a version on every asset reference, so browsers
// never mix a cached old app.js with new HTML (and open tabs can tell a
// new version is out).
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const h = createHash('sha256');
for (const f of ['src/main.js', 'style.css', 'package-lock.json']) h.update(readFileSync(f));
const v = h.digest('hex').slice(0, 10);

await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'esm', target: 'es2020',
  outfile: 'app.js', define: { __VERSION__: JSON.stringify(v) }, logLevel: 'warning',
});
const html = readFileSync('index.html', 'utf8')
  .replace(/href="style\.css(\?v=[^"]*)?"/, `href="style.css?v=${v}"`)
  .replace(/src="app\.js(\?v=[^"]*)?"/, `src="app.js?v=${v}"`);
writeFileSync('index.html', html);
writeFileSync('version.json', JSON.stringify({ v }) + '\n');
console.log('built version', v);
