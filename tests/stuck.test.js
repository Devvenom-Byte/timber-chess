// Reproduces: (1) iPhone resigns while the Android app is closed -> Android game stuck,
// (2) with that stuck game, "New game & invite link" colour picker flashes back, (3) Remove button.
// node stuck.js <url>
const path = require('path');
const { chromium } = require('playwright-core');
const { EDGE } = require('./browser');
const URL = process.argv[2] || 'http://127.0.0.1:8765/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails++; };
async function waitFor(fn, ms = 30000, step = 100) { const s = Date.now(); while (Date.now() - s < ms) { try { if (await fn()) return Date.now() - s; } catch (e) { } await sleep(step); } return -1; }

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const problems = [];
  const ctxI = await browser.newContext({ viewport: { width: 380, height: 840 } });
  const ctxA = await browser.newContext({ viewport: { width: 380, height: 840 }, deviceScaleFactor: 2 });
  const watch = (p, l) => p.on('pageerror', e => problems.push(`[${l}] ${e.message}`));
  const panel = async p => (await p.locator('#panel').innerText()).replace(/\s+/g, ' ');
  const sqC = async (p, sq, o) => { const r = await p.locator('#board').boundingBox(); const S = r.width / 8; const f = sq.charCodeAt(0) - 97, rk = +sq[1] - 1; const c = o === 'w' ? f : 7 - f, w = o === 'w' ? 7 - rk : rk; return [r.x + (c + .5) * S, r.y + (w + .5) * S]; };
  const tap = async (p, sq, o) => { const [x, y] = await sqC(p, sq, o); await p.mouse.click(x, y); await sleep(200); };

  // iPhone hosts, Android joins by link
  const iph = await ctxI.newPage(); watch(iph, 'iphone');
  await iph.goto(URL, { waitUntil: 'load' }); await iph.click('#tabs [data-tab="family"]');
  await waitFor(async () => iph.locator('#nameIn').isVisible()); await iph.fill('#nameIn', 'iPhone'); await iph.click('#nameGo'); await sleep(300);
  await iph.click('#lbNew'); await sleep(300); await iph.click('#fc [data-c="w"]');
  const gid = ((await iph.locator('#sheet').innerText()).match(/\?g=([a-z0-9]+)/) || [])[1];
  await waitFor(async () => /🟢 Ready/.test(await iph.locator('#sheet').innerText()));
  await iph.click('#sheet .xbtn');
  let and = await ctxA.newPage(); watch(and, 'android');
  await and.goto(URL + '?g=' + gid, { waitUntil: 'load' });
  await waitFor(async () => and.locator('#nameIn').isVisible(), 15000); await and.fill('#nameIn', 'Android'); await and.click('#nameGo');
  await waitFor(async () => /Your move/.test(await panel(iph)));
  await tap(iph, 'e2', 'w'); await tap(iph, 'e4', 'w');
  check(await waitFor(async () => /Your move/.test(await panel(and))) >= 0, 'game running between iPhone and Android');

  // Android app gets closed in the background; iPhone resigns meanwhile and leaves
  await and.close();
  await sleep(14000);
  await iph.click('[data-act="resign"]'); await sleep(300); await iph.click('#cYes'); await sleep(800);
  await ctxI.close();

  // Android reopens the app later
  and = await ctxA.newPage(); watch(and, 'android2');
  await and.goto(URL, { waitUntil: 'load' }); await sleep(8000);
  if (!(await and.locator('#tabs [data-tab="family"].on').count())) await and.click('#tabs [data-tab="family"]');
  await sleep(500);
  const p1 = await panel(and);
  console.log(`INFO Android after reopening: ${/resigned/i.test(p1) ? 'sees resignation' : 'STUCK in the old game'} -> "${p1.slice(0, 90)}"`);

  // try to start a new game: does the colour picker survive?
  if (await and.locator('#sheet.on').count()) await and.click('#sheet .xbtn').catch(() => { });
  await sleep(300);
  await and.click('[data-act="lobby"]'); await sleep(500);
  await and.click('#lbNew'); await sleep(300);
  const start = Date.now(); let gone = -1;
  while (Date.now() - start < 12000) { if (!(await and.locator('#fc').isVisible())) { gone = Date.now() - start; break; } await sleep(100); }
  check(gone < 0, gone < 0 ? 'colour picker stays put for 12 s' : `colour picker FLASHED BACK to the lobby after ${gone} ms`);

  // Remove button for the stuck game
  if (await and.locator('#fcBack').isVisible()) { await and.click('#fcBack'); await sleep(300); }
  const rm = and.locator(`[data-forget="${gid}"]`);
  check(await rm.count() > 0, 'stuck game has a Remove button in "Your games"');
  if (await rm.count()) {
    await and.screenshot({ path: path.join(__dirname, 'output', 's2-lobby-remove.png') });
    await rm.click(); await sleep(300);
    await and.screenshot({ path: path.join(__dirname, 'output', 's3-confirm.png') });
    await and.click('#cYes'); await sleep(800);
    const saved = await and.evaluate(g => { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/peerGames/.test(k)) return localStorage.getItem(k).includes(g); } return false; }, gid);
    check(!saved, 'stuck game deleted from the phone');
    check(!/Connecting to the game/.test(await panel(and)), 'Family tab no longer stuck on the old game: ' + (await panel(and)).slice(0, 70));
    if (!(await and.locator('#lbNew').isVisible())) { if (await and.locator('#sheet.on').count()) await and.click('#sheet .xbtn'); await sleep(300); await and.click('[data-act="lobby"]'); await sleep(400); }
    await and.click('#lbNew'); await sleep(300); await and.click('#fc [data-c="w"]'); await sleep(600);
    check(/Your invite link/.test(await and.locator('#sheet').innerText()), 'new game & invite link created afterwards');
    await and.screenshot({ path: path.join(__dirname, 'output', 's4-new-invite.png') });
  }
  check(problems.length === 0, problems.length ? 'errors:\n  ' + problems.join('\n  ') : 'no page errors');
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  await browser.close();
})().catch(e => { console.error('TEST CRASHED:', e.message); process.exit(1); });
