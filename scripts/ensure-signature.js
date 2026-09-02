// Electron.app in node_modules ships ad-hoc signed. Anything that mutates the
// bundle (npm reinstall, electron-rebuild, a stray codesign) can leave the seal
// inconsistent with its contents — macOS then kills Electron with SIGTRAP and
// shows "Electron has been blocked ... may harm your privacy and security", so
// the launcher appears to silently do nothing.
//
// Re-signing repairs it, but only until the next thing touches the bundle.
// build.js runs this on every launch so the repair is applied automatically
// instead of by hand.

const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const APP = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app');

function isValid() {
  // --deep so a broken helper or framework seal counts as invalid too (~0.2s).
  return spawnSync('codesign', ['--verify', '--deep', '--strict', APP]).status === 0;
}

function ensureSignature() {
  if (process.platform !== 'darwin') return;
  if (isValid()) return;

  console.log('ensure-signature: Electron.app signature is invalid, re-signing');
  try {
    // Quarantine alone also triggers the block dialog; clear it either way.
    spawnSync('xattr', ['-dr', 'com.apple.quarantine', APP]);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', APP], { stdio: 'pipe' });
  } catch (err) {
    console.error('ensure-signature: re-signing failed:', err.message);
    return;
  }

  if (!isValid()) {
    console.error('ensure-signature: still invalid after re-signing; Electron may refuse to launch');
  }
}

if (require.main === module) ensureSignature();
module.exports = ensureSignature;
