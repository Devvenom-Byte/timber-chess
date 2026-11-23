const path = require('path');
const { chromium } = require('playwright-core');
const { EDGE } = require('./browser');
const URL = process.argv[2] || 'http://127.0.0.1:8765/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle' }); await sleep(500);
  await page.evaluate(() => Object.assign(window, window.__tc));
  // 1. every line legal, unique ids, keys within line, every entry reachable by its own key, names resolve to themselves
  const v = await page.evaluate(() => {
    const ids = new Set(), dup = [], keyBad = [], selfBad = [], drillBad = [], sanBad = [];
    for (const b of OPENING_BOOK) {
      if (ids.has(b.id)) dup.push(b.id); ids.add(b.id);
      if (b.key > b.uci.length) keyBad.push(b.id);
      const e = openingEntry(b.uci.slice(0, b.key)); if (e !== b) selfBad.push(b.id + '->' + (e && e.id));
      if (b.drill && !b.drillOp) drillBad.push(b.id);
      const E = EngineFactory(); E.loadUci(START, []);
      b.uci.forEach((u, i) => { const m = E.fromUci(u); const s = E.san(m).replace(/[+#]/g, ''); if (s !== b.sans[i].replace(/[+#]/g, '')) sanBad.push(b.id + ':' + i + ':' + s + '/' + b.sans[i]); E.make(m); });
    }
    return { n: OPENING_BOOK.length, bad: BOOK_BAD, dup, keyBad, selfBad, drillBad, sanBad };
  });
  check(v.bad.length === 0 && v.sanBad.length === 0, `all ${v.n} opening lines are legal ${JSON.stringify(v.bad)} ${v.sanBad.slice(0, 5)}`);
  check(!v.dup.length && !v.keyBad.length && !v.drillBad.length, `ids unique, keys inside lines, practice links valid ${JSON.stringify([v.dup, v.keyBad, v.drillBad])}`);
  check(!v.selfBad.length, `every opening's own moves show its own name ${JSON.stringify(v.selfBad)}`);
  // 2. names for typical games
  const names = await page.evaluate(() => {
    const t = l => { const E = EngineFactory(); E.loadUci(START, []); const u = []; for (const s of l.split(' ')) { const m = E.fromSan ? E.fromSan(s) : null; if (!m) break; u.push(E.uci(m)); E.make(m); } const e = openingEntry(u); return e ? e.name : null; };
    return { bird: t('f4'), birdLater: t('f4 d5 Nf3 Nf6 e3'), from: t('f4 e5'), najdorf: t('e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be2'), london2: t('d4 Nf6 Bf4'), leningrad: t('d4 f5 c4 Nf6 g3 g6'), qgd: t('d4 d5 c4 e6 Nf3') };
  });
  console.log('      names:', JSON.stringify(names));
  check(names.bird === "Bird's Opening" && names.birdLater === "Bird's Opening" && names.from === "Bird's: From's Gambit" && names.najdorf === 'Sicilian: Najdorf' && names.london2 === 'London System' && names.leningrad === 'Dutch: Leningrad' && names.qgd === "Queen's Gambit Declined", 'opening names recognised correctly');
  // 3. the reported flow: play 1.f4 vs computer, tap the label, read Bird's Opening
  const r = await page.locator('#board').boundingBox(); const S = r.width / 8;
  const tap = async sq => { await page.mouse.click(r.x + (sq.charCodeAt(0) - 97 + .5) * S, r.y + (8 - +sq[1] + .5) * S); await sleep(220); };
  await page.click('[data-act="new"]'); await sleep(300); await page.click('#ngKind [data-k="local"]').catch(() => {}); await sleep(150); await page.click('#ngGo'); await sleep(500);
  await tap('f2'); await tap('f4'); await sleep(500);
  const lab = await page.locator('#panel button.op').innerText().catch(() => '');
  check(/Bird/.test(lab), 'label shows Bird\'s Opening after 1.f4: "' + lab + '"');
  await page.click('#panel button.op'); await sleep(400);
  const pg = (await page.locator('#sheet').innerText()).replace(/\s+/g, ' ');
  check(/Bird's Opening/.test(pg) && /A02/.test(pg) && /Key ideas/i.test(pg) && /From's Gambit/.test(pg), 'tapping it opens the Bird\'s Opening page (with From\'s Gambit listed)');
  await page.screenshot({ path: path.join(__dirname, 'output', 'bk-page.png') });
  await page.click('#bkGo'); await sleep(900);
  check(await page.evaluate(() => sessions.openings.op && sessions.openings.op.name === "Bird's Opening" && document.querySelector('#tabs [data-tab="openings"]').classList.contains('on')), 'Practise it starts the Bird\'s line in the Openings tab');
  // 4. openings list + search
  await page.click('#panel [data-act="oplist"]'); await sleep(400);
  const groups = await page.locator('#sheet h4').count();
  check(groups >= 10, 'openings list grouped (' + groups + ' sections)');
  await page.screenshot({ path: path.join(__dirname, 'output', 'bk-list.png') });
  await page.fill('#opQ', 'najdorf'); await sleep(200);
  check(/Najdorf/.test(await page.locator('#opRes').innerText()), 'searching "najdorf" finds it');
  await page.fill('#opQ', 'B90'); await sleep(200);
  check(/Najdorf/.test(await page.locator('#opRes').innerText().then(t => t.split('\n').slice(0, 3).join(' '))), 'searching ECO "B90" finds Najdorf first');
  await page.fill('#opQ', '1.f4'); await sleep(200);
  check(/Bird/.test((await page.locator('#opRes').innerText()).split('\n')[0]), 'searching "1.f4" finds Bird\'s first');
  await page.click('#sheet .xbtn'); await sleep(300);
  // 5. global search
  await page.click('#btnSearch'); await sleep(450);
  const q = async (t, re, what) => { await page.fill('#srQ', t); await sleep(200); const first = (await page.locator('#srRes .item').first().innerText().catch(() => '')).replace(/\s+/g, ' '); check(re.test(first), `search "${t}" → ${what}: ${first.slice(0, 70)}`); };
  await q('bird', /Bird/, "Bird's Opening");
  await q('morphy', /Opera Game/, 'Opera Game');
  await q('fork', /Forks puzzles/i, 'Forks puzzle theme');
  { const top = (await page.locator('#srRes .item').allInnerTexts()).slice(0, 4).join(' '); check(/tactic/i.test(top), 'search "fork" also lists the tactics reading near the top'); }
  await q('smothered', /Smothered/, 'puzzle');
  await q('castling', /special|castl/i, 'lesson or reading');
  await q('marble', /piece colours/i, 'settings');
  await page.screenshot({ path: path.join(__dirname, 'output', 'bk-search.png') });
  await page.fill('#srQ', 'morphy'); await sleep(200); await page.click('#srRes .item'); await sleep(600);
  check(await page.evaluate(() => sessions.learn.fg && sessions.learn.fg.id === 'opera'), 'tapping a search result opens it');
  check(!errs.length, errs.length ? 'errors: ' + errs.slice(0, 5).join(' | ') : 'no errors or warnings');
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  await b.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
