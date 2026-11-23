// Runs the browser test suites and prints a summary.
//
//   npm test                   app tests against a local copy (no internet needed except Lichess-free data)
//   npm test -- --family       also the family-game tests (they use the real Firebase database, test games only)
//   npm test -- --live         run against the published site (also checks the offline cache, which needs https)
//   npm test -- review themes  run only the named suites
//
// Each suite prints PASS/FAIL lines and ends with "ALL PASSED" or "N FAILED". Screenshots go to tests/output/.
const { spawn, spawnSync } = require('child_process');
const path = require('path'), fs = require('fs');

const LIVE_URL = 'https://devvenom-byte.github.io/timber-chess/';
const PORT = 8766;
const APP = ['features', 'sec', 'book', 'famous', 'review', 'themes', 'endgames', 'clocks', 'course', 'promo', 'board3d'];
const FAMILY = ['join', 'stuck', 'offline', 'rules']; // talk to the real Firebase database
const EXTRA_ARGS = { board3d: ['390', '844', 'phone'] };

const args = process.argv.slice(2);
const live = args.includes('--live'), family = args.includes('--family');
const named = args.filter(a => !a.startsWith('--'));
const suites = named.length ? named : [...APP, ...(family ? FAMILY : [])];
for (const n of suites) if (!fs.existsSync(path.join(__dirname, n + '.test.js'))) { console.error('Unknown suite: ' + n); process.exit(2); }
fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });

async function main() {
  let server = null, url = LIVE_URL;
  if (!live) {
    url = `http://127.0.0.1:${PORT}/`;
    server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), path.join(__dirname, '..'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((ok, fail) => { server.stdout.once('data', ok); server.once('exit', () => fail(new Error('test server did not start (port ' + PORT + ' busy?)'))); });
  }
  console.log(`Testing ${url}\n`);
  const results = [];
  for (const n of suites) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(__dirname, n + '.test.js'), url, ...(EXTRA_ARGS[n] || [])], { encoding: 'utf8', timeout: 8 * 60 * 1000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const ok = r.status === 0 && /ALL PASSED/.test(out);
    results.push([n, ok, ((Date.now() - t0) / 1000).toFixed(0)]);
    console.log(`${ok ? '✔' : '✘'} ${n} (${results.at(-1)[2]} s)`);
    if (!ok) console.log(out.split('\n').filter(l => /FAIL|CRASH|Error/.test(l)).map(l => '    ' + l).join('\n') || '    ' + out.slice(-800));
  }
  if (server) server.kill();
  const bad = results.filter(r => !r[1]).length;
  console.log(`\n${results.length - bad} of ${results.length} suites passed`);
  process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
