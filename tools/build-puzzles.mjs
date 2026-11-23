// Builds the themed puzzle packs in puzzles/v1/ from the Lichess puzzle database (CC0, public domain):
// https://database.lichess.org/#puzzles
//
//   node tools/build-puzzles.mjs            (needs Node 22.15+ for zstd; takes a few minutes)
//
// It streams the compressed CSV, keeps well-tested popular puzzles for each theme and difficulty band,
// checks every move with the app's own chess engine (copied out of index.html), then writes one small
// JSON file per theme plus an index. The app loads a theme's file only when someone opens that theme.
// To change the collection: edit THEMES / BANDS / PER_BAND below, bump VERSION (new folder = no stale
// caches), update PUZZLE_DATA in index.html to the new folder, and bump CACHE in sw.js so old files are
// cleared from phones. Never rebuild into an existing version folder. Review the JSON in `git diff`.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable, Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const VERSION = 'v1';
const OUT = path.join(ROOT, 'puzzles', VERSION);
const THEMES = ['mateIn1', 'hangingPiece', 'fork', 'pin', 'skewer', 'discoveredAttack', 'backRankMate', 'mateIn2',
  'mateIn3', 'promotion', 'trappedPiece', 'deflection', 'sacrifice', 'defensiveMove', 'endgame'];
const BANDS = [['easy', 400, 1250], ['medium', 1250, 1750], ['hard', 1750, 2500]];
const PER_BAND = 45, MAX_ROWS = 4_000_000;

// ---- the app's engine, used to check every puzzle
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const start = html.indexOf('function EngineFactory(');
let depth = 0, end = html.indexOf('{', start);
for (let i = end; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) { end = i + 1; break; } }
const EngineFactory = new Function(html.slice(start, end) + '; return EngineFactory;')();
const eng = EngineFactory();

function valid(fen, moves, themes) {
  try {
    eng.loadUci(fen, []);
    for (const u of moves) { const m = eng.fromUci(u); if (!m) return false; eng.make(m); }
    const mateTheme = themes.find(t => /^mateIn\d$/.test(t));
    if (mateTheme && eng.status() !== 'checkmate') return false;
    return true;
  } catch (e) { return false; }
}

const want = new Map(); // "theme|band" -> []
for (const t of THEMES) for (const [b] of BANDS) want.set(`${t}|${b}`, []);
const full = () => [...want.values()].every(a => a.length >= PER_BAND);

const res = await fetch(SRC);
if (!res.ok) throw new Error('download failed: ' + res.status);
// The file starts with zstd 'skippable frames' (seek-table metadata) that Node's decoder rejects: drop them.
let pending = null;
const stripSkippable = new Transform({ transform(chunk, enc, cb) {
  if (pending === 'done') return cb(null, chunk);
  let buf = pending ? Buffer.concat([pending, chunk]) : chunk;
  const isSkip = b => (b.readUInt32LE(0) & 0xFFFFFFF0) === 0x184D2A50;
  while (buf.length >= 8 && isSkip(buf)) { const n = buf.readUInt32LE(4); if (buf.length < 8 + n) break; buf = buf.subarray(8 + n); }
  if (buf.length >= 4 && !isSkip(buf)) { pending = 'done'; return cb(null, buf); }
  pending = buf; cb();
} });
const unzstd = zlib.createZstdDecompress();
const stream = Readable.fromWeb(res.body).pipe(stripSkippable).pipe(unzstd);
let streamError = null; unzstd.on('error', e => { streamError = e; });
const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
let rows = 0, kept = 0, rejected = 0;
for await (const line of rl) {
  if (rows++ === 0) continue; // header: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,...
  const c = line.split(',');
  const [id, fen, mv, rating, dev, pop, plays, th] = [c[0], c[1], c[2], +c[3], +c[4], +c[5], +c[6], (c[7] || '').split(' ')];
  if (dev > 100 || pop < 80 || plays < 300) continue;
  if (!/^[A-Za-z0-9]{5,8}$/.test(id) || !Number.isInteger(rating) || !/^([a-h][1-8]){2}[qrbn]?( ([a-h][1-8]){2}[qrbn]?)*$/.test(mv)) { rejected++; continue; } // strict shape checks
  const band = BANDS.find(([, lo, hi]) => rating >= lo && rating < hi); if (!band) continue;
  const moves = mv.split(' ');
  if (band[0] === 'easy' && moves.length > 6) continue; // short lines for beginners
  const slots = th.filter(t => want.has(`${t}|${band[0]}`) && want.get(`${t}|${band[0]}`).length < PER_BAND);
  if (!slots.length) continue;
  if (!valid(fen, moves, th)) { rejected++; continue; }
  for (const t of slots) want.get(`${t}|${band[0]}`).push([id, fen, mv, rating]);
  kept++;
  if (rows % 200000 === 0) process.stdout.write(`\r${rows} rows read, ${kept} kept`);
  if (full() || rows > MAX_ROWS) break;
}
rl.close(); stream.destroy();
if (streamError && !full() && rows < MAX_ROWS) throw new Error('decompression failed: ' + streamError.message);
if (!full() && rows <= MAX_ROWS) console.warn(`\nWarning: the download ended after ${rows} rows, so some bands have fewer than ${PER_BAND} puzzles.`);
console.log(`\n${rows} rows read, ${kept} kept, ${rejected} failed the engine check`);

fs.mkdirSync(OUT, { recursive: true });
const index = { version: VERSION, source: 'Lichess puzzle database (CC0)', built: new Date().toISOString().slice(0, 10), themes: {} };
for (const t of THEMES) {
  const pack = { theme: t, bands: {} };
  for (const [b] of BANDS) pack.bands[b] = want.get(`${t}|${b}`).sort((a, z) => a[3] - z[3]);
  fs.writeFileSync(path.join(OUT, t + '.json'), JSON.stringify(pack));
  index.themes[t] = Object.fromEntries(BANDS.map(([b]) => [b, pack.bands[b].length]));
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
console.log(Object.entries(index.themes).map(([t, n]) => `${t}: ${Object.values(n).join('/')}`).join('\n'));
