// Which installed browser the tests drive (playwright-core does not download one).
// Override with CHROME_PATH=/path/to/chrome-or-edge.
const fs = require('fs');
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium',
];
const EDGE = CANDIDATES.find(p => p && fs.existsSync(p));
if (!EDGE) throw new Error('No Chrome or Edge found. Set CHROME_PATH to a Chromium-based browser.');
module.exports = { EDGE };
