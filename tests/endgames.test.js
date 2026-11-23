// Endgame trainer: win the drills, fail them the right way, hold a draw, undo, search.
const path = require('path');
const { chromium } = require('playwright-core');
const { EDGE } = require('./browser');
const URL = process.argv[2] || 'http://127.0.0.1:8766/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails++; };
async function waitFor(fn, ms = 15000, step = 120) { const s = Date.now(); while (Date.now() - s < ms) { try { if (await fn()) return Date.now() - s; } catch (e) { } await sleep(step); } return -1; }
(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle' }); await sleep(400);
  const tc = (fn, a) => page.evaluate(fn, a);
  const L = () => tc(() => { const s = window.__tc.sessions.learn; return { id: s.eg && s.eg.id, n: s.game.moves.length, moves: s.game.moves.slice(), done: s.done, ok: s.ok, checking: s.checking, msg: s.msg, stars: s.stars, turn: s.eng.turn() ? 'b' : 'w', side: s.eg && s.eg.side }; });
  const click = async n => {
    const o = await tc(() => window.__tc.sessions.learn.orientation), box = await page.locator('#board').boundingBox(), SQ = box.width / 8;
    let f = n.charCodeAt(0) - 97, r = n.charCodeAt(1) - 49; if (o === 'b') { f = 7 - f; r = 7 - r; }
    await page.mouse.click(box.x + (f + .5) * SQ, box.y + (7 - r + .5) * SQ); await sleep(130);
  };
  const play = async u => { await click(u.slice(0, 2)); await click(u.slice(2, 4)); if (u.length > 4) { await sleep(250); if (await page.locator('#promo').isVisible()) await page.click(`#promo [data-p="${u[4]}"]`); } };
  const myTurn = async () => { const l = await L(); return l.done || (!l.checking && l.turn === l.side); };
  const hintMove = async () => { await page.click('[data-act="hint"]'); await waitFor(() => tc(() => !!window.__tc.S.hint && !window.__tc.S.busy), 8000); return tc(() => window.__tc.S.hint); };

  await page.click('#tabs [data-tab="learn"]'); await sleep(400);
  check(/Endgame trainer/.test(await page.locator('#panel').innerText()), 'Learn hub lists the Endgame trainer');
  await page.click('[data-act="eglist"]'); await sleep(300);
  check(await page.locator('#sheet [data-eg]').count() === 8, 'trainer lists 8 endgames (beginner to expert)');
  await page.screenshot({ path: path.join(__dirname, 'output', 'eg-list.png') });

  // 1. pawn race won in 4 moves, no hints = 3 stars
  await page.click('#sheet [data-eg="race"]'); await waitFor(async () => !(await page.locator('#scrim.on').count())); await sleep(350); await waitFor(myTurn);
  check(/How to do it/.test(await page.locator('#panel').innerText()) && await page.locator('details.how[open]').count() === 1, 'first visit shows the step-by-step plan');
  for (const u of ['a4a5', 'a5a6', 'a6a7', 'a7a8q']) { await waitFor(myTurn); if ((await L()).done) break; await play(u); }
  await waitFor(async () => (await L()).done, 8000);
  let l = await L();
  check(l.ok && l.stars === 3 && /queen/i.test(l.msg), 'pawn race: queen made safely in 4 moves → 3 stars: ' + l.msg);
  await page.screenshot({ path: path.join(__dirname, 'output', 'eg-race-won.png') });
  check(await tc(() => window.__tc.egStars.race === 3), 'stars saved');

  // 2. the same race lost: wasting a move lets the king catch the pawn
  await page.click('[data-act="egretry"]'); await waitFor(myTurn);
  await play('h1g2');
  for (let k = 0; k < 12; k++) { await waitFor(myTurn); l = await L(); if (l.done) break;
    const pawn = await tc(() => { const b = window.__tc.sessions.learn.eng.board(); for (let i = 0; i < 64; i++) if (b[i] === 'P') return 'abcdefgh'[i % 8] + (1 + (i >> 3)); return null; });
    const u = pawn ? pawn + pawn[0] + (+pawn[1] + 1) + (pawn[1] === '7' ? 'q' : '') : await hintMove();
    const legal = await tc(u => { const e = window.__tc.sessions.learn.eng; return !!e.fromUci(u); }, u);
    await play(legal ? u : await hintMove()); }
  await waitFor(async () => (await L()).done, 8000); l = await L();
  check(l.done && !l.ok, 'wasting a move loses the race (fails with an explanation): ' + l.msg);
  // undo after failing
  await page.click('[data-act="egundo"]'); await sleep(400); l = await L();
  check(!l.done && /taken back/.test(l.msg), 'Undo takes the move back after a fail');

  // 3. queen checkmate with hints (hints cap the stars at 2)
  await tc(() => window.__tc.startEndgame(window.__tc.ENDGAMES.find(e => e.id === 'queen')));
  for (let k = 0; k < 40; k++) { await waitFor(myTurn); l = await L(); if (l.done) break; await play(await hintMove()); }
  await waitFor(async () => (await L()).done, 8000); l = await L();
  check(l.ok && /Checkmate/.test(l.msg) && l.stars <= 2 && Math.ceil(l.n / 2) <= 10, `queen mate with perfect hints, within 10 moves: ${l.msg} (${l.stars} stars)`);
  await tc(() => window.__tc.startEndgame(window.__tc.ENDGAMES.find(e => e.id === 'rook')));
  for (let k = 0; k < 30; k++) { await waitFor(myTurn); l = await L(); if (l.done) break; await play(await hintMove()); }
  await waitFor(async () => (await L()).done, 8000); l = await L();
  check(l.ok && /Checkmate/.test(l.msg) && Math.ceil(l.n / 2) <= 16, `rook mate with perfect hints, within 16 moves: ${l.msg}`);
  await page.screenshot({ path: path.join(__dirname, 'output', 'eg-queen-mate.png') });

  // 4. hold the draw as Black (the computer attacks first)
  await tc(() => window.__tc.startEndgame(window.__tc.ENDGAMES.find(e => e.id === 'opposition')));
  check(await waitFor(async () => { const q = await L(); return q.n === 1 && !q.checking; }) >= 0, 'opposition drill: the computer (White) moves first');
  for (let k = 0; k < 20; k++) { await waitFor(myTurn, 20000); l = await L(); if (l.done) break; await play(await hintMove()); }
  await waitFor(async () => (await L()).done, 20000); l = await L();
  check(l.ok, 'opposition drill held to a draw: ' + l.msg);

  // 4b. teaching aids: shaded squares, plan-matching first hint; Lucena won with hints (engine judges the result)
  await tc(() => window.__tc.startEndgame(window.__tc.ENDGAMES.find(e => e.id === 'race'))); await waitFor(myTurn); await sleep(200);
  check(await page.locator('.hl.zone').count() === 16, 'race: the "square" is shaded on the board');
  await tc(() => window.__tc.startEndgame(window.__tc.ENDGAMES.find(e => e.id === 'lucena'))); await waitFor(myTurn);
  check(await hintMove() === 'c1d1', 'Lucena: the first hint follows the plan (Rd1+)');
  await page.click('[data-act="egretry"]'); await waitFor(myTurn);
  for (let k = 0; k < 12; k++) { await waitFor(myTurn, 20000); l = await L(); if (l.done) break; await play(await hintMove()); }
  await waitFor(myTurn, 20000); l = await L();
  const lscore = l.done ? (l.ok ? 9999 : -9999) : await tc(() => { const s = window.__tc.sessions.learn, E = window.__tc.EngineFactory(); E.loadUci(s.game.start, s.game.moves); const r = E.think({ timeMs: 1500 }); return E.turn() ? -r.score : r.score; });
  check(lscore >= 400, `Lucena: 12 hinted moves keep the win (White +${lscore}) ${l.done ? l.msg : ''}`);

  // 5. switching away while the computer is thinking must not freeze anything
  await tc(() => window.__tc.startEndgame(window.__tc.ENDGAMES.find(e => e.id === 'race')));
  await waitFor(myTurn); await play('a4a5'); // the computer starts thinking…
  await page.click('#tabs [data-tab="puzzles"]'); await tc(() => window.__tc.startThemePuzzle('fork', 'easy')); await sleep(1500);
  await page.click('#tabs [data-tab="learn"]');
  check(await waitFor(async () => { const q = await L(); return q.n === 2 && !q.checking; }, 8000) >= 0, 'endgame: the computer still replies after visiting another tab mid-thought');
  await page.click('#tabs [data-tab="play"]'); await sleep(300);
  await page.click('[data-act="new"]'); await sleep(300); await page.click('#ngKind [data-k="cpu"]'); await sleep(150); await page.click('#ngGo'); await sleep(600);
  const human = await tc(() => window.__tc.sessions.play.human);
  if (human === 'w') {
    const box = await page.locator('#board').boundingBox(), SQ = box.width / 8;
    await page.mouse.click(box.x + 4.5 * SQ, box.y + 6.5 * SQ); await sleep(130); await page.mouse.click(box.x + 4.5 * SQ, box.y + 4.5 * SQ); // e2-e4
    await sleep(60);
  }
  await page.click('#tabs [data-tab="puzzles"]'); await tc(() => window.__tc.startThemePuzzle('pin', 'easy')); await sleep(1200);
  await page.click('#tabs [data-tab="play"]');
  check(await waitFor(() => tc(() => { const p = window.__tc.sessions.play; return (p.eng.turn() ? 'b' : 'w') === p.human && p.game.moves.length >= 1; }), 10000) >= 0, 'Play: the computer still moves after you visited Puzzles while it was thinking');
  await page.click('#tabs [data-tab="learn"]'); await sleep(300);

  // 6. search
  await page.click('#btnSearch'); await sleep(300); await page.fill('#srQ', 'lucena'); await sleep(400);
  check(/Lucena/.test(await page.locator('#srRes').innerText()), 'search "lucena" finds the endgame');
  await page.click('#srRes .item'); await sleep(600);
  check((await L()).id === 'lucena', 'opening it from search starts the drill');
  check(!errs.length, errs.length ? 'errors: ' + errs.slice(0, 5).join(' | ') : 'no errors');
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  await b.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
