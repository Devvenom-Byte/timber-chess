// Tests "Join with code": guest opens the app normally (no link), pastes the invite, game connects.
const path = require('path');
const { chromium } = require('playwright-core');
const { EDGE } = require('./browser');
const URL = process.argv[2] || 'http://127.0.0.1:8765/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails++; };
async function waitFor(fn, ms = 30000, step = 150) { const s = Date.now(); while (Date.now() - s < ms) { try { if (await fn()) return Date.now() - s; } catch (e) { } await sleep(step); } return -1; }

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const problems = [];
  const mk = async (label) => {
    const ctx = await browser.newContext({ viewport: { width: 380, height: 840 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('pageerror', e => problems.push(`[${label}] ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') problems.push(`[${label}] console: ${m.text().slice(0, 150)}`); });
    return p;
  };
  const panel = async p => (await p.locator('#panel').innerText()).replace(/\s+/g, ' ');

  // host creates a game
  const host = await mk('host');
  await host.goto(URL, { waitUntil: 'load' });
  await host.click('#tabs [data-tab="family"]');
  await waitFor(async () => host.locator('#nameIn').isVisible());
  await host.fill('#nameIn', 'Mum'); await host.click('#nameGo'); await sleep(300);
  check(await host.locator('#lbJoin').isVisible(), 'lobby shows "Join with code" button');
  await host.screenshot({ path: path.join(__dirname, 'output', 'j1-lobby.png') });
  await host.click('#lbNew'); await sleep(300); await host.click('#fc [data-c="w"]');
  const sheet = await host.locator('#sheet').innerText();
  const gid = (sheet.match(/\?g=([a-z0-9]+)/) || [])[1];
  check(/Join with code/.test(sheet), 'invite card tells app users about Join with code');
  await waitFor(async () => /🟢 Ready/.test(await host.locator('#sheet').innerText()));
  await host.screenshot({ path: path.join(__dirname, 'output', 'j2-invite.png') });
  await host.click('#sheet .xbtn');

  // guest A: opens the app WITHOUT the link, uses the Family tab button, pastes the whole WhatsApp message
  const guest = await mk('guest');
  await guest.goto(URL, { waitUntil: 'load' });
  await guest.click('#tabs [data-tab="family"]');
  await waitFor(async () => guest.locator('#nameIn').isVisible());
  await guest.fill('#nameIn', 'Alex'); await guest.click('#nameGo'); await sleep(400);
  await guest.click('#sheet .xbtn'); await sleep(300);                         // close lobby, use the panel button
  check(/Join with code/.test(await panel(guest)), 'Family tab shows "Join with code" button');
  await guest.click('[data-act="famjoin"]'); await sleep(300);
  // bad input first
  await guest.fill('#joinIn', 'hello there'); await guest.click('#joinGo'); await sleep(300);
  check(await guest.locator('#joinIn').isVisible() && /doesn.t look like an invite/.test(await guest.locator('#toast').innerText()), 'nonsense text is rejected with a helpful message');
  const whatsapp = `Mum wants to play chess with you. Tap to join (or copy this link, open Timber Chess, go to Family → Join with code and paste it): https://devvenom-byte.github.io/timber-chess/?g=${gid}`;
  await guest.fill('#joinIn', whatsapp);
  await guest.screenshot({ path: path.join(__dirname, 'output', 'j3-join-sheet.png') });
  await guest.click('#joinGo');
  const t = await waitFor(async () => /Waiting for Mum|Your move/.test(await panel(guest)));
  check(t >= 0, `guest joined by pasting the whole message (${t} ms)`);
  check(await waitFor(async () => /Your move/.test(await panel(host))) >= 0, 'host sees the guest joined');
  check(!/\?g=/.test(await guest.evaluate(() => location.href)), 'guest stayed on the normal app address (no link opened)');
  await guest.screenshot({ path: path.join(__dirname, 'output', 'j4-joined.png') });

  // guest B: bare 8-letter code works too
  const host2 = await mk('host2');
  await host2.goto(URL, { waitUntil: 'load' }); await host2.click('#tabs [data-tab="family"]');
  await waitFor(async () => host2.locator('#nameIn').isVisible()); await host2.fill('#nameIn', 'Dad'); await host2.click('#nameGo'); await sleep(300);
  await host2.click('#lbNew'); await sleep(300); await host2.click('#fc [data-c="b"]');
  const gid2 = ((await host2.locator('#sheet').innerText()).match(/\?g=([a-z0-9]+)/) || [])[1];
  await waitFor(async () => /🟢 Ready/.test(await host2.locator('#sheet').innerText()));
  const g2 = await mk('guest2');
  await g2.goto(URL, { waitUntil: 'load' }); await g2.click('#tabs [data-tab="family"]');
  await waitFor(async () => g2.locator('#nameIn').isVisible()); await g2.fill('#nameIn', 'Sam'); await g2.click('#nameGo'); await sleep(400);
  await g2.click('#lbJoin'); await sleep(300);
  await g2.fill('#joinIn', '  ' + gid2.toUpperCase() + ' '); await g2.press('#joinIn', 'Enter');
  check(await waitFor(async () => /Waiting for Dad|Your move/.test(await panel(g2))) >= 0, `bare code "${gid2.toUpperCase()}" (any case, spaces) joins too`);

  check(problems.length === 0, problems.length ? 'errors:\n  ' + problems.join('\n  ') : 'no console errors');
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  await browser.close();
})().catch(e => { console.error('TEST CRASHED:', e.message); process.exit(1); });
