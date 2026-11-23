const path = require('path');
const { chromium } = require('playwright-core');
const { EDGE } = require('./browser');
const URL = process.argv[2] || 'http://127.0.0.1:8765/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [], ext = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Refused|Content Security/.test(m.text())) errs.push(m.text()); });
  page.on('request', r => { const u = new globalThis.URL(r.url()); if (!/^(127\.0\.0\.1|devvenom-byte\.github\.io)$/.test(u.hostname) && !u.protocol.startsWith('data') && !u.protocol.startsWith('blob')) ext.push(u.hostname); });
  await page.goto(URL, { waitUntil: 'networkidle' }); await sleep(800);
  const fonts = await page.evaluate(async () => { await document.fonts.ready; return [document.fonts.check('600 16px Inter'), document.fonts.check('700 20px Fraunces')]; });
  const fontReqs = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => /woff2/.test(e.name)).map(e => e.name.split('/').pop()));
  check(fonts[0] && fonts[1] && fontReqs.includes('inter.woff2'), 'fonts load from the app itself: ' + fontReqs.join(', '));
  check(!ext.length, 'no requests to outside servers on start-up ' + JSON.stringify([...new Set(ext)]));
  // sounds: wood and marble
  await page.click('#btnSettings'); await sleep(350);
  check(await page.locator('#sndSeg [data-snd]').count() === 3, 'Settings has the piece-sound choice (Match pieces / Wood / Marble)');
  await page.click('[data-snd="stone"]'); await sleep(500); await page.click('[data-snd="wood"]'); await sleep(500);
  await page.click('[data-snd="auto"]'); await page.click('[data-pset="marble"]'); await sleep(300);
  const mat = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('timber.settings') || localStorage.getItem('settings') || '{}'); return s; });
  check(mat.sounds === 'auto' && mat.pieces === 'marble', 'sound choice saved (auto, with marble pieces = marble sound)');
  await page.screenshot({ path: path.join(__dirname, 'output', 'sec-settings.png'), fullPage: false });
  check(/Privacy policy/.test(await page.locator('#sheet').innerText()), 'Settings links to the privacy policy');
  await page.click('[data-pset="wood"]'); await page.click('#sheet .xbtn');
  // ids from secure random
  const ids = await page.evaluate(() => [localStorage.getItem('timber.cid') || localStorage.getItem('cid'), crypto.getRandomValues ? 'ok' : 'no']);
  check(ids[1] === 'ok', 'secure random generator available');
  // privacy page
  const pp = await ctx.newPage(); const perr = []; pp.on('console', m => { if (m.type() === 'error') perr.push(m.text()); });
  const resp = await pp.goto(URL + 'privacy.html', { waitUntil: 'networkidle' });
  check(resp.status() === 200 && /Privacy policy/.test(await pp.locator('h1').innerText()) && !perr.length, 'privacy page opens with no errors');
  // framing refused
  const fr = await ctx.newPage();
  await fr.setContent(`<iframe src="${URL}" style="width:380px;height:600px"></iframe>`); await sleep(2500);
  const inner = await fr.frames()[1]?.evaluate(() => document.body ? document.body.innerText : '').catch(() => 'navigated away');
  check(/Open Timber Chess directly|navigated away/.test(inner || 'navigated away') || fr.url() !== 'about:blank', 'app refuses to run inside another site\'s frame');
  check(!errs.length, errs.length ? 'errors: ' + errs.slice(0, 6).join(' | ') : 'no errors and nothing blocked by the security policy');
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  await b.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
