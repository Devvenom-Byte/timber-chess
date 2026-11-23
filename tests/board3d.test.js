const path = require('path');
const { chromium } = require('playwright-core');
const { EDGE } = require('./browser');
const URL = process.argv[2] || 'http://127.0.0.1:8765/';
const W = +(process.argv[3] || 390), H = +(process.argv[4] || 844), TAG = process.argv[5] || 'phone';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails++; };
async function waitFor(fn, ms = 20000, step = 100) { const s = Date.now(); while (Date.now() - s < ms) { try { if (await fn()) return Date.now() - s; } catch (e) { } await sleep(step); } return -1; }
(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { window.__tc3dSoftware = true; });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle' }); await sleep(500);
  const tc = (fn, a) => page.evaluate(fn, a);
  // start a local 2-player game so we control both sides
  await page.click('[data-act="new"]'); await sleep(300); await page.click('#ngKind [data-k="local"]'); await sleep(150); await page.click('#ngGo'); await sleep(400);
  // switch on
  await page.click('#btnSettings'); await sleep(300);
  check(await page.locator('[data-set="board3d"]').count() === 1, 'Settings has the 3D board switch');
  await page.click('[data-set="board3d"]'); await page.click('#sheet .xbtn');
  const t = await waitFor(() => tc(() => !!window.__tc.B3));
  check(t >= 0, `3D board turned on (${t} ms)`);
  check(await page.locator('#board3d canvas').count() === 1 && !(await page.locator('#frame').isVisible()), '3D canvas shown, flat board hidden');
  await sleep(1500);
  await page.screenshot({ path: path.join(__dirname, 'output', `3d-${TAG}-start.png`) });
  const sqXY = async (sq, h) => tc(([sq, h]) => { const p = window.__tc.B3.squareToScreen(sq, h), r = document.querySelector('#board3d canvas').getBoundingClientRect(); return [r.left + p.x, r.top + p.y]; }, [sq, h || 0]);
  const hasPiece = n => tc(n => { const t = document.querySelector('#tabs .on').dataset.tab; const e = window.__tc.sessions[t].eng; return !!e.board()[(n.charCodeAt(0) - 97) + (n.charCodeAt(1) - 49) * 8]; }, n);
  const N = n => (n.charCodeAt(0) - 97) + (n.charCodeAt(1) - 49) * 8;
  const aim = n => tc(sq => { const B = window.__tc.B3, r = document.querySelector('#board3d canvas').getBoundingClientRect(); for (const h of [0, 0.3, 0.6, 0.9, 1.2, 1.5]) for (const dx of [0, -6, 6, -12, 12]) { const p = B.squareToScreen(sq, h), x = r.left + p.x + dx, y = r.top + p.y; if (B.pickAt(x, y) === sq) return [x, y]; } const p = B.squareToScreen(sq, 0); return [r.left + p.x, r.top + p.y]; }, N(n));
  const tap = async n => { const [x, y] = await aim(n); await page.mouse.click(x, y); await sleep(250); };
  const moves = () => tc(() => window.__tc.sessions.play.game.moves.join(' '));
  // tap-tap
  await tap('e2'); await tap('e4'); await sleep(600);
  check((await moves()) === 'e2e4', 'tap-tap move e2-e4 in 3D: ' + await moves());
  await tap('e7'); await tap('e5'); await sleep(600);
  // drag
  const drag = async (a, z) => { const [x0, y0] = await aim(a), [x1, y1] = await sqXY(N(z), 0.25); await page.mouse.move(x0, y0); await page.mouse.down(); for (let i = 1; i <= 12; i++) { await page.mouse.move(x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * i / 12); await sleep(20); } await sleep(80); await page.mouse.up(); await sleep(700); };
  await drag('g1', 'f3');
  check((await moves()) === 'e2e4 e7e5 g1f3', 'drag move Ng1-f3 in 3D: ' + await moves());
  // illegal drop flies back
  await drag('d8', 'd4');
  check((await moves()) === 'e2e4 e7e5 g1f3', 'illegal drop (queen through own pawn) is refused');
  await page.screenshot({ path: path.join(__dirname, 'output', `3d-${TAG}-mid.png`) });
  // capture + material: Nf3xe5
  await tap('b8'); await tap('c6'); await tap('f3'); await tap('e5'); await sleep(700);
  check((await moves()).endsWith('f3e5'), 'capture Nxe5 works');
  // camera view button
  await page.click('#board3d .b3view'); await sleep(900);
  const v = await page.locator('#board3d .b3view').innerText();
  check(/From above/.test(v), 'camera button changes the view: ' + v);
  await page.screenshot({ path: path.join(__dirname, 'output', `3d-${TAG}-top.png`) });
  await page.click('#board3d .b3view'); await sleep(300); await page.click('#board3d .b3view'); await sleep(900);
  // flip
  await page.click('[data-act="flip"]'); await sleep(900);
  check(await tc(() => window.__tc.sessions.play.orientation === 'b'), 'flip works in 3D');
  await page.screenshot({ path: path.join(__dirname, 'output', `3d-${TAG}-flipped.png`) });
  await page.click('[data-act="flip"]'); await sleep(500);
  // undo
  await page.click('[data-act="undo"]'); await sleep(700);
  check(!(await moves()).endsWith('f3e5'), 'undo works in 3D');
  // promotion via the pawn lesson (Learn tab)
  await page.click('#tabs [data-tab="learn"]'); await sleep(500);
  await tc(() => { const L = window.__tc.sessions.learn; });
  await page.click('#panel [data-act="lsnext"]'); await sleep(700);
  await tap('e2'); await tap('e4'); await sleep(2400);
  await tap('e4'); await tap('d5'); await sleep(2400);
  await tap('a7'); await tap('a8'); await sleep(500);
  const promoVis = await page.locator('#board3d #promo').isVisible().catch(() => false);
  check(promoVis, 'promotion picker appears over the 3D board');
  await page.screenshot({ path: path.join(__dirname, 'output', `3d-${TAG}-promo.png`) });
  if (promoVis) { await page.click('#promo [data-p="q"]'); await sleep(900); }
  check(await tc(() => (window.__tc.sessions.learn.game.moves || []).slice(-1)[0] === 'a7a8q'), 'promoted to a queen');
  // openings tab hint shows
  await page.click('#tabs [data-tab="openings"]'); await sleep(500); if (await page.locator('#scrim.on').count()) { await page.click('#sheet .xbtn'); await sleep(300); }
  // switch off
  await page.click('#btnSettings'); await sleep(300); await page.click('[data-set="board3d"]'); await page.click('#sheet .xbtn'); await sleep(600);
  check(await tc(() => !window.__tc.B3) && await page.locator('#frame').isVisible() && await page.locator('#board3d canvas').count() === 0, 'switching off returns to the flat board');
  // restart with 3D on
  await page.click('#btnSettings'); await sleep(300); await page.click('[data-set="board3d"]'); await page.click('#sheet .xbtn');
  await waitFor(() => tc(() => !!window.__tc.B3));
  await page.reload({ waitUntil: 'networkidle' });
  check(await waitFor(() => tc(() => !!window.__tc.B3)) >= 0, '3D comes back on after reopening the app');
  check(!errs.length, errs.length ? 'errors: ' + errs.slice(0, 6).join(' | ') : 'no errors');
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  await b.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
