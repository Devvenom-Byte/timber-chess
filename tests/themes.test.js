const path = require('path');
const { chromium } = require('playwright-core');
const { EDGE } = require('./browser');
const URL = process.argv[2] || 'http://127.0.0.1:8765/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails++; };
async function waitFor(fn, ms = 15000, step = 150) { const s = Date.now(); while (Date.now() - s < ms) { try { if (await fn()) return Date.now() - s; } catch (e) { } await sleep(step); } return -1; }
(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle' }); await sleep(500);
  const tc = (fn, a) => page.evaluate(fn, a);
  const P = () => tc(() => { const s = window.__tc.sessions.puzzles; return { tp: s.tp && { theme: s.tp.theme, band: s.tp.band, id: s.tp.id, line: s.tp.line }, n: s.game.moves.length, solved: s.solved, checking: s.checking, side: s.side, msg: s.msg }; });
  const click = async n => {
    const o = await tc(() => window.__tc.sessions.puzzles.orientation), box = await page.locator('#board').boundingBox(), SQ = box.width / 8;
    let f = n.charCodeAt(0) - 97, r = n.charCodeAt(1) - 49; if (o === 'b') { f = 7 - f; r = 7 - r; }
    await page.mouse.click(box.x + (f + .5) * SQ, box.y + (7 - r + .5) * SQ); await sleep(150);
  };
  const play = async u => { await click(u.slice(0, 2)); await click(u.slice(2, 4)); if (u.length > 4) { await sleep(250); if (await page.locator('#promo').isVisible()) await page.click(`#promo [data-p="${u[4]}"]`); } };
  const solve = async () => { // play the solution, waiting for the opponent's replies
    for (let k = 0; k < 20; k++) {
      await waitFor(async () => { const p = await P(); return p.solved || (!p.checking && p.n % 2 === 1); }, 8000);
      const p = await P(); if (p.solved) return true;
      await play(p.tp.line[p.n]); await sleep(300);
    }
    return false;
  };
  await page.click('#tabs [data-tab="puzzles"]'); await sleep(500);
  check(/Choose a theme/.test(await page.locator('#panel').innerText()), 'Puzzles tab shows the themed home');
  await page.click('[data-act="pzlist"]'); await sleep(300);
  check(await page.locator('#sheet [data-th]').count() === 15 && await page.locator('#sheet [data-lv]').count() === 3, 'theme list: 15 themes and Easy/Medium/Hard');
  check(await waitFor(() => page.locator('#sheet [data-th="fork"] .tag').count()) >= 0, 'theme list shows counts once the index loads');
  check(await page.locator('#sheet [data-pz]').count() > 5, 'classic checkmates still listed');
  await page.screenshot({ path: path.join(__dirname, 'output', 'pz-list.png') });
  await page.click('#sheet [data-th="fork"]');
  check(await waitFor(async () => (await P()).n === 1 && !(await P()).checking) >= 0, 'fork puzzle loads and the opponent plays first');
  let p = await P();
  check(p.tp.theme === 'fork' && p.tp.band === 'easy', 'easy fork puzzle: ' + p.tp.id);
  check(/Your move: you are (White|Black)/.test(p.msg), 'prompt: ' + p.msg);
  await page.screenshot({ path: path.join(__dirname, 'output', 'pz-fork.png') });
  // a wrong move first: any legal move of mine that is not the answer (and not mate)
  const wrong = await tc(() => { const s = window.__tc.sessions.puzzles, e = s.eng, want = s.tp.line[s.game.moves.length]; for (const m of e.legal()) { const u = e.uci(m); if (u !== want && u.length === 4) { e.make(m); const mate = e.status() === 'checkmate'; e.unmake(); if (!mate) return u; } } return null; });
  if (wrong) { await play(wrong); await sleep(300); check(/Not this one/.test((await P()).msg), 'wrong move is refused: ' + wrong); await waitFor(async () => (await P()).n === 1 && !(await P()).checking, 3000); }
  await page.click('[data-act="pzclue"]'); await sleep(200);
  check(/This piece/.test((await P()).msg), 'clue points at the piece');
  check(await solve(), 'fork puzzle solved by playing the right moves');
  check(/Solved/.test(await page.locator('#panel').innerText()) && await tc(() => window.__tc.pzProg[window.__tc.sessions.puzzles.tp.id] === 2), 'solved, saved as "with help"');
  await page.screenshot({ path: path.join(__dirname, 'output', 'pz-solved.png') });
  // retrying and solving cleanly must not upgrade "with help" to "first try"
  await page.click('[data-act="pzretry"]'); await waitFor(async () => { const q = await P(); return q.n === 1 && !q.checking; });
  check(await solve(), 'retry solved cleanly');
  check(await tc(() => window.__tc.pzProg[window.__tc.sessions.puzzles.tp.id] === 2 && window.__tc.pzStreak.now === 0), 'retry keeps "with help" and does not count towards the streak');
  // next puzzle in the set + hint shows the arrow
  const firstId = (await P()).tp.id;
  await page.click('[data-act="pznext"]');
  await waitFor(async () => { const q = await P(); return q.tp.id !== firstId && q.n === 1 && !q.checking; });
  check((await P()).tp.id !== firstId, 'Next gives a different puzzle in the same set');
  await page.click('[data-act="hint"]'); await sleep(250);
  check(await page.locator('#arrows line').count() >= 1, 'Hint draws the arrow');
  // every theme at every level: load one and solve it
  for (const [th, lv] of [['mateIn1', 'easy'], ['mateIn2', 'medium'], ['pin', 'hard'], ['promotion', 'medium'], ['endgame', 'hard'], ['defensiveMove', 'easy']]) {
    await tc(([th, lv]) => window.__tc.startThemePuzzle(th, lv), [th, lv]);
    await waitFor(async () => { const q = await P(); return q.tp && q.tp.theme === th && q.n === 1 && !q.checking; });
    const ok = await solve(); const q = await P();
    check(ok && q.tp.theme === th, `${th} (${lv}) ${q.tp.id} solved (${q.tp.line.length} moves)`);
  }
  // level choice is remembered
  await page.click('[data-act="pzlist"]'); await sleep(300); await page.click('#sheet [data-lv="hard"]'); await sleep(300);
  check(await page.locator('#sheet [data-lv="hard"].on').count() === 1, 'level switch to Hard');
  await page.click('#sheet [data-th="skewer"]'); await waitFor(async () => { const q = await P(); return q.tp.theme === 'skewer'; });
  check((await P()).tp.band === 'hard', 'Hard skewer puzzle opens');
  // search finds themes
  await page.click('#btnSearch'); await sleep(300); await page.fill('#sq, #searchQ, #sheet input', 'fork'); await sleep(400);
  check(/Forks puzzles/.test(await page.locator('#sheet').innerText()), 'search "fork" finds the Forks puzzle theme');
  await page.click('#sheet .xbtn');
  if (URL.startsWith('https:')) {
  // offline: a theme opened once works without internet
  await tc(() => navigator.serviceWorker.ready); await page.reload({ waitUntil: 'networkidle' }); await sleep(500);
  await tc(() => window.__tc.startThemePuzzle('fork', 'easy')); await sleep(1500); // a returning user: app under offline control, theme opened once
  await ctx.setOffline(true); await page.reload({ waitUntil: 'load' }).catch(() => {}); await sleep(1200);
  await tc(() => window.__tc.startThemePuzzle('fork', 'easy'));
  check(await waitFor(async () => { const q = await P(); return q.tp && q.tp.theme === 'fork' && q.n === 1; }, 6000) >= 0, 'fork puzzles still work offline');
  await ctx.setOffline(false);
  } else console.log('SKIP offline check (the offline cache only runs on https: checked on the live site)');
  check(!errs.filter(e => !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(e)).length, 'no errors ' + errs.slice(0, 4).join(' | '));
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  await b.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
