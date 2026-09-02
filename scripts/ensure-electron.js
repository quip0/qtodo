// npm's bundled unzip silently drops the symlinks inside Electron.app's
// Frameworks directory, leaving a bundle whose main binary can't resolve
// @rpath/Electron Framework — the app then dies at launch with a dyld error
// and `electron` reports "failed to install correctly".
//
// The downloaded zip itself is fine, so repair by re-extracting it with ditto,
// which handles macOS bundle symlinks properly. build.js runs this every launch
// so a bad `npm install` fixes itself instead of needing this done by hand.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ELECTRON = path.join(__dirname, '..', 'node_modules', 'electron');
const DIST = path.join(ELECTRON, 'dist');
const APP = path.join(DIST, 'Electron.app');
const FRAMEWORKS = path.join(APP, 'Contents', 'Frameworks', 'Electron Framework.framework');
const PATH_TXT = path.join(ELECTRON, 'path.txt');

function version() {
  try {
    return require(path.join(ELECTRON, 'package.json')).version;
  } catch { return null; }
}

// The cache is keyed by an opaque hash, so search it for the right zip name.
function cachedZip(ver) {
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'electron');
  const name = `electron-v${ver}-darwin-${process.arch}.zip`;
  let dirs;
  try { dirs = fs.readdirSync(cache); } catch { return null; }
  for (const d of dirs) {
    const zip = path.join(cache, d, name);
    if (fs.existsSync(zip)) return zip;
  }
  return null;
}

function ensureElectron() {
  if (process.platform !== 'darwin') return;
  if (fs.existsSync(FRAMEWORKS) && fs.existsSync(PATH_TXT)) return;

  const ver = version();
  if (!ver) return;
  const zip = cachedZip(ver);
  if (!zip) {
    console.error(`ensure-electron: Electron ${ver} is incomplete and no cached zip was found; run npm install`);
    return;
  }

  console.log('ensure-electron: Electron.app is incomplete, re-extracting');
  try {
    fs.rmSync(DIST, { recursive: true, force: true });
    fs.mkdirSync(DIST, { recursive: true });
    execFileSync('ditto', ['-x', '-k', zip, DIST], { stdio: 'pipe' });
    fs.writeFileSync(PATH_TXT, 'Electron.app/Contents/MacOS/Electron');
  } catch (err) {
    console.error('ensure-electron: re-extract failed:', err.message);
    return;
  }

  if (!fs.existsSync(FRAMEWORKS)) {
    console.error('ensure-electron: still incomplete after re-extract');
  }
}

if (require.main === module) ensureElectron();
module.exports = ensureElectron;
