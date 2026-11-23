// Tests the new "Level" chip and the Learn tab against the LOCAL copy (http://127.0.0.1:8765/).
const path = require('path');
const { chromium } = require('playwright-core');
const URL = process.argv[2] || 'http://127.0.0.1:8765/';
const { EDGE } = require('./browser');
const OUT = path.join(__dirname, 'output');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails++; };

// Mirror of the lesson solutions (lesson -> steps)
const SOLS = [['e2e4', 'e4d5', 'a7a8'], ['a1a6', 'a6g6'], ['c1h6', 'f1b5'], ['d1a4', 'd1d7'], ['b1c3', 'e4f6'], ['e1e2', 'e1d2'],
  ['a1a8', 'e1e2', 'b1d2', 'a5b4'], ['a1a8', 'a1g7'], ['e1g1', 'e5d6']];

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 380, height: 840 }, deviceScaleFactor: 2 });
  const problems = [];
  page.on('pageerror', e => problems.push('page error: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push('console error: ' + m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(800);

  const sqCenter = async (sq) => { const r = await page.locator('#board').boundingBox(); const S = r.width / 8; const f = sq.charCodeAt(0) - 97, rk = +sq[1]; return [r.x + (f + .5) * S, r.y + (8 - rk + .5) * S]; };
  const tap = async (sq) => { const [x, y] = await sqCenter(sq); await page.mouse.click(x, y); await sleep(300); };
  const move = async (u) => { await tap(u.slice(0, 2)); await tap(u.slice(2, 4)); await sleep(200); if (await page.locator('#promo').isVisible()) { await page.click('#promo [data-p="q"]'); await sleep(200); } };
  const moves = async () => (await page.locator('#mlist').innerText()).replace(/\s+/g, ' ').trim();
  const topStrip = async () => (await page.locator('#stripTop').innerText()).replace(/\s+/g, ' ').trim();

  // ---------- A. Level chip ----------
  await page.click('[data-act="new"]'); await sleep(300);
  await page.click('#ngKind [data-k="cpu"]'); await sleep(200);
  await page.click('#ngColor [data-c="w"]'); await sleep(150);
  await page.click('#ngLevel [data-l="0"]'); await sleep(150);
  await page.click('#ngGo'); await sleep(900);
  check(/Twig/.test(await topStrip()), 'computer strip shows Twig: ' + await topStrip());
  check(await page.locator('#stripTop .lvchip').isVisible(), 'Level chip visible next to the computer');
  check(!(await page.locator('#stripBottom .lvchip').count()), 'no Level chip on your own strip');
  await move('e2e4'); await sleep(2200);
  const before = await moves();
  await page.screenshot({ path: path.join(OUT, 'a1-play-with-chip.png') });
  await page.click('#stripTop .lvchip'); await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'a2-level-picker.png') });
  check(await page.locator('#lvPick').isVisible(), 'level picker opens');
  await page.click('#lvPick [data-l="5"]'); await sleep(600);
  check(/Ironwood/.test(await topStrip()), 'strip now shows Ironwood: ' + await topStrip());
  check((await moves()) === before, 'game kept the same moves: ' + before);
  const saved = await page.evaluate(() => { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/play/.test(k)) return localStorage.getItem(k); } return null; });
  check(saved && /"level":5/.test(saved), 'new level saved (survives reload)');
  await move('g1f3'); await sleep(5000);
  check((await moves()).split(' ').length > before.split(' ').length + 1, 'computer replied at new level: ' + await moves());

  // ---------- B. Learn tab ----------
  check(await page.locator('#tabs [data-tab="learn"]').isVisible(), 'Learn tab in bottom bar');
  await page.click('#tabs [data-tab="learn"]'); await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'b1-learn-intro.png') });
  check(/Your chess path/.test(await page.locator('#panel').innerText()), 'Learn opens with the chess path card');
  await page.click('[data-act="lsnext"]'); await sleep(600);
  check((await page.locator('.hl.goal').count()) === 1, 'glowing target square shown');
  await page.screenshot({ path: path.join(OUT, 'b2-lesson-pawn.png') });

  // wrong move first
  await move('e2e3'); await sleep(300);
  check(await page.locator('#panel .feedback.bad').count() === 1, 'wrong move gets "try again"');
  await sleep(1300);
  const pawnBack = await page.evaluate(() => document.querySelectorAll('#pcLayer > *').length);
  // hint
  await page.click('[data-act="hint"]'); await sleep(300);
  check((await page.locator('#arrows *').count()) > 0, 'Hint draws an arrow');

  for (let li = 0; li < SOLS.length; li++) {
    const title = (await page.locator('#panel .card h3').innerText()).split('\n')[0];
    for (let si = 0; si < SOLS[li].length; si++) {
      await move(SOLS[li][si]); await sleep(400);
      const good = await page.locator('#panel .feedback.good').count();
      if (!good) { check(false, `lesson ${li + 1} (${title}) step ${si + 1}: ${SOLS[li][si]} -> ${await page.locator('#panel .feedback').innerText()}`); }
      console.log(`   L${li + 1}.${si + 1} ${SOLS[li][si]}: ` + (await page.locator("#panel .card").innerText()).replace(/\s+/g, " ").slice(-110));
      if (li === 7 && si === 0) await page.screenshot({ path: path.join(OUT, 'b3-mate-step.png') });
      await sleep(2000);
    }
    const txt = await page.locator('#panel').innerText();
    check(/Lesson complete/.test(txt), `lesson ${li + 1} "${title}" completed`);
    if (li < SOLS.length - 1) { await page.click('[data-act="lsnext"]'); await sleep(600); }
  }
  await page.screenshot({ path: path.join(OUT, 'b4-all-done.png') });
  check(await page.locator('[data-act="lsplay"]').isVisible(), 'final lesson offers "Play Twig"');
  await page.click('[data-act="lslist"]'); await sleep(400);
  check((await page.locator('#sheet .tag.good').count()) === SOLS.length, 'lesson list shows all ticked');
  await page.screenshot({ path: path.join(OUT, 'b5-lesson-list.png') });
  await page.click('#sheet [data-ls="0"]'); await sleep(500);
  await page.click('#tabs [data-tab="play"]'); await sleep(500);
  check(/Ironwood/.test(await topStrip()), 'Play game untouched after visiting Learn');

  // narrow phone: 5 tabs fit
  await page.setViewportSize({ width: 320, height: 640 }); await sleep(400);
  const tabsFit = await page.evaluate(() => { const t = document.querySelector('#tabs'); return t.scrollWidth <= t.clientWidth + 1; });
  check(tabsFit, '5 tabs fit on a small 320px phone');
  await page.screenshot({ path: path.join(OUT, 'c1-small-phone.png') });

  check(problems.length === 0, problems.length ? 'errors:\n  ' + problems.join('\n  ') : 'no console errors');
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  await browser.close();
})().catch(e => { console.error('TEST CRASHED:', e.message); process.exit(1); });
