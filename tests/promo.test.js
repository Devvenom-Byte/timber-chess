// Reproduce pawn promotion in a 2-player game: node promo.js <url>
const path = require('path');
const { chromium } = require('playwright-core');
const { EDGE } = require('./browser');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 380, height: 840 } });
  page.on('pageerror', e => console.log('page error: ' + e.message));
  await page.goto(process.argv[2], { waitUntil: 'networkidle' }); await sleep(600);
  const sqCenter = async (sq) => { const r = await page.locator('#board').boundingBox(); const S = r.width / 8; const f = sq.charCodeAt(0) - 97, rk = +sq[1]; return [r.x + (f + .5) * S, r.y + (8 - rk + .5) * S]; };
  const tap = async (sq) => { const [x, y] = await sqCenter(sq); await page.mouse.click(x, y); await sleep(250); };
  await page.click('[data-act="new"]'); await sleep(300);
  await page.click('#ngKind [data-k="local"]'); await sleep(200);
  await page.click('#ngGo'); await sleep(600);
  for (const u of ['h2h4', 'g7g5', 'h4g5', 'g8f6', 'g5f6', 'h8g8', 'f6e7', 'g8g6']) { await tap(u.slice(0, 2)); await tap(u.slice(2, 4)); await sleep(300); }
  await tap('e7'); await tap('f8');
  console.log('promotion picker shown:', await page.locator('#promo').isVisible());
  await page.click('#promo [data-p="q"]'); await sleep(600);
  const mv = (await page.locator('#mlist').innerText()).replace(/\s+/g, ' ');
  console.log('picker still open after choosing queen:', await page.locator('#promo').isVisible());
  console.log('moves:', mv);
  console.log(/=Q/.test(mv) ? 'PASS pawn promotes to a queen\n\nALL PASSED' : 'FAIL pawn promotion is broken\n\n1 FAILED');
  await browser.close();
})();
