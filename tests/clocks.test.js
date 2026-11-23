// Chess clocks in the Play tab: choices, first moves free, increments, undo (no time back), pause,
// other tabs, background, reload, running out (and nothing moves after), the draw rule, the computer.
const path = require('path');
const { chromium } = require('playwright-core');
const { EDGE } = require('./browser');
const URL = process.argv[2] || 'http://127.0.0.1:8766/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails++; };
async function waitFor(fn, ms = 15000, step = 100) { const s = Date.now(); while (Date.now() - s < ms) { try { if (await fn()) return Date.now() - s; } catch (e) { } await sleep(step); } return -1; }
(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle' }); await sleep(400);
  const tc = (fn, a) => page.evaluate(fn, a);
  const C = () => tc(() => { const s = window.__tc.sessions.play, c = s.clock; if (!c) return null; const left = side => c[side] - (c.run === side ? performance.now() - c.t0 : 0); return { w: left('w'), b: left('b'), run: c.run, paused: c.paused, flag: c.flag, n: s.game.moves.length, over: s.over }; });
  const shown = async () => (await page.locator('.strip .clock').allInnerTexts()).join(' | ');
  const tap = async n => { const o = await tc(() => window.__tc.sessions.play.orientation), box = await page.locator('#board').boundingBox(), SQ = box.width / 8;
    let f = n.charCodeAt(0) - 97, r = n.charCodeAt(1) - 49; if (o === 'b') { f = 7 - f; r = 7 - r; } await page.mouse.click(box.x + (f + .5) * SQ, box.y + (7 - r + .5) * SQ); await sleep(120); };
  const move = async u => { await tap(u.slice(0, 2)); await tap(u.slice(2, 4)); await sleep(250); };
  const newGame = async (kind, tcKey) => { await page.click('[data-act="new"]'); await sleep(300); await page.click(`#ngKind [data-k="${kind}"]`); await sleep(150);
    if (kind === 'cpu') { await page.click('#ngColor [data-c="w"]'); await sleep(100); } await page.click(`#ngTc [data-tc="${tcKey}"]`); await sleep(150); await page.click('#ngGo'); await sleep(500); };

  await page.click('[data-act="new"]'); await sleep(300);
  check(await page.locator('#ngTc [data-tc]').count() === 6 && /No clock/.test(await page.locator('#ngTc').innerText()), 'New game offers 6 clock choices, including No clock');
  await page.click('#sheet .xbtn'); await sleep(300);
  await newGame('local', '3+2');
  check(/3:00 \| 3:00/.test(await shown()), 'both clocks show 3:00: ' + await shown());
  await page.screenshot({ path: path.join(__dirname, 'output', 'clock-start.png') });
  // first moves are free
  await move('e2e4'); await sleep(800); let c = await C();
  check(c.run === null && c.w === 180000 && c.b === 180000, "White's first move is free");
  await move('e7e5'); await sleep(1000); c = await C();
  check(c.run === 'w' && c.b === 180000 && c.w < 179500, `Black's first move is free; now White's clock runs (${(c.w / 1000).toFixed(1)} s)`);
  // increment
  const wBefore = c.w; await move('g1f3'); c = await C();
  check(c.run === 'b' && c.w > wBefore + 1000 && c.w < wBefore + 2000, `White gets +2 s after moving (${(wBefore / 1000).toFixed(1)} → ${(c.w / 1000).toFixed(1)} s)`);
  check(await page.locator('.strip .clock.on').count() === 1, 'the running clock is highlighted');
  // undo gives no time back
  await sleep(700); const before = await C(); await page.click('[data-act="undo"]'); await sleep(200); c = await C();
  check(c.n === 2 && c.run === 'w' && Math.abs(c.b - before.b) < 150 && c.w <= before.w + 5, 'Undo takes the move back but gives no time back');
  // pause by tapping a clock (2-player game)
  await page.click('.strip .clock >> nth=0'); await sleep(200); const p1 = await C(); await sleep(1200); c = await C();
  check(c.paused && c.run === null && Math.abs(c.w - p1.w) < 5, 'tapping a clock pauses both clocks');
  await page.click('.strip .clock >> nth=0'); await sleep(300); c = await C();
  check(!c.paused && c.run === 'w', 'tapping again carries on');
  // other tabs and the background
  await page.click('#tabs [data-tab="puzzles"]'); await sleep(200); const t1 = await C(); await sleep(1200); c = await C();
  check(c.run === null && Math.abs(c.w - t1.w) < 5, 'clocks stop while you are in another tab');
  await page.click('#tabs [data-tab="play"]'); await sleep(300);
  check((await C()).run === 'w', 'clocks carry on when you return to Play');
  await tc(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hid = await C(); await sleep(1200); c = await C();
  check(c.run === null && Math.abs(c.w - hid.w) < 5, 'clocks pause while the app is in the background');
  await tc(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(300); check((await C()).run === 'w', 'clocks resume when the app comes back');
  // reload keeps the clock
  const pre = await C(); await page.reload({ waitUntil: 'networkidle' }); await sleep(600); c = await C();
  check(c && Math.abs(c.w - pre.w) < 2500 && Math.abs(c.b - pre.b) < 50 && c.n === 2, 'the clock survives closing and reopening the app');
  // running out, with a piece selected: no move is possible afterwards
  await tap('g1'); await tc(() => { const c = window.__tc.sessions.play.clock; c.w = 600; c.t0 = performance.now(); });
  check(await waitFor(async () => !!(await C()).over, 5000) >= 0, 'time runs out');
  await sleep(150); await tap('f3'); await sleep(300); c = await C();
  check(c.n === 2 && /Time's up/.test(c.over.title) && /Black wins on time/.test(c.over.sub), `no move after time is up; result: ${c.over.sub}`);
  await sleep(600); check(/Time's up/.test(await page.locator('#sheet').innerText().catch(() => '')), 'game-over sheet appears');
  await page.screenshot({ path: path.join(__dirname, 'output', 'clock-flag.png') });
  await page.click('#sheet .xbtn').catch(() => {}); await sleep(300);
  // reload after running out: still over
  await page.reload({ waitUntil: 'networkidle' }); await sleep(900); c = await C();
  check(c.over && c.flag === 'w' && c.n === 2 && c.run === null, 'after reopening, the game is still lost on time');
  // the draw rule (FIDE, simplified)
  const r = await tc(() => { const E = window.__tc.EngineFactory(), T = window.__tc.timeoutResult, out = [];
    for (const f of ['8/8/4k3/8/8/8/4K3/4N3 w - - 0 1', '8/8/4k3/8/8/8/4K3/4R3 w - - 0 1', '8/4p3/4k3/8/8/8/4K3/4N3 w - - 0 1']) { E.loadUci(f, []); out.push(T(E, 'b')); } return out; });
  check(r[0].win === null && /cannot checkmate/.test(r[0].sub) && r[1].win === 'w' && r[2].win === 'w', 'out of time: v lone knight = draw; v rook = loss; knight v king+pawn = loss (mate possible)');
  check(await tc(() => [window.__tc.clockFmt(65000), window.__tc.clockFmt(9450)].join(' ')) === '1:05 9.4', 'display: m:ss, tenths under 20 s');
  // vs the computer
  await newGame('cpu', '5+0');
  await move('d2d4');
  check(await waitFor(async () => (await C()).n === 2, 12000) >= 0, 'the computer replies');
  await move('c2c4'); check(await waitFor(async () => (await C()).n === 4, 12000) >= 0, 'the computer replies on the clock');
  c = await C(); check(c.b < 300000 && c.run === 'w', `the computer's clock went down (${(c.b / 1000).toFixed(1)} s)`);
  // lessons start games without a clock; no clock option
  await newGame('cpu', 'off');
  check(!(await C()) && await page.locator('.strip .clock').count() === 0, 'No clock: no clocks shown');
  check(!errs.length, errs.length ? 'errors: ' + errs.slice(0, 5).join(' | ') : 'no errors');
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  await b.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
