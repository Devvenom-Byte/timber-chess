// Firebase family games: chess-by-post, offline moves, true tap-to-screen latency.  node offline.js <url>
const path = require('path');
const { chromium } = require('playwright-core');
const { EDGE } = require('./browser');
const URL = process.argv[2] || 'http://127.0.0.1:8765/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails++; };
async function waitFor(fn, ms = 30000, step = 20) { const s = Date.now(); while (Date.now() - s < ms) { try { if (await fn()) return Date.now() - s; } catch (e) { } await sleep(step); } return -1; }

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const problems = [];
  const ctxH = await browser.newContext({ viewport: { width: 380, height: 840 } });
  const ctxG = await browser.newContext({ viewport: { width: 380, height: 840 } });
  const watch = (p, l) => { p.on('pageerror', e => problems.push(`[${l}] ${e.message}`)); p.on('console', m => { if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) problems.push(`[${l}] ${m.text().slice(0, 140)}`); }); };
  const panel = async p => (await p.locator('#panel').innerText()).replace(/\s+/g, ' ');
  const moves = async p => { const l = p.locator('#mlist'); return (await l.count()) ? (await l.innerText()).replace(/\s+/g, ' ').trim() : ''; };
  const nMoves = async p => (await moves(p)).split(' ').filter(x => /[a-h][1-8]|O-O/.test(x)).length;
  const sqC = async (p, sq, o) => { const r = await p.locator('#board').boundingBox(); const S = r.width / 8; const f = sq.charCodeAt(0) - 97, rk = +sq[1] - 1; const c = o === 'w' ? f : 7 - f, w = o === 'w' ? 7 - rk : rk; return [r.x + (c + .5) * S, r.y + (w + .5) * S]; };
  const tapNoWait = async (p, sq, o) => { const [x, y] = await sqC(p, sq, o); await p.mouse.click(x, y); };
  const move = async (p, u, o) => { await tapNoWait(p, u.slice(0, 2), o); await sleep(150); await tapNoWait(p, u.slice(2, 4), o); };

  // 1. Host (Mum) creates a game playing Black, then closes the app completely.
  let host = await ctxH.newPage(); watch(host, 'host');
  await host.goto(URL, { waitUntil: 'load' }); await host.click('#tabs [data-tab="family"]');
  await waitFor(async () => host.locator('#nameIn').isVisible()); await host.fill('#nameIn', 'Mum'); await host.click('#nameGo'); await sleep(300);
  await host.click('#lbNew'); await sleep(300); await host.click('#fc [data-c="b"]');
  const gid = ((await host.locator('#sheet').innerText()).match(/\?g=([a-z0-9]+)/) || [])[1];
  check(await waitFor(async () => /🟢 Ready/.test(await host.locator('#sheet').innerText()), 15000) >= 0, 'invite ready (game saved online)');
  await host.close();
  console.log('      Mum closed the app after sending the invite');

  // 2. Friend joins with nobody else online and makes the first move.
  const guest = await ctxG.newPage(); watch(guest, 'guest');
  let t0 = Date.now();
  await guest.goto(URL + '?g=' + gid, { waitUntil: 'load' });
  await waitFor(async () => guest.locator('#nameIn').isVisible(), 15000); await guest.fill('#nameIn', 'Alex'); await guest.click('#nameGo');
  const j = await waitFor(async () => /Your move/.test(await panel(guest)), 20000);
  check(j >= 0, `friend joined while Mum's app was closed (${Date.now() - t0} ms from opening the link)`);
  await move(guest, 'e2e4', 'w'); await sleep(800);
  check((await moves(guest)).includes('e4'), 'friend played e4 with Mum offline');

  // 3. Mum reopens the app later: sees friend joined + their move, replies; friend sees it live.
  host = await ctxH.newPage(); watch(host, 'host2');
  t0 = Date.now();
  await host.goto(URL, { waitUntil: 'load' });
  if (!(await host.locator('#tabs [data-tab="family"].on').count())) await host.click('#tabs [data-tab="family"]');
  const caught = await waitFor(async () => (await moves(host)).includes('e4') && /Your move/.test(await panel(host)), 20000);
  check(caught >= 0, `Mum reopened and caught up with Alex's move (${Date.now() - t0} ms after opening the app)`);

  // true latency: click on the destination square -> move shown on the other screen
  const lat = [];
  const timed = async (from, to, fu, fo, n) => { await tapNoWait(from, fu.slice(0, 2), fo); await sleep(150); const t = Date.now(); await tapNoWait(from, fu.slice(2, 4), fo); const w = await waitFor(async () => (await nMoves(to)) >= n, 15000, 10); lat.push(w < 0 ? -1 : Date.now() - t); };
  await timed(host, guest, 'e7e5', 'b', 2);
  await timed(guest, host, 'g1f3', 'w', 3);
  await timed(host, guest, 'b8c6', 'b', 4);
  await timed(guest, host, 'f1c4', 'w', 5);
  await timed(host, guest, 'g8f6', 'b', 6);
  console.log('      tap-to-other-screen times (ms):', lat.join(', '));
  check(lat.every(x => x >= 0 && x < 1500), 'every move reached the other screen in under 1.5 s');

  // 4. Friend loses internet, moves anyway; move is delivered when back online.
  await ctxG.setOffline(true);
  await move(guest, 'd2d3', 'w'); await sleep(1500);
  check(!(await moves(host)).includes('d3'), 'while offline the move has not arrived (as expected)');
  await ctxG.setOffline(false);
  t0 = Date.now();
  const back = await waitFor(async () => (await moves(host)).includes('d3'), 20000);
  check(back >= 0, `move made offline was delivered ${Date.now() - t0} ms after the internet came back`);

  // 5. Online dots
  await sleep(500);
  const dotH = await host.locator('#stripTop .online-dot.on').count(), dotG = await guest.locator('#stripTop .online-dot.on').count();
  check(dotH > 0 && dotG > 0, `both see each other as online (green dot): Mum ${dotH ? 'yes' : 'no'}, Alex ${dotG ? 'yes' : 'no'}`);

  console.log('      final position (Mum):', await moves(host));
  check(problems.length === 0, problems.length ? 'errors:\n  ' + problems.slice(0, 8).join('\n  ') : 'no errors');
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  await browser.close();
})().catch(e => { console.error('TEST CRASHED:', e.message); process.exit(1); });
