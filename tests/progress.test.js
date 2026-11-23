// Progress page, day streak and badges.
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
  const toast = () => page.locator('#toast').innerText().catch(() => '');

  // a new player: nothing earned yet
  await page.click('#btnProgress'); await sleep(300);
  let sheet = await page.locator('#sheet').innerText();
  check(/Your progress/.test(sheet) && await page.locator('#sheet .badge').count() === 22 && await page.locator('#sheet .badge.got').count() === 0 && /Next up/i.test(sheet) && /More to discover \(19\)/.test(sheet), 'Progress page: 22 badges, none earned yet; 3 shown as Next up, the rest folded away');
  check(/0\/9/.test(sheet) && /Saved on this device only/.test(sheet), 'stats show 0 of 9 lessons; data stays on the device');
  await page.click('#sheet .xbtn'); await sleep(300);

  // a move marks today as active
  const box = await page.locator('#board').boundingBox(), SQ = box.width / 8;
  await page.click('[data-act="new"]'); await sleep(300); await page.click('#ngKind [data-k="local"]'); await page.click('#ngGo'); await sleep(500);
  await page.mouse.click(box.x + 4.5 * SQ, box.y + 6.5 * SQ); await sleep(120); await page.mouse.click(box.x + 4.5 * SQ, box.y + 4.5 * SQ); await sleep(400);
  check(await tc(() => window.__tc.stats().streak === 1), 'making a move counts today: 1-day streak');

  // earlier progress (made before badges existed) earns its badges on start-up, announced once
  await tc(() => {
    const d = n => { const x = new Date(); x.setDate(x.getDate() - n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    localStorage.setItem('timber.learnDone', JSON.stringify({ pawn: 1, rook: 1 }));
    localStorage.setItem('timber.days', JSON.stringify([d(6), d(5), d(4), d(3), d(2), d(1), d(0)]));
  });
  await page.reload({ waitUntil: 'networkidle' });
  check(await waitFor(async () => /badges/.test(await toast()), 6000) >= 0, 'on start-up, earlier progress earns badges: ' + await toast());
  check(await tc(() => !!window.__tc.badgesGot.lesson1 && !!window.__tc.badgesGot.week && window.__tc.stats().streak === 7), '"First lesson" and "Regular" (7 days in a row) earned');
  await page.reload({ waitUntil: 'networkidle' }); await sleep(3200);
  check(!/badge/i.test(await toast()) || !(await page.locator('#toast.on').count()), 'badges are not announced twice');

  // earning one live: score 15 in the coordinates game
  await tc(() => window.__tc.startCoords()); await sleep(300); await page.click('[data-act="costart"]'); await sleep(200);
  for (let k = 0; k < 15; k++) { const t = await tc(() => window.__tc.sessions.learn.co.target); await tc(t => window.__tc.coAnswer(t), t); }
  await tc(() => { window.__tc.sessions.learn.co.end = performance.now() + 30; }); await sleep(300);
  check(await waitFor(async () => /Sharp eye/.test(await toast()), 4000) >= 0, 'scoring 15 in coordinates shows "🏅 New badge: Sharp eye"');
  await page.click('#btnProgress'); await sleep(300);
  sheet = await page.locator('#sheet').innerText(); const allText = await page.locator('#sheet').textContent(); // folded badges are hidden from innerText
  console.log('  (earned: ' + await page.locator('#sheet .badge.got').count() + ', ' + (sheet.match(/Your badges[^\n]*/i) || ['no heading'])[0] + ')');
  check(await page.locator('#sheet .badge.got').count() === 3 && /Your badges · 3 of 22/i.test(sheet) && /7 days in a row/.test(sheet) && /\d+ \/ 5/.test(allText), 'Progress page: 3 badges earned (shown first), 7-day streak, progress on locked badges (e.g. 0 / 5)');
  await page.screenshot({ path: path.join(__dirname, 'output', 'progress.png'), fullPage: false });
  await page.click('#pgPath'); await sleep(500);
  check(/Your chess path/.test(await page.locator('#sheet').innerText()), 'Progress links to the chess path');
  check(!errs.length, errs.length ? 'errors: ' + errs.slice(0, 5).join(' | ') : 'no errors');
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  await b.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
