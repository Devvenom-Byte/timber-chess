const path = require('path');
const { chromium } = require('playwright-core');
const { EDGE } = require('./browser');
const URL = process.argv[2] || 'http://127.0.0.1:8765/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails++; };
async function waitFor(fn, ms = 60000, step = 200) { const s = Date.now(); while (Date.now() - s < ms) { try { if (await fn()) return Date.now() - s; } catch (e) { } await sleep(step); } return -1; }
(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle' }); await sleep(400);
  const tc = (fn, a) => page.evaluate(fn, a);
  const play = async moves => {
    await page.click('[data-act="new"]'); await sleep(300); await page.click('#ngKind [data-k="local"]'); await sleep(150); await page.click('#ngGo'); await sleep(400);
    for (const u of moves.split(' ')) {
      const box = await page.locator('#board').boundingBox(), SQ = box.width / 8;
      const at = n => [box.x + (n.charCodeAt(0) - 97 + .5) * SQ, box.y + (7 - (n.charCodeAt(1) - 49) + .5) * SQ];
      await page.mouse.click(...at(u.slice(0, 2))); await sleep(120); await page.mouse.click(...at(u.slice(2, 4))); await sleep(450);
    }
  };
  // 1) Scholar's mate
  await play('e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7');
  check(await tc(() => window.__tc.sessions.play.game.moves.length === 7 && !!window.__tc.sessions.play.over), "Scholar's mate played, game over");
  await sleep(900);
  check(/Review game/.test(await page.locator('#sheet').innerText()), 'game-over sheet offers "Review game"');
  await page.click('#goReview');
  check(/Reviewing the game/.test(await page.locator('#panel').innerText()), 'progress card shows while reviewing');
  const t = await waitFor(() => tc(() => !!window.__tc.rvDone(window.__tc.sessions.play)));
  check(t >= 0, `review finished in ${(t / 1000).toFixed(1)} s`);
  await sleep(500);
  const R = await tc(() => { const R = window.__tc.sessions.play.review; return { cls: R.moves.map(m => m.cls), acc: R.acc }; });
  console.log('   classes:', R.cls.join(' '), '| accuracy', JSON.stringify(R.acc));
  check(R.cls[5] === 'blunder', '...Nf6?? is a blunder');
  check(R.cls[6] === 'best', 'Qxf7# is the best move');
  const panel = await page.locator('#panel').innerText();
  console.log('   panel says:', panel.split('\n').filter(l => /Nf6|checkmate|Better/.test(l)).join(' / '));
  check(/Nf6/.test(panel) && /Blunder/.test(panel) && /checkmate in 1/i.test(panel) && /Qxf7#/.test(panel), 'jumps to the blunder and explains it allows mate (Qxf7#)');
  check(await page.locator('.mlist .mv[data-rv="blunder"]').count() === 1, 'move list marks the blunder ??');
  await page.screenshot({ path: path.join(__dirname, 'output', 'review-blunder.png') });
  await page.click('[data-act="rvbest"]'); await sleep(500);
  const p2 = await page.locator('#panel').innerText();
  check(/green arrow/.test(p2) && await page.locator('#arrows line').count() >= 1 && await tc(() => window.__tc.sessions.play.view === 5), '"Show better move" shows the earlier position with an arrow');
  console.log('   better move text:', p2.split('\n').filter(l => /Better/.test(l)).join(' '));
  await page.screenshot({ path: path.join(__dirname, 'output', 'review-best.png') });
  // graph tap
  await page.locator('.rv svg[data-act]').scrollIntoViewIfNeeded(); await sleep(200); const g = await page.locator('.rv svg[data-act]').boundingBox(); await page.mouse.click(g.x + g.width * 0.3, g.y + g.height / 2); await sleep(400);
  check(await tc(() => window.__tc.sessions.play.view === 2), 'tapping the graph jumps to that move');
  // new game clears review
  await page.click('[data-act="new"]'); await sleep(300); await page.click('#ngGo'); await sleep(500);
  check(!(await page.locator('.rv').count()), 'review disappears after starting a new game');
  // 2) A longer game vs the queen-hanging: Italian then a hanging queen
  await play('e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d4 e5d4 c3d4 c5b4 b1c3 f6e4 e1g1 e4c3 b2c3 b4c3 d1b3 d7d5 c4d5 e8g8 d5f7 g8h8 b3c3 d8d4 c3d4 c6d4 f3d4');
  const over = await tc(() => !!window.__tc.sessions.play.over);
  console.log('   game over:', over);
  await tc(() => window.__tc.startReview(window.__tc.sessions.play));
  const t2 = await waitFor(() => tc(() => !!window.__tc.rvDone(window.__tc.sessions.play)), 90000);
  check(t2 >= 0, `29-move game reviewed in ${(t2 / 1000).toFixed(1)} s`);
  const R2 = await tc(() => { const R = window.__tc.sessions.play.review; return { cls: R.moves.map(m => m.cls), acc: R.acc }; });
  console.log('   classes:', R2.cls.join(' '), '| accuracy', JSON.stringify(R2.acc));
  check(R2.cls.slice(0, 6).every(c => c === 'book'), 'opening moves are recognised as book');
  check(['mistake', 'blunder'].includes(R2.cls[25]), '...Qxd4?? (queen for nothing) flagged: ' + R2.cls[25]);
  await page.screenshot({ path: path.join(__dirname, 'output', 'review-long.png') });
  await page.click('[data-act="rvnext"]'); await sleep(400);
  check(/Next mistake/.test(await page.locator('#panel').innerText()), 'next-mistake navigation works');
  check(!errs.length, errs.length ? 'errors: ' + errs.slice(0, 5).join(' | ') : 'no errors');
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  await b.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
