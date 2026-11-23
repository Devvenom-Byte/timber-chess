const path = require('path');
const { chromium } = require('playwright-core');
const { EDGE } = require('./browser');
const URL = process.argv[2] || 'http://127.0.0.1:8765/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle' }); await sleep(500); await page.evaluate(() => Object.assign(window, window.__tc));
  // 1. data validation inside the real app
  const v = await page.evaluate(() => {
    const out = [];
    for (const g of FAMOUS) {
      const E = EngineFactory(); E.loadUci(START, []); const mism = [];
      g.uci.forEach((u, i) => { const m = E.fromUci(u); const s = E.san(m); if (s.replace(/[+#]/g, '') !== g.sans[i].replace(/[+#!?]/g, '')) mism.push(i + ':' + s + '/' + g.sans[i]); E.make(m); });
      const badNotes = Object.keys(g.notes).filter(k => { const n = parseInt(k, 10), i = 2 * (n - 1) + (k.endsWith('...') ? 1 : 0); return i >= g.uci.length; });
      const guessWrongSide = g.guessAt.map((x, i) => x && ((i % 2 ? 'b' : 'w') !== g.hero) ? i : null).filter(x => x !== null);
      const noteMismatch = g.guessAt.map((x, i) => { if (!x) return null; const t = g.noteAt[i]; const first = (g.markAt[i] || '').replace(/[!?]/g, ''); return g.sans[i].replace(/[+#]/g, '') === first.replace(/[+#]/g, '') ? null : i + ':' + g.sans[i] + ' vs note "' + t.slice(0, 20) + '"'; }).filter(Boolean);
      out.push({ id: g.id, parsed: g.uci.length, written: g.sans.length, final: E.status(), lastSan: g.sans[g.sans.length - 1], mism, badNotes, guessWrongSide, noteMismatch });
    }
    return out;
  });
  for (const g of v) {
    check(g.parsed === g.written && g.mism.length === 0, `${g.id}: all ${g.written} moves legal and match (${g.parsed} parsed)${g.mism.length ? ' MISMATCH ' + g.mism.join(',') : ''}`);
    check(g.lastSan.includes('#') ? g.final === 'checkmate' : true, `${g.id}: ends in ${g.final}`);
    check(!g.badNotes.length && !g.guessWrongSide.length && !g.noteMismatch.length, `${g.id}: notes line up with moves ${JSON.stringify([g.badNotes, g.guessWrongSide, g.noteMismatch])}`);
  }
  // 2. UI flow
  const panel = async () => (await page.locator('#panel').innerText()).replace(/\s+/g, ' ');
  await page.click('#tabs [data-tab="learn"]'); await sleep(300);
  const hub = await panel();
  check(/Lessons for beginners/.test(hub) && /Famous games/.test(hub) && /Readings/.test(hub), 'Learn tab shows Lessons, Famous games and Readings');
  await page.screenshot({ path: path.join(__dirname, 'output', 'fam-hub.png') });
  await page.click('#panel [data-act="fglist"]'); await sleep(350);
  await page.screenshot({ path: path.join(__dirname, 'output', 'fam-list.png') });
  await page.click('[data-fg="0"]'); await sleep(500);
  check(/Opera Game/.test(await panel()) && /Morphy/.test(await page.locator('#stripBottom').innerText()), 'Opera Game opens with Morphy at the bottom');
  const r = await page.locator('#board').boundingBox(); const S = r.width / 8;
  const tap = async sq => { await page.mouse.click(r.x + (sq.charCodeAt(0) - 97 + .5) * S, r.y + (8 - +sq[1] + .5) * S); await sleep(200); };
  for (let i = 0; i < 12 && !/what did Morphy play/.test(await panel()); i++) { await page.click('#panel [data-act="fgnext"]'); await sleep(320); }
  check(/what did Morphy play/.test(await panel()) && (await page.evaluate(() => sessions.learn.game.moves.length)) === 10, 'game pauses at 6. Bc4 and asks for the master move');
  await page.screenshot({ path: path.join(__dirname, 'output', 'fam-guess.png') });
  await tap('f1'); await tap('d3'); await sleep(400);
  check(/Not the move/.test(await panel()), 'wrong guess gets "not the move" feedback');
  await sleep(1400);
  check((await page.evaluate(() => sessions.learn.game.moves.length)) === 10, 'wrong move taken back');
  await tap('f1'); await tap('c4'); await sleep(500);
  check(/Bc4/.test(await panel()) && /That.s it|Yes!/.test(await panel()), 'right guess accepted: ' + (await panel()).slice(0, 120));
  await page.click('#panel [data-act="fgnext"]'); await sleep(350);
  if (/Show me/.test(await panel())) { await page.click('#panel [data-act="fgnext"]'); await sleep(400); }
  check(/Morphy played|Qb3/.test(await panel()), 'Show me reveals the master move');
  await page.click('#panel [data-act="fgguess"]'); await sleep(200);
  for (let i = 0; i < 40; i++) { const d = await page.$eval('#panel [data-act="fgnext"]', x => x.disabled).catch(() => true); if (d) break; await page.click('#panel [data-act="fgnext"]'); await sleep(120); }
  const fin = await panel();
  check(/End of the game/.test(fin) && /Rd8#/.test(fin), 'played through to 17. Rd8# checkmate');
  await page.screenshot({ path: path.join(__dirname, 'output', 'fam-end.png') });
  await page.click('#mlist [data-i="5"]'); await sleep(300);
  check((await page.evaluate(() => sessions.learn.game.moves.length)) === 5, 'tapping a move in the list jumps there');
  await page.click('#panel [data-act="fgstart"]'); await sleep(300);
  check((await page.evaluate(() => sessions.learn.game.moves.length)) === 0, 'back to start works');
  await page.click('#panel [data-act="fglist"]'); await sleep(300); await page.click('[data-fg="5"]'); await sleep(400);
  check(await page.evaluate(() => sessions.learn.orientation === 'b'), 'Fischer game shows the board from Black side');
  // Readings
  await page.evaluate(() => openReadings()); await sleep(350);
  await page.screenshot({ path: path.join(__dirname, 'output', 'fam-readings.png') });
  await page.click('[data-rd="0"]'); await sleep(350);
  check(/golden rules/i.test(await page.locator('#sheet').innerText()), 'reading opens');
  await page.screenshot({ path: path.join(__dirname, 'output', 'fam-article.png') });
  await page.click('#rdNext'); await sleep(300);
  check(/think before every move/i.test(await page.locator('#sheet').innerText()), 'Next goes to the next reading');
  await page.click('#rdBack'); await sleep(300);
  check(/✓ Read/.test(await page.locator('#sheet').innerText()), 'read articles get a tick');
  await page.click('#sheet .xbtn'); await sleep(300);
  await page.evaluate(() => { sessions.learn.fg = null; renderAll(); }); await sleep(200);
  await page.click('#panel [data-act="lsnext"]'); await sleep(400);
  check(/lesson \d+ of/.test(await panel()), 'beginner lessons still start');
  check(!errs.length, errs.length ? 'errors: ' + errs.join(' | ') : 'no errors');
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  await b.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
