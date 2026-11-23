// The guided chess path (Learn tab) and the coordinates trainer.
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
  const CO = () => tc(() => { const c = window.__tc.sessions.learn.co; return c && { running: c.running, score: c.score, miss: c.miss, target: c.target, mode: c.mode, side: c.side, last: c.last }; });
  const tapSq = async q => { const o = await tc(() => window.__tc.sessions.learn.orientation), box = await page.locator('#board').boundingBox(), SQ = box.width / 8;
    let f = q % 8, r = q >> 3; if (o === 'b') { f = 7 - f; r = 7 - r; } await page.mouse.click(box.x + (f + .5) * SQ, box.y + (7 - r + .5) * SQ); await sleep(90); };

  // the path on the Learn tab
  await page.click('#tabs [data-tab="learn"]'); await sleep(400);
  let panel = await page.locator('#panel').innerText();
  check(/Your chess path/.test(panel) && /Step 1 of \d+: Meet the pieces/.test(panel), 'Learn starts with the path: step 1, Meet the pieces');
  await page.screenshot({ path: path.join(__dirname, 'output', 'course-hub.png') });
  await page.click('[data-act="course"]'); await sleep(300);
  const steps = await page.locator('#sheet [data-step]').count();
  check(steps >= 20 && /First steps/i.test(await page.locator('#sheet').innerText()) && /Expert/i.test(await page.locator('#sheet').innerText()), `the whole path has ${steps} steps, from First steps to Expert`);
  await page.screenshot({ path: path.join(__dirname, 'output', 'course-path.png') });
  await page.click('#sheet [data-step="0"]'); await sleep(500);
  check(await tc(() => window.__tc.sessions.learn.les && window.__tc.sessions.learn.les.id === 'pawn'), 'tapping step 1 opens the first lesson');

  // coordinates: find the square
  await tc(() => window.__tc.startCoords()); await sleep(300);
  check(/Board coordinates/.test(await page.locator('#panel').innerText()), 'coordinates trainer opens with an explanation');
  await page.click('[data-act="costart"]'); await sleep(200);
  let c = await CO(); check(c.running && c.target >= 0 && /^[a-h][1-8]$/.test((await page.locator('.cotarget').innerText()).trim()), 'a square name is shown: ' + (await page.locator('.cotarget').innerText()).trim());
  for (let k = 0; k < 9; k++) { c = await CO(); await tapSq(c.target); }
  c = await CO(); check(c.score === 9 && c.miss === 0, 'tapping the named squares scores 9 of 9');
  const wrong = (c.target + 1) % 64; await tapSq(wrong); c = await CO();
  check(c.miss === 1 && c.score === 9, 'a wrong tap counts as a miss');
  await page.screenshot({ path: path.join(__dirname, 'output', 'coords-find.png') });
  await tc(() => { window.__tc.sessions.learn.co.end = performance.now() + 50; }); await sleep(400);
  c = await CO(); check(!c.running && c.last && c.last.score === 9 && c.last.rec, 'the round ends and saves a new best');
  check(await tc(() => window.__tc.coBest.find_w === 9), 'best score saved (find, as White)');
  // name the square, as Black, letters hidden
  await page.click('[data-act="coset"][data-k="mode"][data-v="name"]'); await page.click('[data-act="coset"][data-k="side"][data-v="b"]'); await page.click('[data-act="coset"][data-k="labels"][data-v="off"]'); await sleep(200);
  check(await tc(() => window.__tc.sessions.learn.orientation === 'b') && await page.locator('#frame.nocoords').count() === 1, 'as Black: board turned round; letters hidden');
  await page.click('[data-act="costart"]'); await sleep(200);
  check(await page.locator('.hl.goal').count() === 1 && await page.locator('.coans button').count() === 4, 'name mode: one square glows, four answers offered');
  for (let k = 0; k < 3; k++) { c = await CO(); await page.click(`.coans [data-v="${c.target}"]`); await sleep(120); }
  c = await CO(); check(c.score === 3, 'picking the right names scores 3');
  await page.screenshot({ path: path.join(__dirname, 'output', 'coords-name.png') });
  await page.click('[data-act="costop"]'); await sleep(200);
  check(!(await CO()).running, 'Stop ends the round');
  // a round cut short by switching tab does not count; Learn home brings the path back
  await page.click('[data-act="costart"]'); await sleep(150); c = await CO(); await page.click(`.coans [data-v="${c.target}"]`); await sleep(100);
  await page.click('#tabs [data-tab="play"]'); await sleep(300); await page.click('#tabs [data-tab="learn"]'); await sleep(300);
  c = await CO(); check(!c.running && await tc(() => window.__tc.coBest.name_b === 3), 'switching tab stops the round without changing the best score');
  await page.click('[data-act="learnhome"]'); await sleep(300);
  check(/Your chess path/.test(await page.locator('#panel').innerText()) && !(await CO()), '"‹ Learn home" goes back to the path');

  // the path moves on as you progress (simulate finished lessons, then reload)
  await tc(() => { localStorage.setItem('timber.learnDone', JSON.stringify({ pawn: 1, rook: 1, bishop: 1, queen: 1, knight: 1, king: 1 })); });
  await page.reload({ waitUntil: 'networkidle' }); await sleep(500);
  if (!(await page.locator('#tabs [data-tab="learn"].on').count())) { await page.click('#tabs [data-tab="learn"]'); await sleep(300); }
  if (await tc(() => !!window.__tc.sessions.learn.co)) { await page.click('#tabs [data-tab="play"]'); await page.click('#tabs [data-tab="learn"]'); }
  const nx = await tc(() => { const n = window.__tc.courseNext(); return n && n.step.t; });
  check(nx === 'Check and checkmate', 'with the pieces learnt and a coordinates score of 9, the next step is "Check and checkmate": ' + nx);
  // a finished game against the computer is recorded (lost on time here)
  await page.click('#tabs [data-tab="play"]'); await sleep(300);
  await page.click('[data-act="new"]'); await sleep(300); await page.click('#ngKind [data-k="cpu"]'); await page.click('#ngColor [data-c="w"]'); await page.click('#ngTc [data-tc="3+2"]'); await page.click('#ngGo'); await sleep(500);
  const box = await page.locator('#board').boundingBox(), SQ = box.width / 8;
  await page.mouse.click(box.x + 4.5 * SQ, box.y + 6.5 * SQ); await sleep(120); await page.mouse.click(box.x + 4.5 * SQ, box.y + 4.5 * SQ);
  await waitFor(() => tc(() => window.__tc.sessions.play.game.moves.length === 2), 12000);
  await tc(() => { const c = window.__tc.sessions.play.clock; c.w = 300; c.t0 = performance.now(); });
  await waitFor(() => tc(() => !!window.__tc.sessions.play.over), 5000);
  check(await tc(() => { const g = window.__tc.gameLog; return g.length === 1 && g[0].res === 'loss'; }), 'a finished game against the computer is recorded (a loss on time)');
  check(!errs.length, errs.length ? 'errors: ' + errs.slice(0, 5).join(' | ') : 'no errors');
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  await b.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
