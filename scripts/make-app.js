// Builds ~/Applications/Todo.app — a tiny compiled launcher that chdirs into
// this project and execs Electron. Rerun after moving the project (the path is
// baked into launcher/launch.c) or after changing the icon.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const makeIcon = require('./make-icon');

const PROJ = path.join(__dirname, '..');
const APP = path.join(os.homedir(), 'Applications', 'Todo.app');

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Todo</string>
  <key>CFBundleDisplayName</key><string>Todo</string>
  <key>CFBundleIdentifier</key><string>com.quipo.todo.launcher</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>appicon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;

fs.rmSync(APP, { recursive: true, force: true });
fs.mkdirSync(path.join(APP, 'Contents', 'MacOS'), { recursive: true });
fs.mkdirSync(path.join(APP, 'Contents', 'Resources'), { recursive: true });

fs.writeFileSync(path.join(APP, 'Contents', 'Info.plist'), PLIST);

console.log('make-app: compiling launcher');
execFileSync('clang', [
  '-O2', '-arch', 'arm64', '-arch', 'x86_64',
  '-o', path.join(APP, 'Contents', 'MacOS', 'launch'),
  path.join(PROJ, 'launcher', 'launch.c'),
], { stdio: 'inherit' });

console.log('make-app: drawing icon');
makeIcon(path.join(APP, 'Contents', 'Resources', 'appicon.icns'));

// Ad-hoc sign so TCC has a stable identity to attach the Desktop-access grant to.
execFileSync('codesign', ['--force', '--sign', '-', APP], { stdio: 'inherit' });

console.log(`make-app: built ${APP}`);
