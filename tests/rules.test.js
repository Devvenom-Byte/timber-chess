// Checks the published database rules: the app's own writes work, abuse is refused. Only touches test games it creates.
const DB = 'https://timber-chess-default-rtdb.europe-west1.firebasedatabase.app';
let fails = 0; const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails++; };
const put = async (p, v) => (await fetch(`${DB}/games/${p}.json`, { method: 'PUT', body: JSON.stringify(v) })).status;
const del = async p => (await fetch(`${DB}/games/${p}.json`, { method: 'DELETE' })).status;
const get = async p => (await fetch(`${DB}/games/${p}.json`)).json();
const gid = () => 'zt' + Math.random().toString(36).slice(2, 10);
(async () => {
  const A = 'ctesta' + Date.now().toString(36), B = 'ctestb' + Date.now().toString(36), X = 'cintruder99';
  // rules active? a bare "v" write on a new game is refused by the new rules (old rules allowed it)
  const g0 = gid(); const s0 = await put(g0 + '/v', 2);
  check(s0 === 401 || s0 === 403, `new rules are live (incomplete game refused: ${s0})`);
  if (s0 === 200) await del(g0);
  // the app's normal flow
  const g = gid();
  check(await put(g, { creator: A, v: 2, created: { '.sv': 'timestamp' }, names: { [A]: 'Mum' }, white: A }) === 200, 'create game (as the app does)');
  check(await put(g + '/black', B) === 200, 'friend takes the free seat');
  check(await put(g + '/black', X) !== 200, 'nobody can steal a taken seat');
  check(await put(g + '/names/' + B, 'Alex') === 200, 'friend sets their name');
  check(await put(g + '/seen/' + A, { '.sv': 'timestamp' }) === 200 && await put(g + '/seen/' + B, 0) === 200, 'online/offline notes');
  check(await put(g + '/moves/0', 'e2e4') === 200 && await put(g + '/moves/1', 'e7e5') === 200, 'moves');
  check(await put(g + '/moves/0', 'd2d4') !== 200, 'a move cannot be changed');
  check(await put(g + '/drawOffers/w', 2) === 200, 'draw offer');
  check(await put(g + '/react', { by: A, e: '❤️', n: 1 }) === 200 && await put(g + '/react', { by: B, e: '👍', n: 2 }) === 200, 'reactions (❤️ and 👍)');
  // abuse
  check(await put(g + '/react', { by: A, e: '<img src=x>', n: 3 }) !== 200, 'junk reaction refused');
  check(await put(g + '/react', { by: A, e: '👍', n: 3, junk: 'x'.repeat(1000) }) !== 200, 'extra reaction data refused');
  check(await put(g + '/react/__proto__', { x: 1 }) !== 200, '__proto__ trick refused');
  check(await put(g + '/names/' + X, 'Hacker') !== 200, 'outsider cannot add a name');
  check(await put(g + '/seen/' + X, 1) !== 200, 'outsider cannot add presence data');
  check(await put(g + '/junk', 'x') !== 200, 'unknown fields refused');
  check(await del(g) !== 200, 'a game in progress cannot be deleted');
  check(await put(g + '/resigned', 'b') === 200, 'resign');
  check(await put(g + '/resigned', 'w') !== 200, 'resignation cannot be undone');
  const final = await get(g);
  check(final && final.moves && final.moves.length === 2 && final.resigned === 'b' && final.names[B] === 'Alex', 'game data intact');
  // invite cancel
  const g2 = gid();
  await put(g2, { creator: A, v: 2, created: { '.sv': 'timestamp' }, names: { [A]: 'Mum' }, black: A });
  check(await put(g2 + '/moves/0', 'e2e4') !== 200, 'no moves before both players joined');
  check(await del(g2) === 200 && (await get(g2)) === null, 'unjoined invite can be cancelled (deleted)');
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  console.log('(test game left finished in DB: ' + g + ')');
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
