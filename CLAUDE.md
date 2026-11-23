# Timber Chess: notes for anyone (human or AI) working on this repo

A free, offline-first chess app for a family, from total beginners to strong players.
Live at https://devvenom-byte.github.io/timber-chess/ (GitHub Pages serves the `main` branch as-is;
there is no build step for the app). It may later be packaged for the app stores, so it must stay
self-contained: no CDNs, no trackers, no ads.

## Ground rules
- Work only inside this repository. Do not touch, push to, or change settings of any other repository.
- Do not run `gh auth login`, create or change keys/tokens, or change global git config.
  Never write tokens or secrets into files, commits or notes.
- Ask the owner before anything hard to undo (deleting data, force-pushing, changing database rules).
- Explain changes in plain language: the owner is not a programmer and is learning.

## How the app is built
- `index.html`: almost the whole app (HTML, CSS, JS in one IIFE). Main areas, searchable by their
  `/* ===== name ===== */` banners: engine, sessions, rendering, drag & tap, optional 3D board,
  game review, puzzles, themed puzzles, lessons, endgame tablebase, coordinates trainer, the course
  (a guided path), progress and badges, openings encyclopedia, family games (Firebase), sheets.
- Progress lives only in `localStorage` (keys prefixed `timber.`). Validate anything read back from it.
- `board3d.js` + `vendor/three.module.min.js`: the optional 3D board, loaded only when switched on.
- `puzzles/v1/*.json`: themed puzzle data from the Lichess puzzle database (CC0), built by
  `npm run build:puzzles` (see the header of `tools/build-puzzles.mjs`). Never rebuild into an
  existing version folder: make `v2`, point `PUZZLE_DATA` at it and bump `CACHE` in `sw.js`.
- `sw.js`: offline cache. Pages are network-first; other files cache-first. **Bump `CACHE` whenever
  any non-page file changes** (board3d.js, vendor/, fonts/, privacy.html, puzzle data).
- Family games use Firebase Realtime Database over REST + EventSource (no SDK). The security rules
  live in the Firebase console and are checked by `tests/rules.test.js`.
- Content Security Policy is a `<meta>` tag in `index.html`: only this site and the Firebase host.
  Anything new from elsewhere must be bundled instead.
- `window.__tc` is a read-only handle for the tests. Data shown in HTML goes through `esc()`.

## Workflow
1. Explore the relevant code, then plan; keep changes small and focused.
2. Every feature gets (or updates) a browser test in `tests/` that plays it like a user.
3. `npm install` once, then `npm test` (local copy) before every commit. `npm run test:family`
   also exercises family games against the real database (test games only).
4. One commit per feature with a clear message. After pushing, `npm run test:live` checks the
   published site, including the offline cache (which only runs over https).
5. At milestones, get an independent review (security, chess content) before publishing.
